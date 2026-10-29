-- Reembolso de un pedido web ya armado (total o parcial, por producto), cargado desde
-- el pedido. La plata se devuelve en Wix; acá se registra qué pasa con el stock:
--   vuelve al Depósito → se anula la venta y se vuelve a registrar solo lo que queda vendido
--   no vuelve (ej. fallado, se lo quedó la clienta) → el stock no se toca
-- Reembolsado todo, el pedido queda "Reembolsado" y sale de Procesados/Despachados/Retirados.

-- unidades reembolsadas que NO volvieron (siguen como vendidas, pero ya no se pueden reembolsar)
alter table reservations add column refunded_kept numeric(12,3) not null default 0 check (refunded_kept >= 0);

create table channel_order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references channel_orders(id) on delete cascade,
  item_id uuid not null references channel_order_items(id) on delete cascade,
  quantity numeric(12,3) not null check (quantity > 0),   -- en unidades del ítem de Wix
  returned boolean not null,
  batch_id uuid not null,
  actor text not null,
  created_at timestamptz not null default now()
);
create index idx_order_refunds_order on channel_order_refunds (order_id);
alter table channel_order_refunds enable row level security;

-- p_lines: [{item_id, quantity}] en unidades del ítem
create function wix_refund_order(p_order_id uuid, p_lines jsonb, p_returned boolean, p_actor text, p_batch uuid)
returns jsonb language plpgsql as $$
declare
  o channel_orders;
  l record;
  it channel_order_items;
  r record;
  m record;
  v_max numeric;
  v_x numeric;
  v_keep numeric;
  v_activo numeric;
  v_total numeric := 0;
  v_quedan boolean;
begin
  if p_returned is null then raise exception 'Indicá si el producto vuelve al stock'; end if;
  if p_batch is null then raise exception 'Falta el identificador del reembolso'; end if;
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  -- mismo formulario enviado dos veces: no se reembolsa dos veces
  if exists (select 1 from channel_order_refunds where batch_id = p_batch) then
    return jsonb_build_object('repeated', true);
  end if;
  if o.channel_type = 'POS' then raise exception 'Las ventas del local se resuelven con Volvió / No volvió al Store'; end if;
  if o.state not in ('PROCESSED', 'PARTIAL') then raise exception 'El pedido todavía no se armó: no hay nada descontado para reembolsar'; end if;
  if exists (select 1 from reservations where order_id = p_order_id and to_return > 0) then
    raise exception 'Primero rearmá el pedido (hay productos para sacar del paquete)';
  end if;

  for l in
    select (x->>'item_id')::uuid as item_id, (x->>'quantity')::numeric as q
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  loop
    if l.q is null or l.q <= 0 then continue; end if;
    if l.q <> trunc(l.q) then raise exception 'Las cantidades deben ser enteras'; end if;
    select * into it from channel_order_items where id = l.item_id and order_id = p_order_id;
    if not found then raise exception 'Ítem inexistente en este pedido'; end if;
    select min(floor((consumed - refunded_kept) / per_unit)) into v_max from reservations where item_id = it.id;
    if coalesce(v_max, 0) < l.q then
      raise exception 'De % se pueden reembolsar hasta % unidad(es)', coalesce(it.name, it.external_sku, 'un producto'), coalesce(v_max, 0);
    end if;

    for r in select * from reservations where item_id = it.id order by id for update loop
      v_x := l.q * r.per_unit;
      if p_returned then
        -- se anula la venta de esta línea y se vuelve a registrar solo lo que queda vendido
        -- lo vendido que sigue en pie (por si algo ya se revirtió a mano en Movimientos)
        select coalesce(sum(mv.quantity), 0) into v_activo from inventory_movements mv
         where mv.idempotency_key like 'wix:' || o.external_id || ':' || it.external_line_id || ':' || r.product_id || ':%'
           and mv.type in ('SALE', 'WHOLESALE_SALE')
           and not exists (select 1 from inventory_movements x where x.reversal_of = mv.id);
        if v_activo - r.refunded_kept < v_x then
          raise exception 'Parte de % ya se revirtió a mano en Movimientos: resolvelo desde ahí', coalesce(it.name, it.external_sku, 'un producto');
        end if;
        v_keep := v_activo - v_x;
        for m in
          select mv.id from inventory_movements mv
           where mv.idempotency_key like 'wix:' || o.external_id || ':' || it.external_line_id || ':' || r.product_id || ':%'
             and mv.type in ('SALE', 'WHOLESALE_SALE')
             and not exists (select 1 from inventory_movements x where x.reversal_of = mv.id)
           order by mv.occurred_at
        loop
          perform reverse_movement(m.id, p_actor, 'Reembolso pedido ' || coalesce(o.number, o.external_id) || ': volvió al Depósito');
        end loop;
        if v_keep > 0 then
          perform _consume_fefo(r.product_id, r.location_id, null, v_keep, r.sale_type, p_actor,
            coalesce(o.number, o.external_id), 'Pedido web con reembolso parcial',
            'wix:' || o.external_id || ':' || it.external_line_id || ':' || r.product_id || ':reembolso:' || p_batch);
        end if;
        update reservations
           set consumed = v_keep,
               released = released + v_x,
               status = case when v_keep + released + v_x < quantity then status
                             when v_keep > 0 then 'CONSUMED'::reservation_status
                             else 'RELEASED'::reservation_status end,
               updated_at = now()
         where id = r.id;
      else
        update reservations set refunded_kept = refunded_kept + v_x, updated_at = now() where id = r.id;
      end if;
    end loop;

    insert into channel_order_refunds (order_id, item_id, quantity, returned, batch_id, actor)
    values (p_order_id, it.id, l.q, p_returned, p_batch, p_actor);
    v_total := v_total + l.q;
  end loop;
  if v_total = 0 then raise exception 'Indicá qué cantidades se reembolsan'; end if;

  -- ¿queda algo vendido sin reembolsar o pendiente de armar?
  select exists (
    select 1 from reservations
     where order_id = p_order_id and (consumed - refunded_kept > 0 or status = 'ACTIVE')
  ) into v_quedan;

  -- el aviso de reembolso queda resuelto en el historial de revisiones
  if o.review_reason is not null then
    insert into channel_order_reviews (order_id, reason, note, reviewed_by)
    values (p_order_id, o.review_reason,
            'Reembolso ' || case when v_quedan then 'parcial' else 'total' end || ' cargado: '
              || case when p_returned then 'volvió al Depósito' else 'no volvió, el stock no se tocó' end,
            p_actor);
  end if;
  update channel_orders
     set review_resolved = review_resolved || coalesce(string_to_array(review_reason, ' · '), '{}'),
         review_reason = null,
         state = case when v_quedan then state else 'CANCELED'::channel_order_state end,
         refund_resolution = case when v_quedan then refund_resolution
                                  when p_returned then 'RETURNED' else 'NOT_RETURNED' end,
         refund_resolved_at = case when v_quedan then refund_resolved_at else now() end,
         refund_resolved_by = case when v_quedan then refund_resolved_by else p_actor end,
         delivery_status = case when v_quedan then delivery_status end,
         delivered_at = case when v_quedan then delivered_at end,
         delivered_by = case when v_quedan then delivered_by end,
         updated_at = now()
   where id = p_order_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:refund', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'lines', p_lines, 'returned', p_returned, 'batch', p_batch, 'total', not v_quedan));
  return jsonb_build_object('total', not v_quedan, 'units', v_total);
end $$;

revoke execute on function wix_refund_order(uuid, jsonb, boolean, text, uuid) from public, anon, authenticated;

-- pruebas ya revertidas a mano en Movimientos (#90332, #90395): quedan como Reembolsado
with revertidos as (
  select o.id
    from channel_orders o
   where o.channel_type <> 'POS' and o.state = 'PROCESSED'
     and o.payment_status in ('FULLY_REFUNDED', 'PARTIALLY_REFUNDED')
     and exists (select 1 from inventory_movements mv
                  where mv.idempotency_key like 'wix:' || o.external_id || ':%' and mv.type in ('SALE', 'WHOLESALE_SALE'))
     and not exists (select 1 from inventory_movements mv
                      where mv.idempotency_key like 'wix:' || o.external_id || ':%' and mv.type in ('SALE', 'WHOLESALE_SALE')
                        and not exists (select 1 from inventory_movements x where x.reversal_of = mv.id))
), res as (
  update reservations r
     set released = released + consumed, consumed = 0, status = 'RELEASED', updated_at = now()
   where r.order_id in (select id from revertidos)
)
update channel_orders o
   set state = 'CANCELED', refund_resolution = 'RETURNED', refund_resolved_at = now(),
       refund_resolved_by = 'Revisado a mano', delivery_status = null, delivered_at = null,
       delivered_by = null, updated_at = now()
 where o.id in (select id from revertidos);
