-- Stock Melania — schema núcleo V1
-- Principio: inventory_movements es ledger append-only; stock_balances es proyección
-- actualizada en la misma transacción. Sin auth por ahora: actor es texto libre y
-- RLS deniega todo acceso directo; solo el servidor (service_role) opera.

create type product_type as enum ('TERMINADO','MONODOSIS','INSUMO','PACKAGING','GRANEL','ACCESORIO');
create type lot_status as enum ('ACTIVE','QUARANTINE','BLOCKED','EXPIRED','DEPLETED');
create type movement_type as enum (
  'RECEIPT','TRANSFER','SALE','WHOLESALE_SALE','RETURN_IN','RETURN_OUT','SAMPLE','GIFT',
  'BREAKAGE','EXPIRED','INTERNAL_USE','REPLACEMENT','QUARANTINE_IN','QUARANTINE_RELEASE',
  'SUPPLIER_SEND','SUPPLIER_RETURN','COUNT_ADJUSTMENT','REVERSAL','OTHER'
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  legal_name text,
  cuit text,
  contact text,
  email text,
  phone text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_quarantine boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  description text,
  category text,
  unit text not null default 'unidad',
  type product_type not null default 'TERMINADO',
  min_stock numeric(12,3) not null default 0 check (min_stock >= 0),
  tracks_lot boolean not null default true,
  tracks_expiry boolean not null default true,
  active boolean not null default true,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  code text not null,
  manufactured_on date,
  expires_on date,
  status lot_status not null default 'ACTIVE',
  notes text,
  created_at timestamptz not null default now(),
  unique (product_id, code)
);

create table stock_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  supplier_id uuid references suppliers(id),
  remito text,
  invoice text,
  notes text,
  actor text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table stock_entry_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references stock_entries(id),
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  location_id uuid not null references locations(id),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost numeric(14,2) check (unit_cost >= 0),
  total_cost numeric(14,2) check (total_cost >= 0),
  created_at timestamptz not null default now()
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor text,
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  quantity numeric(12,3) not null check (quantity > 0),
  from_location_id uuid references locations(id),
  to_location_id uuid references locations(id),
  type movement_type not null,
  reason text,
  notes text,
  entry_id uuid references stock_entries(id),
  reversal_of uuid references inventory_movements(id),
  idempotency_key text unique,
  metadata jsonb,
  created_at timestamptz not null default now(),
  check (from_location_id is not null or to_location_id is not null),
  check (type <> 'OTHER' or (reason is not null and reason <> '')),
  check (type <> 'REVERSAL' or reversal_of is not null)
);
create index idx_movements_product on inventory_movements (product_id, occurred_at desc);
create index idx_movements_lot on inventory_movements (lot_id);
create index idx_movements_date on inventory_movements (occurred_at desc);

create table stock_balances (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  location_id uuid not null references locations(id),
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);
create unique index stock_balances_key on stock_balances
  (product_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb
);

-- ledger y auditoría append-only: bloquear update/delete a nivel base de datos
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Registro append-only: no se permite % en %', TG_OP, TG_TABLE_NAME;
end $$;
create trigger movements_append_only before update or delete on inventory_movements
  for each row execute function forbid_change();
create trigger audit_append_only before update or delete on audit_logs
  for each row execute function forbid_change();
create trigger entries_no_delete before delete on stock_entries
  for each row execute function forbid_change();
create trigger entry_lines_append_only before update or delete on stock_entry_lines
  for each row execute function forbid_change();

-- RLS: sin políticas = acceso directo denegado para anon/authenticated.
-- El servidor usa service_role, que bypassa RLS.
alter table suppliers enable row level security;
alter table locations enable row level security;
alter table products enable row level security;
alter table lots enable row level security;
alter table stock_entries enable row level security;
alter table stock_entry_lines enable row level security;
alter table inventory_movements enable row level security;
alter table stock_balances enable row level security;
alter table audit_logs enable row level security;

-- ajusta balance con upsert (lock de fila); check >= 0 impide stock negativo
create function _adjust_balance(p_product uuid, p_lot uuid, p_location uuid, p_delta numeric)
returns void language plpgsql as $$
begin
  insert into stock_balances (product_id, lot_id, location_id, quantity)
  values (p_product, p_lot, p_location, p_delta)
  on conflict (product_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set quantity = stock_balances.quantity + excluded.quantity, updated_at = now();
exception when check_violation then
  raise exception 'Stock insuficiente: la operación dejaría stock negativo';
end $$;

-- registra un movimiento y actualiza balances en la misma transacción.
-- idempotente: misma idempotency_key devuelve el movimiento existente sin duplicar.
create function apply_movement(
  p_type movement_type,
  p_product uuid,
  p_lot uuid,
  p_quantity numeric,
  p_from uuid,
  p_to uuid,
  p_actor text,
  p_reason text default null,
  p_notes text default null,
  p_entry uuid default null,
  p_reversal_of uuid default null,
  p_idem text default null
) returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_lot_status lot_status;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a 0';
  end if;
  if p_idem is not null then
    select id into v_id from inventory_movements where idempotency_key = p_idem;
    if found then return v_id; end if;
  end if;
  if p_lot is not null and p_type in ('SALE','WHOLESALE_SALE') then
    select status into v_lot_status from lots where id = p_lot;
    if v_lot_status is distinct from 'ACTIVE' then
      raise exception 'El lote no está liberado (estado: %). No puede venderse.', v_lot_status;
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
  -- carrera entre dos requests con la misma clave: devolver el ya creado
  if p_idem is not null then
    select id into v_id from inventory_movements where idempotency_key = p_idem;
    if found then return v_id; end if;
  end if;
  raise;
end $$;

-- ingreso de stock completo: documento + líneas + lotes + movimientos, todo o nada.
-- p_lines: [{product_id, lot_code, expires_on, quantity, unit_cost, total_cost, location_id}]
create function create_stock_entry(
  p_entry_date date,
  p_supplier uuid,
  p_remito text,
  p_invoice text,
  p_notes text,
  p_actor text,
  p_idem text,
  p_lines jsonb
) returns uuid language plpgsql as $$
declare
  v_entry uuid;
  l jsonb;
  v_lot uuid;
  v_product uuid;
  v_qty numeric;
  v_loc uuid;
  v_unit numeric;
  v_total numeric;
  v_i int := 0;
begin
  if p_idem is not null then
    select id into v_entry from stock_entries where idempotency_key = p_idem;
    if found then return v_entry; end if;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'El ingreso necesita al menos una línea';
  end if;
  insert into stock_entries (entry_date, supplier_id, remito, invoice, notes, actor, idempotency_key)
  values (coalesce(p_entry_date, current_date), p_supplier, p_remito, p_invoice, p_notes, p_actor, p_idem)
  returning id into v_entry;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    v_product := (l->>'product_id')::uuid;
    v_qty := (l->>'quantity')::numeric;
    v_loc := (l->>'location_id')::uuid;
    v_unit := nullif(l->>'unit_cost','')::numeric;
    v_total := nullif(l->>'total_cost','')::numeric;
    if v_unit is null and v_total is not null and v_qty > 0 then
      v_unit := round(v_total / v_qty, 2);
    elsif v_total is null and v_unit is not null then
      v_total := round(v_unit * v_qty, 2);
    end if;
    v_lot := null;
    if nullif(l->>'lot_code','') is not null then
      insert into lots (product_id, code, expires_on)
      values (v_product, l->>'lot_code', nullif(l->>'expires_on','')::date)
      on conflict (product_id, code) do update set code = excluded.code
      returning id into v_lot;
    end if;
    insert into stock_entry_lines (entry_id, product_id, lot_id, location_id, quantity, unit_cost, total_cost)
    values (v_entry, v_product, v_lot, v_loc, v_qty, v_unit, v_total);
    perform apply_movement(
      'RECEIPT', v_product, v_lot, v_qty, null, v_loc, p_actor,
      'Ingreso de stock', null, v_entry, null,
      case when p_idem is not null then p_idem || ':linea:' || v_i else null end
    );
  end loop;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'stock_entry:create', 'stock_entries', v_entry,
          jsonb_build_object('lines', jsonb_array_length(p_lines), 'remito', p_remito));
  return v_entry;
exception when unique_violation then
  if p_idem is not null then
    select id into v_entry from stock_entries where idempotency_key = p_idem;
    if found then return v_entry; end if;
  end if;
  raise;
end $$;

-- reversión: compensa un movimiento sin borrarlo, invirtiendo origen/destino
create function reverse_movement(p_movement uuid, p_actor text, p_reason text)
returns uuid language plpgsql as $$
declare m inventory_movements%rowtype;
begin
  select * into m from inventory_movements where id = p_movement;
  if not found then raise exception 'Movimiento inexistente'; end if;
  if exists (select 1 from inventory_movements where reversal_of = p_movement) then
    raise exception 'Este movimiento ya fue revertido';
  end if;
  return apply_movement(
    'REVERSAL', m.product_id, m.lot_id, m.quantity,
    m.to_location_id, m.from_location_id,
    p_actor, coalesce(p_reason, 'Reversión'), 'Revierte movimiento ' || p_movement,
    null, p_movement, null
  );
end $$;

-- las funciones solo pueden ejecutarse con service_role (servidor)
revoke execute on function forbid_change() from public, anon, authenticated;
revoke execute on function _adjust_balance(uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function apply_movement(movement_type, uuid, uuid, numeric, uuid, uuid, text, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function create_stock_entry(date, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function reverse_movement(uuid, text, text) from public, anon, authenticated;
