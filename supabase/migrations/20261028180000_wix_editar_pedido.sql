-- Pedido editado en Wix (agregar, cambiar cantidad, sacar productos).
-- Toda edición se hace en Wix; Melania la toma sola y el pedido vuelve a "Para armar".
--  · Lo agregado / cantidades de más: queda reservado para armar.
--  · Lo sacado / cantidades de menos:
--      - si no estaba despachado: se libera la reserva al instante;
--      - si ya estaba despachado (procesado pero el paquete sigue en el local): queda
--        "para sacar del paquete" (to_return) y vuelve al stock recién cuando lo rearman
--        y tocan "Marcar como procesado": se anula la venta original de ese producto y se
--        vuelve a registrar solo lo que se queda (así no figura como vendido lo devuelto).

alter table reservations add column to_return numeric(12,3) not null default 0 check (to_return >= 0);

create function wix_sync_order_items(p_order_id uuid, p_actor text) returns jsonb
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
        if available_stock(r.product_id, r.location_id) < 0 then v_short := v_short || coalesce(it.name, it.external_sku, '?'); end if;
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

-- procesar: igual que antes + al rearmar devuelve al stock lo sacado del paquete
create or replace function wix_process_order(p_order_id uuid, p_lines jsonb, p_actor_id uuid, p_actor text, p_batch uuid default null)
returns jsonb language plpgsql as $$
declare
  o channel_orders;
  it record;
  r record;
  m record;
  v_units numeric;
  v_pending numeric;
  v_take numeric;
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  v_out jsonb := '[]'::jsonb;
  v_before numeric;
  v_left int;
  v_line text;
  v_keep numeric;
  v_devueltos jsonb := '[]'::jsonb;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if p_batch is not null and exists (select 1 from audit_logs where action = 'wix:process' and entity_id = p_order_id and detail->>'batch' = p_batch::text) then
    select coalesce(jsonb_agg(jsonb_build_object('line_id', i.external_line_id, 'quantity', f.quantity)), '[]'::jsonb) into v_out
      from channel_order_fulfillments f join channel_order_items i on i.id = f.item_id
     where f.batch_id = p_batch;
    return jsonb_build_object('batch_id', p_batch, 'lines', v_out, 'repeated', true);
  end if;
  if o.state not in ('RESERVED','PARTIAL') then
    raise exception 'El pedido no está reservado (estado: %)', o.state;
  end if;

  -- 1) lo que se sacó del paquete vuelve al stock: se anula la venta original y se
  --    vuelve a registrar solo lo que se queda
  for r in select * from reservations where order_id = p_order_id and to_return > 0 order by id for update loop
    select external_line_id into v_line from channel_order_items where id = r.item_id;
    v_keep := r.consumed - r.to_return;
    for m in
      select mv.id from inventory_movements mv
       where mv.idempotency_key like 'wix:' || o.external_id || ':' || v_line || ':' || r.product_id || ':%'
         and mv.type in ('SALE', 'WHOLESALE_SALE')
         and not exists (select 1 from inventory_movements x where x.reversal_of = mv.id)
       order by mv.occurred_at
    loop
      perform reverse_movement(m.id, p_actor, 'Pedido ' || coalesce(o.number, o.external_id) || ' editado en Wix: rearmado');
    end loop;
    if v_keep > 0 then
      perform _consume_fefo(r.product_id, r.location_id, null, v_keep, r.sale_type, p_actor,
        coalesce(o.number, o.external_id), 'Pedido web rearmado por ' || p_actor,
        'wix:' || o.external_id || ':' || v_line || ':' || r.product_id || ':rearmado:' || v_batch);
    end if;
    update reservations
       set consumed = v_keep,
           released = released + to_return,
           to_return = 0,
           status = case when v_keep + released + to_return < quantity then 'ACTIVE'::reservation_status
                         when v_keep > 0 then 'CONSUMED'::reservation_status
                         else 'RELEASED'::reservation_status end,
           updated_at = now()
     where id = r.id;
    v_devueltos := v_devueltos || jsonb_build_object('product_id', r.product_id, 'devuelto', r.to_return);
  end loop;

  -- 2) lo pendiente de armar (igual que antes)
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
        'wix:' || o.external_id || ':' || it.external_line_id || ':' || r.product_id || ':' || trim_scale(v_before) || ':' || v_batch);
    end loop;
    insert into channel_order_fulfillments (order_id, item_id, quantity, batch_id, actor_id, actor)
    values (p_order_id, it.id, v_units, v_batch, p_actor_id, p_actor);
    v_out := v_out || jsonb_build_object('line_id', it.external_line_id, 'quantity', v_units);
  end loop;

  if jsonb_array_length(v_out) = 0 and jsonb_array_length(v_devueltos) = 0 then
    raise exception 'No hay unidades pendientes para procesar';
  end if;
  select count(*) into v_left from reservations where order_id = p_order_id and status = 'ACTIVE';
  update channel_orders
     set state = case when v_left = 0 then 'PROCESSED'::channel_order_state else 'PARTIAL'::channel_order_state end,
         processed_at = now(), processed_by_id = p_actor_id, processed_by = p_actor,
         review_reason = case when v_left = 0 and review_reason like 'Marcado procesado en Wix%' then null
                              when v_left = 0 and review_reason like 'Editado en Wix después de armar%' then
                                nullif(array_to_string(array(select s from unnest(string_to_array(review_reason, ' · ')) s
                                  where s !~ '^(Editado en Wix después de armar|agregar:|sacar del paquete:)'), ' · '), '')
                              else review_reason end
   where id = p_order_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:process', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'lines', v_out, 'devueltos', v_devueltos, 'batch', v_batch));
  return jsonb_build_object('batch_id', v_batch, 'lines', v_out, 'devueltos', v_devueltos);
end $$;

revoke execute on function wix_sync_order_items(uuid, text) from public, anon, authenticated;
revoke execute on function wix_process_order(uuid, jsonb, uuid, text, uuid) from public, anon, authenticated;
