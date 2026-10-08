-- Órdenes de compra a proveedores y costos de producto mes a mes.
-- No tocan el stock: al recibir una orden se registra un ingreso normal
-- (create_stock_entry) y la orden solo guarda cuánto se recibió.

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  order_date date not null,
  expected_date date,
  status text not null default 'PENDIENTE'
    check (status in ('PENDIENTE', 'RECIBIDA_PARCIAL', 'RECIBIDA', 'CANCELADA')),
  paid_pct numeric(5,2) check (paid_pct between 0 and 100), -- null = sin dato
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_purchase_orders_date on purchase_orders (order_date desc);

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references purchase_orders(id) on delete cascade,
  position int not null default 0,
  product_id uuid references products(id), -- opcional: estuches, granel, etc. pueden no estar en el catálogo
  description text not null,
  quantity numeric(14,3) check (quantity > 0),
  unit text,
  kind text, -- "15ml", "granel", "para envasar"…
  unit_cost numeric(14,2) check (unit_cost >= 0),
  received_qty numeric(14,3) not null default 0 check (received_qty >= 0)
);
create index idx_po_lines_order on purchase_order_lines (order_id, position);

-- vínculo ingreso ↔ orden (para saber qué ingreso recibió qué orden)
alter table stock_entries add column purchase_order_id uuid references purchase_orders(id);

-- costo de un ítem en un mes (period = primer día del mes)
create table product_costs (
  id uuid primary key default gen_random_uuid(),
  period date not null check (extract(day from period) = 1),
  item text not null,
  product_id uuid references products(id),
  supplier_id uuid references suppliers(id),
  granel numeric(14,2),
  envasado numeric(14,2),
  folia numeric(14,2),
  envase numeric(14,2),
  estuche numeric(14,2),
  etiqueta numeric(14,2),
  envase_granel numeric(14,2),
  envase_granel_etiqueta numeric(14,2),
  total_cost numeric(14,2) generated always as (
    coalesce(granel, 0) + coalesce(envasado, 0) + coalesce(folia, 0) + coalesce(envase, 0)
    + coalesce(estuche, 0) + coalesce(etiqueta, 0) + coalesce(envase_granel, 0)
    + coalesce(envase_granel_etiqueta, 0)
  ) stored,
  sale_price numeric(14,2) check (sale_price >= 0),
  quote_note text, -- "Cotización": fecha o mes de la última cotización
  notes text,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (period, item)
);
create index idx_product_costs_item on product_costs (item, period);

alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;
alter table product_costs enable row level security;
