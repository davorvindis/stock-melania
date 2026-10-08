-- Seguimiento logístico de una orden de compra: tramos de envío entre
-- proveedores/terceros y el depósito (ej. granel Baricosmos → One Pack para
-- envasar → Depósito). Es solo seguimiento: el stock entra con el ingreso.

alter table purchase_orders drop constraint purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('PENDIENTE', 'EN_PROCESO', 'RECIBIDA_PARCIAL', 'RECIBIDA', 'CANCELADA'));

create table purchase_order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references purchase_orders(id) on delete cascade,
  ship_date date not null,
  from_place text not null,  -- proveedor o ubicación de origen (texto libre)
  to_place text not null,
  description text,          -- qué viaja: "120kg granel pro lash botox"
  carrier text,              -- flete / transportista
  freight_cost numeric(14,2) check (freight_cost >= 0),
  status text not null default 'EN_CAMINO' check (status in ('EN_CAMINO', 'ENTREGADO')),
  delivered_date date,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index idx_po_shipments_order on purchase_order_shipments (order_id, ship_date);

alter table purchase_order_shipments enable row level security;
