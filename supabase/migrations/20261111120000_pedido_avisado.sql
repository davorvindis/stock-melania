-- Pedidos para retirar: quién le avisó a la clienta que su pedido está listo, y cuándo.
-- Solo informativo (no mueve stock); se usa para el recordatorio de pedidos sin avisar.
alter table channel_orders
  add column if not exists customer_notified_at timestamptz,
  add column if not exists customer_notified_by text;
