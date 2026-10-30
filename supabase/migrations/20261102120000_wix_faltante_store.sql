-- Aviso "Falta stock en Depósito": si el producto está en el Store, lo dice, así quien arma
-- sabe que tiene que pasarlo al Depósito. Con Wix mostrando Depósito + Store, la web puede
-- vender algo que solo está en el Store.
--   "Falta stock en Depósito: Film cejas caja dorada (hay 1 en el Store, pasalo al Depósito)"

create function _wix_faltante(p_product uuid) returns text language sql stable as $$
  select p.name || coalesce(
           (select ' (hay ' || trim_scale(s.a) || ' en el Store, pasalo al Depósito)'
              from (select available_stock(p.id, (wix_settings()->>'location_store')::uuid) as a) s
             where (wix_settings()->>'location_store') is not null and s.a > 0),
           '')
    from products p where p.id = p_product
$$;

-- igual que antes, solo cambia el texto del faltante
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
        v_short := v_short || _wix_faltante(r.product_id);
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


-- igual que antes, solo cambia el texto del faltante
create or replace function wix_sync_order_items(p_order_id uuid, p_actor text) returns jsonb
language plpgsql as $$
declare
  o channel_orders;
  v_lines text[];
  it record;
  r record;
  v_target numeric;
  v_q numeric;
  v_ret numeric;
  v_cambios int := 0;
  v_agregar text[] := '{}';
  v_sacar text[] := '{}';
  v_short text[] := '{}';
  v_active int;
  v_consumed boolean;
  v_state channel_order_state;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if o.channel_type = 'POS' or o.state not in ('RESERVED', 'PARTIAL', 'PROCESSED') then
    return jsonb_build_object('resultado', 'noop');
  end if;
  select coalesce(array_agg(l->>'id'), '{}') into v_lines
    from jsonb_array_elements(coalesce(o.raw->'lineItems', '[]'::jsonb)) l;
  if array_length(v_lines, 1) is null then return jsonb_build_object('resultado', 'noop:sin-lineas'); end if;

  -- productos sacados del pedido en Wix
  for it in
    select i.* from channel_order_items i
     where i.order_id = p_order_id and i.settled_at is null and not (i.external_line_id = any(v_lines))
  loop
    for r in select * from reservations where item_id = it.id and status in ('ACTIVE', 'CONSUMED') for update loop
      update reservations
         set released = quantity - consumed,          -- lo no despachado se libera ya
             to_return = consumed,                    -- lo despachado se saca al rearmar
             status = case when consumed > 0 then 'ACTIVE'::reservation_status else 'RELEASED'::reservation_status end,
             updated_at = now()
       where id = r.id;
      if r.consumed > 0 then v_sacar := v_sacar || (trim_scale(r.consumed) || ' ' || coalesce(it.name, it.external_sku, '?')); end if;
    end loop;
    update channel_order_items
       set settled_at = now(), settled_by = p_actor, settled_action = 'DESCARTADO', settled_note = 'Sacado del pedido en Wix'
     where id = it.id;
    v_cambios := v_cambios + 1;
  end loop;

  -- cantidades cambiadas: la reserva sigue a la cantidad de Wix
  for it in
    select i.* from channel_order_items i
     where i.order_id = p_order_id and i.settled_at is null and i.external_line_id = any(v_lines)
  loop
    for r in select * from reservations where item_id = it.id and status in ('ACTIVE', 'CONSUMED') for update loop
      v_target := r.per_unit * it.quantity;
      v_ret := greatest(r.consumed - v_target, 0);   -- despachado de más → sacar del paquete al rearmar
      v_q := greatest(v_target, r.consumed);         -- nunca por debajo de lo ya despachado
      if v_q = r.quantity and r.released = 0 and v_ret = r.to_return then continue; end if;
      update reservations
         set quantity = v_q,
             released = 0,
             to_return = v_ret,
             status = case when v_ret > 0 or r.consumed < v_q then 'ACTIVE'::reservation_status
                           else 'CONSUMED'::reservation_status end,
             updated_at = now()
       where id = r.id;
      v_cambios := v_cambios + 1;
      if v_target > r.quantity - r.released then
        v_agregar := v_agregar || (trim_scale((v_target - (r.quantity - r.released)) / r.per_unit) || ' ' || coalesce(it.name, it.external_sku, '?'));
        if available_stock(r.product_id, r.location_id) < 0 then v_short := v_short || _wix_faltante(r.product_id); end if;
      elsif v_ret > r.to_return then
        v_sacar := v_sacar || (trim_scale((v_ret - r.to_return) / r.per_unit) || ' ' || coalesce(it.name, it.external_sku, '?'));
      end if;
    end loop;
  end loop;

  if v_cambios = 0 then
    -- sin cambios nuevos, pero si todavía hay algo para sacar del paquete el aviso se mantiene
    -- (la sincronización limpia el aviso del pedido en cada corrida)
    select coalesce(array_agg(trim_scale(rv.to_return / rv.per_unit) || ' ' || coalesce(ci.name, ci.external_sku, '?')), '{}')
      into v_sacar
      from reservations rv join channel_order_items ci on ci.id = rv.item_id
     where rv.order_id = p_order_id and rv.to_return > 0;
    return jsonb_build_object('resultado', 'sin-cambios', 'avisos',
      case when array_length(v_sacar, 1) > 0
           then jsonb_build_array('Editado en Wix después de armar: rearmá el paquete · sacar del paquete: ' || array_to_string(v_sacar, ', '))
           else '[]'::jsonb end);
  end if;

  -- estado: si queda algo para armar o para sacar, vuelve a "Para armar"
  select count(*) filter (where status = 'ACTIVE'), coalesce(bool_or(consumed > 0), false)
    into v_active, v_consumed from reservations where order_id = p_order_id;
  v_state := case when v_active > 0 and v_consumed then 'PARTIAL'::channel_order_state
                  when v_active > 0 then 'RESERVED'::channel_order_state
                  when v_consumed then 'PROCESSED'::channel_order_state
                  else 'RELEASED'::channel_order_state end;
  update channel_orders set state = v_state, updated_at = now() where id = p_order_id;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:order_edited', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'estado_antes', o.state, 'estado', v_state,
                             'agregar', v_agregar, 'sacar', v_sacar, 'falta_stock', v_short));
  -- los avisos los agrega quien llama DESPUÉS de reservar (wix_reserve_order limpia el aviso)
  return jsonb_build_object(
    'resultado', 'editado:' || v_cambios,
    'avisos', to_jsonb(array_remove(array[
      case when o.state in ('PROCESSED', 'PARTIAL') and (array_length(v_agregar, 1) > 0 or array_length(v_sacar, 1) > 0)
           then 'Editado en Wix después de armar: rearmá el paquete' ||
                case when array_length(v_agregar, 1) > 0 then ' · agregar: ' || array_to_string(v_agregar, ', ') else '' end ||
                case when array_length(v_sacar, 1) > 0 then ' · sacar del paquete: ' || array_to_string(v_sacar, ', ') else '' end end,
      case when array_length(v_short, 1) > 0 then 'Falta stock en Depósito: ' || array_to_string(v_short, ', ') end
    ], null)));
end $$;


revoke execute on function _wix_faltante(uuid) from public, anon, authenticated;
