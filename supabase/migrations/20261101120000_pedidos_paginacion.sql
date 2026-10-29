-- Lista de Pedidos paginada: el método de entrega se calcula en la base para poder filtrar,
-- contar y ordenar ("Para armar": moto, correo, retiro) sobre todos los pedidos y no solo
-- sobre los que entran en una página. Misma regla que metodoEntrega() en pedido-badge.tsx:
--   1 moto · 2 correo · 3 retiro (y ventas del POS) · 4 otro · 9 sin método
alter table channel_orders add column delivery_rank smallint generated always as (
  case
    when channel_type = 'POS' then 3
    when coalesce(raw->'shippingInfo'->>'title', '') = '' then 9
    when lower(raw->'shippingInfo'->>'title') like '%moto%' then 1
    when lower(raw->'shippingInfo'->>'title') like '%correo%' then 2
    when lower(raw->'shippingInfo'->>'title') like '%retiro%'
      or lower(raw->'shippingInfo'->>'title') like '%sucursal%' then 3
    else 4
  end
) stored;

create index idx_channel_orders_ordered on channel_orders (ordered_at desc nulls last);
