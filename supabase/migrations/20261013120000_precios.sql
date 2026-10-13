-- Historial de precios publicados (lista y oferta) y condiciones mayoristas.
-- El precio vigente de un ítem es el último cambio con fecha <= hoy en cada canal.

create table price_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'Insumos y accesorios',
  product_id uuid references products(id),   -- vínculo opcional con el producto del stock (y sus costos)
  web_slug text,                              -- página del producto en melaniapro.com/product-page/…
  wholesale boolean not null default false,   -- figura en el listado mayorista
  wholesale_max_discount int check (wholesale_max_discount between 0 and 100), -- ej. Mousse 120ml: 30
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table price_changes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references price_items(id) on delete cascade,
  channel text not null check (channel in ('LISTA', 'OFERTA')),
  price numeric(14,2) check (price >= 0),     -- en OFERTA, null = se terminó la oferta
  effective_date date not null,
  batch_id uuid,                              -- cambios hechos juntos (una "actualización de precios")
  note text,
  created_by text,
  created_at timestamptz not null default now()
);
create index idx_price_changes_item on price_changes (item_id, channel, effective_date desc);
create index idx_price_changes_date on price_changes (effective_date desc);

-- montos mínimos de compra para cada descuento mayorista, con su vigencia
create table wholesale_terms (
  id uuid primary key default gen_random_uuid(),
  effective_date date not null unique,
  min_20 numeric(14,2) not null,
  min_30 numeric(14,2) not null,
  min_40 numeric(14,2) not null,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

alter table price_items enable row level security;
alter table price_changes enable row level security;
alter table wholesale_terms enable row level security;
