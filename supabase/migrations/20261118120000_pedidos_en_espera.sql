-- Pedido "en espera": armado (o por armar) que no se despacha a propósito, ej. una mayorista que
-- espera el ingreso de otro producto para mandar todo junto. No mueve stock: solo deja de contar
-- como demorado y aparece aparte en el Dashboard. hold_products = productos que se esperan
-- (para avisar cuando entran al lugar de donde sale el pedido).
alter table channel_orders
  add column if not exists hold_reason text,
  add column if not exists hold_since timestamptz,
  add column if not exists hold_by text,
  add column if not exists hold_products uuid[] not null default '{}';

create index if not exists idx_channel_orders_hold on channel_orders (hold_since) where hold_since is not null;
