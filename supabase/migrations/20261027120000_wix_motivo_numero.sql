-- Motivo de las ventas Wix = solo el N° de pedido (antes 'Wix #<n>'), igual que la carga manual.
-- Mismas funciones que en wix_integracion; solo cambia el motivo.

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
       select 1 from channel_order_items where order_id = p_order_id and (not resolved or note is not null)) then
    return 'noop:PROCESSED';
  end if;
  if v_loc is null then raise exception 'Falta configurar la ubicación Store para Wix'; end if;

  for it in
    select * from channel_order_items
     where order_id = p_order_id and (o.state = 'NEW' or not resolved or note is not null)
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
  if exists (select 1 from channel_order_items where order_id = p_order_id and note is not null and note not in ('Sin SKU','SKU sin equivalencia')) then
    perform _wix_append_review(p_order_id, 'Quedan ítems sin descontar del Store (ver detalle)');
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:pos_sale', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'retry', o.state = 'PROCESSED', 'missing', v_missing, 'failed', v_failed));
  return case when v_any then 'sold' else 'nothing' end;
end $$;

create or replace function wix_process_order(p_order_id uuid, p_lines jsonb, p_actor_id uuid, p_actor text, p_batch uuid default null)
returns jsonb language plpgsql as $$
declare
  o channel_orders;
  it record;
  r record;
  v_units numeric;
  v_pending numeric;
  v_take numeric;
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  v_out jsonb := '[]'::jsonb;
  v_before numeric;
  v_left int;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if p_batch is not null and exists (select 1 from channel_order_fulfillments where batch_id = p_batch) then
    select jsonb_agg(jsonb_build_object('line_id', i.external_line_id, 'quantity', f.quantity)) into v_out
      from channel_order_fulfillments f join channel_order_items i on i.id = f.item_id
     where f.batch_id = p_batch;
    return jsonb_build_object('batch_id', p_batch, 'lines', v_out, 'repeated', true);
  end if;
  if o.state not in ('RESERVED','PARTIAL') then
    raise exception 'El pedido no está reservado (estado: %)', o.state;
  end if;

  for it in
    select i.*,
           coalesce((select (l->>'quantity')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
                      where (l->>'item_id')::uuid = i.id), case when p_lines is null then null else 0 end) as asked
      from channel_order_items i where i.order_id = p_order_id and i.resolved
     order by i.external_line_id
  loop
    select min(floor((quantity - consumed - released) / per_unit)) into v_pending
      from reservations where item_id = it.id and status = 'ACTIVE';
    v_pending := coalesce(v_pending, 0);
    if it.asked is not null and it.asked > v_pending then
      raise exception 'El ítem "%" tiene % pendientes, no %', it.name, trim_scale(v_pending), trim_scale(it.asked);
    end if;
    v_units := case when it.asked is null then v_pending else least(it.asked, v_pending) end;
    if v_units <= 0 then continue; end if;
    for r in select * from reservations where item_id = it.id and status = 'ACTIVE' order by id for update loop
      v_take := r.per_unit * v_units;
      v_before := r.consumed;
      update reservations
         set consumed = consumed + v_take,
             status = case when consumed + v_take + released >= quantity then 'CONSUMED'::reservation_status else 'ACTIVE'::reservation_status end
       where id = r.id;
      perform _consume_fefo(r.product_id, r.location_id, null, v_take, r.sale_type, p_actor,
        coalesce(o.number, o.external_id), 'Pedido web procesado por ' || p_actor,
        'wix:' || o.external_id || ':' || it.external_line_id || ':' || r.product_id || ':' || trim_scale(v_before));
    end loop;
    insert into channel_order_fulfillments (order_id, item_id, quantity, batch_id, actor_id, actor)
    values (p_order_id, it.id, v_units, v_batch, p_actor_id, p_actor);
    v_out := v_out || jsonb_build_object('line_id', it.external_line_id, 'quantity', v_units);
  end loop;

  if jsonb_array_length(v_out) = 0 then
    raise exception 'No hay unidades pendientes para procesar';
  end if;
  select count(*) into v_left from reservations where order_id = p_order_id and status = 'ACTIVE';
  update channel_orders
     set state = case when v_left = 0 then 'PROCESSED'::channel_order_state else 'PARTIAL'::channel_order_state end,
         processed_at = now(), processed_by_id = p_actor_id, processed_by = p_actor,
         review_reason = case when v_left = 0 and review_reason like 'Marcado procesado en Wix%' then null else review_reason end
   where id = p_order_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:process', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'lines', v_out, 'batch', v_batch));
  return jsonb_build_object('batch_id', v_batch, 'lines', v_out);
end $$;
