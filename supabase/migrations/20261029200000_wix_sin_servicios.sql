-- Las reservas de servicios (turnos de Wix Bookings) no son ventas de productos: desde ahora
-- no se traen. Se sacan los pedidos de solo servicios que ya habían entrado (ninguno reservó,
-- descontó ni se procesó; quedan registrados en auditoría).
with s as (
  select o.id, o.number
    from channel_orders o
   where jsonb_array_length(coalesce(o.raw->'lineItems', '[]'::jsonb)) > 0
     and not exists (select 1 from jsonb_array_elements(o.raw->'lineItems') l
                      where coalesce(l->'itemType'->>'preset', '') <> 'SERVICE'
                        and coalesce(l->'catalogReference'->>'appId', '') <> '13d21c63-b5ec-5912-8397-c3a5ddb27a97')
     and not exists (select 1 from channel_order_items i join reservations r on r.item_id = i.id where i.order_id = o.id)
     and not exists (select 1 from channel_order_items i where i.order_id = o.id and i.settled_at is not null)
     and not exists (select 1 from channel_order_fulfillments f where f.order_id = o.id)
), a as (
  insert into audit_logs (actor, action, entity, entity_id, detail)
  select 'sistema', 'wix:service_order_removed', 'channel_orders', s.id, jsonb_build_object('number', s.number) from s
)
delete from channel_orders where id in (select id from s);
