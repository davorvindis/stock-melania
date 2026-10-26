-- Ventas Wix sin descontar (ítem sin SKU, sin equivalencia o sin stock): se regularizan a mano
-- desde "Pedidos Wix → Sin descontar". Descontar = egreso con el N° de pedido como motivo;
-- descartar = queda registrado quién y por qué. Las líneas regularizadas no se reintentan.

alter table channel_order_items
  add column settled_at timestamptz,
  add column settled_by text,
  add column settled_action text check (settled_action in ('DESCONTADO','DESCARTADO')),
  add column settled_product_id uuid references products(id),
  add column settled_quantity numeric(12,3),
  add column settled_note text;

-- pendientes: ítem no descontado de un pedido vigente
create view v_wix_sin_descontar as
select i.id as item_id, i.order_id, o.number, o.external_id, o.channel_type, o.state, o.ordered_at,
       o.customer, i.external_sku, i.name, i.quantity, i.note
  from channel_order_items i
  join channel_orders o on o.id = i.order_id
 where i.settled_at is null
   and (not i.resolved or i.note is not null)
   and o.state in ('RESERVED','PARTIAL','PROCESSED');

-- saca del aviso del pedido lo de "sin descontar" cuando ya no queda nada pendiente
create function _wix_clear_pending_review(p_order uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from channel_order_items where order_id = p_order and settled_at is null
              and (not resolved or note is not null)) then
    return;
  end if;
  update channel_orders
     set review_reason = nullif(array_to_string(array(
           select s from unnest(string_to_array(review_reason, ' · ')) s
            where s !~ '^(Sin equivalencia|No se pudo descontar|Quedan ítems sin descontar|Falta stock)'), ' · '), '')
   where id = p_order and review_reason is not null;
end $$;

create function wix_settle_item(p_item uuid, p_product uuid, p_quantity numeric, p_actor text, p_note text default null)
returns text language plpgsql as $$
declare
  it channel_order_items;
  o channel_orders;
  v_loc uuid;
begin
  select * into it from channel_order_items where id = p_item for update;
  if not found then raise exception 'Ítem inexistente'; end if;
  select * into o from channel_orders where id = it.order_id for update;
  if it.settled_at is not null then return 'noop:' || it.settled_action; end if;
  if o.state not in ('RESERVED','PARTIAL','PROCESSED') then raise exception 'El pedido está %: no se descuenta', o.state; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'La cantidad tiene que ser mayor a 0'; end if;
  if not exists (select 1 from products where id = p_product) then raise exception 'Producto inexistente'; end if;
  v_loc := case when o.channel_type = 'POS' then (wix_settings()->>'location_store')::uuid
                else (wix_settings()->>'location_deposito')::uuid end;
  if v_loc is null then raise exception 'Falta configurar la ubicación para Wix'; end if;
  perform pg_advisory_xact_lock(hashtext(p_product::text || ':' || v_loc::text));
  perform _consume_fefo(p_product, v_loc, null, p_quantity, _wix_sale_type(it.external_sku), p_actor,
    coalesce(o.number, o.external_id),
    'Venta Wix regularizada (' || coalesce(it.name, 'ítem') || ')' || coalesce(': ' || nullif(trim(p_note), ''), ''),
    'wix-settle:' || p_item);
  update channel_order_items
     set resolved = true, note = null, settled_at = now(), settled_by = p_actor, settled_action = 'DESCONTADO',
         settled_product_id = p_product, settled_quantity = p_quantity, settled_note = nullif(trim(p_note), '')
   where id = p_item;
  perform _wix_clear_pending_review(o.id);
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:settle', 'channel_order_items', p_item,
          jsonb_build_object('number', o.number, 'item', it.name, 'sku', it.external_sku, 'product', p_product,
                             'quantity', p_quantity, 'location', v_loc, 'note', p_note));
  return 'settled';
end $$;

create function wix_discard_item(p_item uuid, p_actor text, p_note text) returns text language plpgsql as $$
declare
  it channel_order_items;
  o channel_orders;
begin
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Explicá por qué se descarta'; end if;
  select * into it from channel_order_items where id = p_item for update;
  if not found then raise exception 'Ítem inexistente'; end if;
  select * into o from channel_orders where id = it.order_id for update;
  if it.settled_at is not null then return 'noop:' || it.settled_action; end if;
  update channel_order_items
     set settled_at = now(), settled_by = p_actor, settled_action = 'DESCARTADO', settled_note = trim(p_note)
   where id = p_item;
  perform _wix_clear_pending_review(o.id);
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:discard_item', 'channel_order_items', p_item,
          jsonb_build_object('number', o.number, 'item', it.name, 'sku', it.external_sku, 'quantity', it.quantity, 'note', p_note));
  return 'discarded';
end $$;

revoke execute on function _wix_clear_pending_review(uuid) from public, anon, authenticated;
revoke execute on function wix_settle_item(uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke execute on function wix_discard_item(uuid, text, text) from public, anon, authenticated;
revoke all on v_wix_sin_descontar from anon, authenticated;

-- reserva y venta POS: no tocar ítems ya regularizados

create or replace function wix_reserve_order(p_order_id uuid, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders;
  it record;
  r record;
  v_loc uuid := (wix_settings()->>'location_deposito')::uuid;
  v_ign timestamptz := _wix_ignore_before();
  v_any boolean := false;
  v_new int := 0;
  v_cnt int;
  v_missing text[] := '{}';
  v_short text[] := '{}';
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if o.state in ('RELEASED','CANCELED') then return 'noop:' || o.state; end if;
  if o.state = 'IGNORED' then return 'ignored'; end if;
  if o.state = 'NEW' and v_ign is not null and o.ordered_at is not null and o.ordered_at < v_ign then
    update channel_orders set state = 'IGNORED', review_reason = null where id = p_order_id;
    return 'ignored';
  end if;
  if v_loc is null then raise exception 'Falta configurar la ubicación Depósito para Wix'; end if;

  for it in select * from channel_order_items where order_id = p_order_id and settled_at is null order by external_line_id loop
    if it.external_sku is null then
      update channel_order_items set resolved = false, note = 'Sin SKU' where id = it.id;
      v_missing := v_missing || coalesce(it.name, '?');
      continue;
    end if;
    if not exists (select 1 from resolve_channel_sku('WIX', it.external_sku)) then
      update channel_order_items set resolved = false, note = 'SKU sin equivalencia' where id = it.id;
      v_missing := v_missing || it.external_sku;
      continue;
    end if;
    update channel_order_items set resolved = true, note = null where id = it.id;
    for r in select * from resolve_channel_sku('WIX', it.external_sku) loop
      perform pg_advisory_xact_lock(hashtext(r.product_id::text || ':' || v_loc::text));
      insert into reservations (order_id, item_id, product_id, location_id, per_unit, quantity, sale_type)
      values (p_order_id, it.id, r.product_id, v_loc, r.quantity, r.quantity * it.quantity,
              _wix_sale_type(it.external_sku))
      on conflict (item_id, product_id) do nothing;
      get diagnostics v_cnt = row_count;
      v_new := v_new + v_cnt;
      v_any := true;
      if available_stock(r.product_id, v_loc) < 0 then
        v_short := v_short || r.name;
      end if;
    end loop;
  end loop;

  update channel_orders
     set state = case when state = 'NEW' and v_any then 'RESERVED'::channel_order_state
                      when state = 'PROCESSED' and v_new > 0 then 'PARTIAL'::channel_order_state
                      else state end,
         location_id = coalesce(location_id, v_loc),
         paid_at = coalesce(paid_at, now()),
         review_reason = case when review_reason like 'Marcado procesado en Wix%' then review_reason else null end
   where id = p_order_id;
  if array_length(v_missing, 1) > 0 then
    perform _wix_append_review(p_order_id, 'Sin equivalencia: ' || array_to_string(v_missing, ', '));
  end if;
  if array_length(v_short, 1) > 0 then
    perform _wix_append_review(p_order_id, 'Falta stock en Depósito: ' || array_to_string(v_short, ', '));
  end if;
  if o.wix_fulfilled and v_new > 0 then
    perform _wix_append_review(p_order_id, 'Marcado procesado en Wix: confirmá en Melania quién lo armó');
  end if;
  if v_new > 0 or o.state = 'NEW' then
    insert into audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'wix:reserve', 'channel_orders', p_order_id,
            jsonb_build_object('number', o.number, 'new', v_new, 'missing', v_missing, 'short', v_short));
  end if;
  return case when v_new > 0 then 'reserved' when v_any then 'noop:reserved' else 'nothing' end;
end $$;

create or replace function wix_pos_sale(p_order_id uuid, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders;
  it record;
  r record;
  v_loc uuid := (wix_settings()->>'location_store')::uuid;
  v_ign timestamptz := _wix_ignore_before();
  v_missing text[] := '{}';
  v_failed text[] := '{}';
  v_any boolean := false;
  v_err text;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if o.state not in ('NEW','PROCESSED') then return 'noop:' || o.state; end if;
  if o.state = 'NEW' and v_ign is not null and o.ordered_at is not null and o.ordered_at < v_ign then
    update channel_orders set state = 'IGNORED' where id = p_order_id;
    return 'ignored';
  end if;
  if o.state = 'PROCESSED' and not exists (
       select 1 from channel_order_items where order_id = p_order_id and settled_at is null and (not resolved or note is not null)) then
    return 'noop:PROCESSED';
  end if;
  if v_loc is null then raise exception 'Falta configurar la ubicación Store para Wix'; end if;

  for it in
    select * from channel_order_items
     where order_id = p_order_id and settled_at is null and (o.state = 'NEW' or not resolved or note is not null)
     order by external_line_id
  loop
    if it.external_sku is null or not exists (select 1 from resolve_channel_sku('WIX', it.external_sku)) then
      update channel_order_items set resolved = false,
             note = case when it.external_sku is null then 'Sin SKU' else 'SKU sin equivalencia' end
       where id = it.id;
      v_missing := v_missing || coalesce(it.external_sku, it.name, '?');
      continue;
    end if;
    v_err := null;
    for r in select * from resolve_channel_sku('WIX', it.external_sku) loop
      begin
        perform _consume_fefo(r.product_id, v_loc, null, r.quantity * it.quantity,
          _wix_sale_type(it.external_sku), p_actor, coalesce(o.number, o.external_id),
          'Venta POS (Store)', 'wix:' || o.external_id || ':' || it.external_line_id || ':' || r.product_id);
        v_any := true;
      exception when others then
        v_err := sqlerrm;
        v_failed := v_failed || (r.name || ' (' || v_err || ')');
      end;
    end loop;
    update channel_order_items set resolved = true, note = v_err where id = it.id;
  end loop;

  update channel_orders
     set state = 'PROCESSED', location_id = v_loc, paid_at = coalesce(paid_at, now()),
         processed_at = coalesce(processed_at, now()), processed_by = coalesce(processed_by, 'Wix POS'),
         review_reason = null
   where id = p_order_id;
  if array_length(v_missing, 1) > 0 then
    perform _wix_append_review(p_order_id, 'Sin equivalencia: ' || array_to_string(v_missing, ', '));
  end if;
  if array_length(v_failed, 1) > 0 then
    perform _wix_append_review(p_order_id, 'No se pudo descontar del Store: ' || array_to_string(v_failed, '; '));
  end if;
  -- aviso de ítems que siguen con error de corridas anteriores
  if exists (select 1 from channel_order_items where order_id = p_order_id and settled_at is null and note is not null and note not in ('Sin SKU','SKU sin equivalencia')) then
    perform _wix_append_review(p_order_id, 'Quedan ítems sin descontar del Store (ver detalle)');
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:pos_sale', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'retry', o.state = 'PROCESSED', 'missing', v_missing, 'failed', v_failed));
  return case when v_any then 'sold' else 'nothing' end;
end $$;
