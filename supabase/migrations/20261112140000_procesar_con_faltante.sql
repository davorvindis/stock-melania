-- Procesar un pedido aunque deje sin stock a otros pedidos reservados, con confirmación.
-- Antes, si la suma de reservas superaba el stock (ej. sobreventa), no se podía procesar
-- ningún pedido de ese producto. Ahora quien arma ve qué pedidos quedan cortos y decide por
-- urgencia (moto antes que correo, etc.). Los pedidos que quedan sin cubrir pasan a "a revisar".

create or replace function public.apply_movement(p_type movement_type, p_product uuid, p_lot uuid, p_quantity numeric, p_from uuid, p_to uuid, p_actor text, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_entry uuid DEFAULT NULL::uuid, p_reversal_of uuid DEFAULT NULL::uuid, p_idem text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id uuid;
  v_lot_status lot_status;
  v_sealed boolean;
  v_code text;
  v_reserved numeric;
  v_sellable numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a 0';
  end if;
  if p_idem is not null then
    select id into v_id from inventory_movements where idempotency_key = p_idem;
    if found then return v_id; end if;
  end if;
  if p_lot is not null then
    select status, sealed, code into v_lot_status, v_sealed, v_code from lots where id = p_lot;
  end if;
  if p_lot is not null and p_type in ('SALE','WHOLESALE_SALE') then
    if v_lot_status is distinct from 'ACTIVE' then
      raise exception 'El lote no está liberado (estado: %). No puede venderse.', v_lot_status;
    end if;
  end if;
  if p_lot is not null and p_from is not null
     and p_type not in ('COUNT_ADJUSTMENT','REVERSAL','LOT_ASSIGNMENT') then
    if v_sealed then
      raise exception 'El lote % está en caja cerrada: abrí la caja antes de sacar unidades.', v_code;
    end if;
  end if;
  if p_from is not null
     and p_type not in ('COUNT_ADJUSTMENT','REVERSAL','LOT_ASSIGNMENT','QUARANTINE_IN','BREAKAGE','EXPIRED')
     and (p_lot is null or (v_lot_status = 'ACTIVE' and not v_sealed)) then
    perform pg_advisory_xact_lock(hashtext(p_product::text || ':' || p_from::text));
    v_reserved := reserved_qty(p_product, p_from);
    -- al procesar un pedido con confirmación (wix_process_order_forzado) se permite usar stock
    -- reservado por otros pedidos; esos pedidos quedan "a revisar" por falta de stock
    if v_reserved > 0 and coalesce(current_setting('melania.permitir_faltante', true), '') <> 'on' then
      v_sellable := sellable_on_hand(p_product, p_from);
      if v_sellable - p_quantity < v_reserved then
        raise exception 'Stock insuficiente de "%": hay % vendibles pero % están reservadas por pedidos web (disponible %)',
          (select name from products where id = p_product), trim_scale(v_sellable),
          trim_scale(v_reserved), trim_scale(greatest(v_sellable - v_reserved, 0));
      end if;
    end if;
  end if;
  insert into inventory_movements
    (type, product_id, lot_id, quantity, from_location_id, to_location_id,
     actor, reason, notes, entry_id, reversal_of, idempotency_key)
  values
    (p_type, p_product, p_lot, p_quantity, p_from, p_to,
     p_actor, p_reason, p_notes, p_entry, p_reversal_of, p_idem)
  returning id into v_id;
  if p_from is not null then
    perform _adjust_balance(p_product, p_lot, p_from, -p_quantity);
  end if;
  if p_to is not null then
    perform _adjust_balance(p_product, p_lot, p_to, p_quantity);
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'movement:' || p_type, 'inventory_movements', v_id,
          jsonb_build_object('quantity', p_quantity, 'from', p_from, 'to', p_to, 'lot', p_lot));
  return v_id;
exception when unique_violation then
  if p_idem is not null then
    select id into v_id from inventory_movements where idempotency_key = p_idem;
    if found then return v_id; end if;
  end if;
  raise;
end $function$
;

-- qué pedidos quedarían sin stock si se procesa este pedido completo (para la confirmación)
create function wix_faltante_al_procesar(p_order_id uuid) returns jsonb
language sql stable as $$
  with propio as (
    select r.product_id, r.location_id, sum(r.quantity - r.consumed - r.released) as pend
      from reservations r
     where r.order_id = p_order_id and r.status = 'ACTIVE'
     group by 1, 2
  ), x as (
    select p.product_id, p.location_id, p.pend,
           sellable_on_hand(p.product_id, p.location_id) as vendibles,
           reserved_qty(p.product_id, p.location_id) - p.pend as otros
      from propio p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto', pr.name,
           'ubicacion', l.name,
           'vendibles', x.vendibles,
           'propio', x.pend,
           'otros', x.otros,
           'pedidos', (select coalesce(jsonb_agg(jsonb_build_object(
                          'number', o.number, 'customer', o.customer, 'delivery_rank', o.delivery_rank,
                          'pend', q.pend) order by o.delivery_rank, o.paid_at), '[]'::jsonb)
                         from (select r.order_id, sum(r.quantity - r.consumed - r.released) pend
                                 from reservations r
                                where r.product_id = x.product_id and r.location_id = x.location_id
                                  and r.status = 'ACTIVE' and r.order_id <> p_order_id
                                group by 1) q
                         join channel_orders o on o.id = q.order_id)
         ) order by pr.name), '[]'::jsonb)
    from x
    join products pr on pr.id = x.product_id
    join locations l on l.id = x.location_id
   where x.vendibles >= x.pend          -- hay stock físico para este pedido
     and x.vendibles - x.pend < x.otros -- pero no alcanza para los demás
$$;

-- procesar con confirmación: igual que wix_process_order, pero puede usar stock reservado por
-- otros pedidos. Los que quedan sin cubrir se marcan "a revisar" con el motivo.
create function wix_process_order_forzado(p_order_id uuid, p_lines jsonb, p_actor_id uuid, p_actor text, p_batch uuid default null)
returns jsonb language plpgsql as $$
declare
  v_res jsonb;
  v_num text;
  f record;
  o record;
begin
  perform set_config('melania.permitir_faltante', 'on', true);
  v_res := wix_process_order(p_order_id, p_lines, p_actor_id, p_actor, p_batch);
  perform set_config('melania.permitir_faltante', 'off', true);
  select coalesce(number, external_id) into v_num from channel_orders where id = p_order_id;
  -- productos de este pedido que ahora tienen más reservado que stock
  for f in
    select distinct r.product_id, r.location_id, pr.name as producto, l.name as ubicacion
      from reservations r
      join products pr on pr.id = r.product_id
      join locations l on l.id = r.location_id
     where r.order_id = p_order_id
       and reserved_qty(r.product_id, r.location_id) > sellable_on_hand(r.product_id, r.location_id)
  loop
    for o in
      select distinct r.order_id from reservations r
       where r.product_id = f.product_id and r.location_id = f.location_id and r.status = 'ACTIVE' and r.order_id <> p_order_id
    loop
      perform _wix_append_review(o.order_id, 'Falta stock en ' || f.ubicacion || ': ' || f.producto || ' (se usó para el pedido ' || v_num || ')');
    end loop;
    insert into audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'wix:process_forced', 'channel_orders', p_order_id,
            jsonb_build_object('number', v_num, 'producto', f.producto, 'ubicacion', f.ubicacion));
  end loop;
  return v_res;
end $$;

revoke execute on function wix_faltante_al_procesar(uuid) from public, anon, authenticated;
revoke execute on function wix_process_order_forzado(uuid, jsonb, uuid, text, uuid) from public, anon, authenticated;
