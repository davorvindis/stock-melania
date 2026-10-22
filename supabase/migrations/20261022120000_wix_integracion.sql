-- Integración Wix: pedidos del canal, reservas (pedido web pagado → reservado en
-- Depósito), procesado con responsable (egreso real), ventas POS (Store, al
-- instante), eventos de integración (idempotencia + cola) y pulsador ON/OFF.
-- Disponible = stock vendible (lotes ACTIVE, no caja cerrada) − reservado.

-- ───────────── configuración (pulsador y parámetros) ─────────────
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table app_settings enable row level security;

insert into app_settings (key, value) values ('wix', jsonb_build_object(
  'enabled', false,
  'paused_reason', null, 'paused_at', null, 'paused_by', null,
  'activated_at', null,            -- pedidos anteriores a esta fecha se ignoran
  'sync_inventory', false,         -- publicar disponible a Wix
  'location_deposito', (select id from locations where name = 'Depósito'),
  'location_store', (select id from locations where name = 'Store'),
  'last_poll_at', null,
  'catalog_version', null
));

create function wix_settings() returns jsonb language sql stable as $$
  select value from app_settings where key = 'wix'
$$;

create function wix_set_enabled(p_enabled boolean, p_actor text, p_reason text default null)
returns void language plpgsql as $$
begin
  update app_settings
     set value = value || jsonb_build_object(
           'enabled', p_enabled,
           'paused_reason', case when p_enabled then null else p_reason end,
           'paused_at', case when p_enabled then null else now() end,
           'paused_by', case when p_enabled then null else p_actor end,
           'activated_at', case when p_enabled and value->>'activated_at' is null then now()::text
                                else value->>'activated_at' end),
         updated_at = now(), updated_by = p_actor
   where key = 'wix';
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_enabled then 'wix:enable' else 'wix:disable' end,
          'app_settings', null, jsonb_build_object('reason', p_reason));
end $$;

create function wix_update_settings(p_patch jsonb, p_actor text)
returns void language plpgsql as $$
begin
  update app_settings set value = value || p_patch, updated_at = now(), updated_by = p_actor
   where key = 'wix';
end $$;

-- ───────────── eventos de integración (idempotencia, cola, errores) ─────────────
create type integration_event_status as enum ('PENDING','DONE','ERROR','SKIPPED','PAUSED');

create table integration_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'WIX',
  event_id text not null,
  event_type text not null,
  entity_id text,
  payload jsonb,
  source text not null default 'webhook',   -- webhook | poll | manual
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status integration_event_status not null default 'PENDING',
  attempts int not null default 0,
  result text,
  error text,
  unique (channel, event_id)
);
create index idx_integration_events_status on integration_events (status, received_at);
create index idx_integration_events_entity on integration_events (entity_id);
alter table integration_events enable row level security;

-- ───────────── pedidos del canal ─────────────
create type channel_order_state as enum
  ('NEW','RESERVED','PARTIAL','PROCESSED','RELEASED','CANCELED','IGNORED');

create table channel_orders (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'WIX',
  external_id text not null,
  number text,
  channel_type text,                 -- WEB | POS | BACKOFFICE_MERCHANT | ...
  customer text,
  email text,
  wix_status text,                   -- APPROVED | CANCELED | ...
  payment_status text,               -- PAID | NOT_PAID | FULLY_REFUNDED | ...
  fulfillment_status text,           -- NOT_FULFILLED | PARTIALLY_FULFILLED | FULFILLED
  state channel_order_state not null default 'NEW',
  location_id uuid references locations(id),
  total numeric(14,2),
  currency text,
  ordered_at timestamptz,
  paid_at timestamptz,
  processed_at timestamptz,
  processed_by_id uuid references profiles(id),
  processed_by text,
  review_reason text,                -- aviso pendiente de revisión (null = nada)
  wix_fulfilled boolean not null default false,  -- lo marcaron procesado en Wix
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_id)
);
create index idx_channel_orders_state on channel_orders (state, paid_at);
create index idx_channel_orders_review on channel_orders (review_reason) where review_reason is not null;

create table channel_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references channel_orders(id) on delete cascade,
  external_line_id text not null,
  external_sku text,
  name text,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(14,2),
  resolved boolean not null default false,   -- tiene equivalencia
  note text,
  unique (order_id, external_line_id)
);

create type reservation_status as enum ('ACTIVE','CONSUMED','RELEASED');

create table reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references channel_orders(id) on delete cascade,
  item_id uuid not null references channel_order_items(id) on delete cascade,
  product_id uuid not null references products(id),
  location_id uuid not null references locations(id),
  per_unit numeric(12,3) not null check (per_unit > 0),  -- unidades por 1 unidad del ítem
  quantity numeric(12,3) not null check (quantity > 0),  -- total reservado
  consumed numeric(12,3) not null default 0,
  released numeric(12,3) not null default 0,
  sale_type movement_type not null default 'SALE',
  status reservation_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, product_id),
  check (consumed + released <= quantity)
);
create index idx_reservations_active on reservations (product_id, location_id) where status = 'ACTIVE';

-- quién armó/despachó qué (cada procesado, total o parcial)
create table channel_order_fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references channel_orders(id) on delete cascade,
  item_id uuid not null references channel_order_items(id) on delete cascade,
  quantity numeric(12,3) not null check (quantity > 0),
  batch_id uuid not null,
  actor_id uuid references profiles(id),
  actor text not null,
  created_at timestamptz not null default now(),
  wix_synced boolean not null default false,   -- fulfillment creado en Wix
  wix_error text
);
create index idx_cof_batch on channel_order_fulfillments (batch_id);
create index idx_cof_pending on channel_order_fulfillments (wix_synced) where not wix_synced;

-- cola de productos cuyo disponible hay que publicar a Wix
create table wix_sync_queue (
  product_id uuid primary key references products(id) on delete cascade,
  queued_at timestamptz not null default now()
);

alter table channel_orders enable row level security;
alter table channel_order_items enable row level security;
alter table reservations enable row level security;
alter table channel_order_fulfillments enable row level security;
alter table wix_sync_queue enable row level security;

create function _touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger trg_channel_orders_touch before update on channel_orders
  for each row execute function _touch_updated_at();
create trigger trg_reservations_touch before update on reservations
  for each row execute function _touch_updated_at();

create function _enqueue_wix_sync() returns trigger language plpgsql as $$
begin
  insert into wix_sync_queue (product_id) values (new.product_id) on conflict do nothing;
  return new;
end $$;
create trigger trg_balances_wix_sync after insert or update on stock_balances
  for each row execute function _enqueue_wix_sync();
create trigger trg_reservations_wix_sync after insert or update on reservations
  for each row execute function _enqueue_wix_sync();

-- ───────────── reservado y disponible ─────────────
create function reserved_qty(p_product uuid, p_location uuid) returns numeric
language sql stable as $$
  select coalesce(sum(quantity - consumed - released), 0)
    from reservations
   where product_id = p_product and location_id = p_location and status = 'ACTIVE'
$$;

-- stock vendible en una ubicación: sin lote, o lote ACTIVE y no en caja cerrada
create function sellable_on_hand(p_product uuid, p_location uuid) returns numeric
language sql stable as $$
  select coalesce(sum(b.quantity), 0)
    from stock_balances b
    left join lots l on l.id = b.lot_id
   where b.product_id = p_product and b.location_id = p_location
     and (b.lot_id is null or (l.status = 'ACTIVE' and not l.sealed))
$$;

create function available_stock(p_product uuid, p_location uuid) returns numeric
language sql stable as $$
  select sellable_on_hand(p_product, p_location) - reserved_qty(p_product, p_location)
$$;

-- por producto y ubicación: físico, vendible, reservado, disponible
create view v_stock_disponible as
  with bal as (
    select b.product_id, b.location_id,
           sum(b.quantity) as on_hand,
           sum(case when b.lot_id is null or (l.status = 'ACTIVE' and not l.sealed) then b.quantity else 0 end) as sellable
      from stock_balances b
      left join lots l on l.id = b.lot_id
      join locations loc on loc.id = b.location_id
     where b.quantity > 0 and not loc.is_quarantine
     group by b.product_id, b.location_id
  ), res as (
    select product_id, location_id, sum(quantity - consumed - released) as reserved
      from reservations where status = 'ACTIVE'
     group by product_id, location_id
  )
  select coalesce(bal.product_id, res.product_id) as product_id,
         coalesce(bal.location_id, res.location_id) as location_id,
         coalesce(bal.on_hand, 0) as on_hand,
         coalesce(bal.sellable, 0) as sellable,
         coalesce(res.reserved, 0) as reserved,
         coalesce(bal.sellable, 0) - coalesce(res.reserved, 0) as available
    from bal full join res on res.product_id = bal.product_id and res.location_id = bal.location_id;

-- ───────────── apply_movement: respeta reservas ─────────────
-- Igual que antes + si hay unidades reservadas por pedidos web en la ubicación
-- de origen, no deja sacar stock vendible por debajo de lo reservado.
-- Exentos: conteos, reversiones, asignación de lote y pérdidas (rotura/vencido)
-- y cuarentena, que son hechos físicos; si dejan el disponible negativo, el
-- Dashboard avisa.
create or replace function apply_movement(
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
    v_reserved := reserved_qty(p_product, p_from);
    if v_reserved > 0 then
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
end $$;

-- ───────────── pedidos: alta/actualización desde Wix ─────────────
-- p_order (normalizado por el servidor): {external_id, number, channel_type, customer,
--   email, wix_status, payment_status, fulfillment_status, total, currency, ordered_at,
--   raw, items:[{line_id, sku, name, quantity, unit_price}]}
create function wix_upsert_order(p_order jsonb) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  it jsonb;
begin
  insert into channel_orders (channel, external_id, number, channel_type, customer, email,
    wix_status, payment_status, fulfillment_status, total, currency, ordered_at, raw)
  values ('WIX', p_order->>'external_id', p_order->>'number', p_order->>'channel_type',
    p_order->>'customer', p_order->>'email', p_order->>'wix_status', p_order->>'payment_status',
    p_order->>'fulfillment_status', (p_order->>'total')::numeric, p_order->>'currency',
    (p_order->>'ordered_at')::timestamptz, p_order->'raw')
  on conflict (channel, external_id) do update
     set number = excluded.number, channel_type = excluded.channel_type,
         customer = coalesce(excluded.customer, channel_orders.customer),
         email = coalesce(excluded.email, channel_orders.email),
         wix_status = excluded.wix_status, payment_status = excluded.payment_status,
         fulfillment_status = excluded.fulfillment_status,
         total = coalesce(excluded.total, channel_orders.total),
         currency = coalesce(excluded.currency, channel_orders.currency),
         ordered_at = coalesce(excluded.ordered_at, channel_orders.ordered_at),
         raw = excluded.raw
  returning id into v_id;
  for it in select * from jsonb_array_elements(coalesce(p_order->'items', '[]'::jsonb)) loop
    insert into channel_order_items (order_id, external_line_id, external_sku, name, quantity, unit_price)
    values (v_id, it->>'line_id', nullif(trim(it->>'sku'), ''), it->>'name',
            (it->>'quantity')::numeric, (it->>'unit_price')::numeric)
    on conflict (order_id, external_line_id) do update
       set external_sku = excluded.external_sku, name = excluded.name,
           quantity = excluded.quantity, unit_price = excluded.unit_price;
  end loop;
  return v_id;
end $$;

create function _wix_sale_type(p_sku text) returns movement_type language sql immutable as $$
  select case when upper(coalesce(p_sku, '')) ~ '(^|-)MAY(-|$)' then 'WHOLESALE_SALE'::movement_type
              else 'SALE'::movement_type end
$$;

create function _wix_append_review(p_order uuid, p_text text) returns void language plpgsql as $$
begin
  update channel_orders
     set review_reason = case when review_reason is null then p_text
                              when position(p_text in review_reason) > 0 then review_reason
                              else review_reason || ' · ' || p_text end
   where id = p_order;
end $$;

-- ───────────── reservar (pedido web pagado) ─────────────
-- Idempotente: cada ítem × producto reserva una sola vez. Devuelve un código.
create function wix_reserve_order(p_order_id uuid, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders;
  it record;
  r record;
  v_loc uuid := (wix_settings()->>'location_deposito')::uuid;
  v_act timestamptz := (wix_settings()->>'activated_at')::timestamptz;
  v_any boolean := false;
  v_missing text[] := '{}';
  v_short text[] := '{}';
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if o.state in ('PROCESSED','PARTIAL','RELEASED','CANCELED') then return 'noop:' || o.state; end if;
  if o.state = 'IGNORED' then return 'ignored'; end if;
  if v_act is not null and o.ordered_at is not null and o.ordered_at < v_act then
    update channel_orders set state = 'IGNORED', review_reason = null where id = p_order_id;
    return 'ignored';
  end if;
  if v_loc is null then raise exception 'Falta configurar la ubicación Depósito para Wix'; end if;

  for it in select * from channel_order_items where order_id = p_order_id loop
    if it.external_sku is null then
      update channel_order_items set resolved = false, note = 'Sin SKU' where id = it.id;
      v_missing := v_missing || coalesce(it.name, '?');
      continue;
    end if;
    if not exists (select 1 from resolve_channel_sku('WIX', it.external_sku)) then
      update channel_order_items set resolved = false, note = 'SKU sin equivalencia' where id = it.id;
      v_missing := v_missing || it.external_sku;
      continue;
    end if;
    update channel_order_items set resolved = true, note = null where id = it.id;
    for r in select * from resolve_channel_sku('WIX', it.external_sku) loop
      insert into reservations (order_id, item_id, product_id, location_id, per_unit, quantity, sale_type)
      values (p_order_id, it.id, r.product_id, v_loc, r.quantity, r.quantity * it.quantity,
              _wix_sale_type(it.external_sku))
      on conflict (item_id, product_id) do nothing;
      v_any := true;
      if available_stock(r.product_id, v_loc) < 0 then
        v_short := v_short || r.name;
      end if;
    end loop;
  end loop;

  update channel_orders
     set state = case when v_any then 'RESERVED'::channel_order_state else state end,
         location_id = v_loc,
         paid_at = coalesce(paid_at, now()),
         review_reason = null
   where id = p_order_id;
  if array_length(v_missing, 1) > 0 then
    perform _wix_append_review(p_order_id, 'Sin equivalencia: ' || array_to_string(v_missing, ', '));
  end if;
  if array_length(v_short, 1) > 0 then
    perform _wix_append_review(p_order_id, 'Falta stock en Depósito: ' || array_to_string(v_short, ', '));
  end if;
  if o.wix_fulfilled then
    perform _wix_append_review(p_order_id, 'Marcado procesado en Wix: confirmá en Melania quién lo armó');
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:reserve', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'missing', v_missing, 'short', v_short));
  return case when v_any then 'reserved' else 'nothing' end;
end $$;

-- ───────────── venta POS (Store, al instante) ─────────────
create function wix_pos_sale(p_order_id uuid, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders;
  it record;
  r record;
  v_loc uuid := (wix_settings()->>'location_store')::uuid;
  v_act timestamptz := (wix_settings()->>'activated_at')::timestamptz;
  v_missing text[] := '{}';
  v_failed text[] := '{}';
  v_any boolean := false;
  v_err text;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if o.state <> 'NEW' then return 'noop:' || o.state; end if;
  if v_act is not null and o.ordered_at is not null and o.ordered_at < v_act then
    update channel_orders set state = 'IGNORED' where id = p_order_id;
    return 'ignored';
  end if;
  if v_loc is null then raise exception 'Falta configurar la ubicación Store para Wix'; end if;

  for it in select * from channel_order_items where order_id = p_order_id loop
    if it.external_sku is null or not exists (select 1 from resolve_channel_sku('WIX', it.external_sku)) then
      update channel_order_items set resolved = false,
             note = case when it.external_sku is null then 'Sin SKU' else 'SKU sin equivalencia' end
       where id = it.id;
      v_missing := v_missing || coalesce(it.external_sku, it.name, '?');
      continue;
    end if;
    update channel_order_items set resolved = true, note = null where id = it.id;
    for r in select * from resolve_channel_sku('WIX', it.external_sku) loop
      begin
        perform _consume_fefo(r.product_id, v_loc, null, r.quantity * it.quantity,
          _wix_sale_type(it.external_sku), p_actor, 'Wix #' || coalesce(o.number, o.external_id),
          'Venta POS (Store)', 'wix:' || o.external_id || ':' || it.external_line_id || ':' || r.product_id);
        v_any := true;
      exception when others then
        v_err := sqlerrm;
        v_failed := v_failed || (r.name || ' (' || v_err || ')');
        update channel_order_items set note = v_err where id = it.id;
      end;
    end loop;
  end loop;

  update channel_orders
     set state = 'PROCESSED', location_id = v_loc, paid_at = coalesce(paid_at, now()),
         processed_at = now(), processed_by = 'Wix POS', review_reason = null
   where id = p_order_id;
  if array_length(v_missing, 1) > 0 then
    perform _wix_append_review(p_order_id, 'Sin equivalencia: ' || array_to_string(v_missing, ', '));
  end if;
  if array_length(v_failed, 1) > 0 then
    perform _wix_append_review(p_order_id, 'No se pudo descontar del Store: ' || array_to_string(v_failed, '; '));
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:pos_sale', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'missing', v_missing, 'failed', v_failed));
  return case when v_any then 'sold' else 'nothing' end;
end $$;

-- ───────────── procesar (egreso real con responsable) ─────────────
-- p_lines: [{item_id, quantity}] en unidades del ítem de Wix; null = todo lo pendiente.
-- Devuelve {batch_id, lines:[{line_id, quantity}]} para crear el fulfillment en Wix.
create function wix_process_order(p_order_id uuid, p_lines jsonb, p_actor_id uuid, p_actor text)
returns jsonb language plpgsql as $$
declare
  o channel_orders;
  it record;
  r record;
  v_units numeric;
  v_pending numeric;
  v_take numeric;
  v_batch uuid := gen_random_uuid();
  v_out jsonb := '[]'::jsonb;
  v_before numeric;
  v_left int;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if o.state not in ('RESERVED','PARTIAL') then
    raise exception 'El pedido no está reservado (estado: %)', o.state;
  end if;

  for it in
    select i.*,
           coalesce((select (l->>'quantity')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
                      where (l->>'item_id')::uuid = i.id), case when p_lines is null then null else 0 end) as asked
      from channel_order_items i where i.order_id = p_order_id and i.resolved
  loop
    -- unidades del ítem todavía reservadas (mínimo entre sus productos)
    select min(floor((quantity - consumed - released) / per_unit)) into v_pending
      from reservations where item_id = it.id and status = 'ACTIVE';
    v_pending := coalesce(v_pending, 0);
    v_units := case when it.asked is null then v_pending else least(it.asked, v_pending) end;
    if v_units <= 0 then continue; end if;
    if it.asked is not null and it.asked > v_pending then
      raise exception 'El ítem "%" tiene % pendientes, no %', it.name, trim_scale(v_pending), trim_scale(it.asked);
    end if;
    for r in select * from reservations where item_id = it.id and status = 'ACTIVE' for update loop
      v_take := r.per_unit * v_units;
      v_before := r.consumed;
      update reservations
         set consumed = consumed + v_take,
             status = case when consumed + v_take + released >= quantity then 'CONSUMED'::reservation_status else 'ACTIVE'::reservation_status end
       where id = r.id;
      perform _consume_fefo(r.product_id, r.location_id, null, v_take, r.sale_type, p_actor,
        'Wix #' || coalesce(o.number, o.external_id), 'Pedido web procesado por ' || p_actor,
        'wix:' || o.external_id || ':' || it.external_line_id || ':' || r.product_id || ':' || trim_scale(v_before));
    end loop;
    insert into channel_order_fulfillments (order_id, item_id, quantity, batch_id, actor_id, actor)
    values (p_order_id, it.id, v_units, v_batch, p_actor_id, p_actor);
    v_out := v_out || jsonb_build_object('line_id', it.external_line_id, 'quantity', v_units);
  end loop;

  if jsonb_array_length(v_out) = 0 then
    raise exception 'No hay unidades pendientes para procesar';
  end if;
  select count(*) into v_left from reservations where order_id = p_order_id and status = 'ACTIVE';
  update channel_orders
     set state = case when v_left = 0 then 'PROCESSED'::channel_order_state else 'PARTIAL'::channel_order_state end,
         processed_at = now(), processed_by_id = p_actor_id, processed_by = p_actor,
         review_reason = case when v_left = 0 and review_reason like 'Marcado procesado en Wix%' then null else review_reason end
   where id = p_order_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:process', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'lines', v_out, 'batch', v_batch));
  return jsonb_build_object('batch_id', v_batch, 'lines', v_out);
end $$;

-- ───────────── liberar (cancelado / reembolsado antes de procesar) ─────────────
create function wix_release_order(p_order_id uuid, p_reason text, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders;
  v_released int;
  v_consumed int;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if o.state in ('RELEASED','CANCELED','IGNORED') then return 'noop:' || o.state; end if;
  update reservations
     set released = quantity - consumed, status = 'RELEASED'
   where order_id = p_order_id and status = 'ACTIVE';
  get diagnostics v_released = row_count;
  select count(*) into v_consumed from reservations where order_id = p_order_id and consumed > 0;
  if v_consumed > 0 then
    -- ya salió mercadería: no se devuelve sola
    perform _wix_append_review(p_order_id, p_reason || ' después de procesar: si la clienta devuelve, cargá una devolución (RETURN_IN)');
    update channel_orders set state = case when o.state = 'NEW' then 'CANCELED'::channel_order_state else o.state end where id = p_order_id;
  else
    update channel_orders set state = case when v_released > 0 then 'RELEASED'::channel_order_state else 'CANCELED'::channel_order_state end,
           review_reason = null
     where id = p_order_id;
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:release', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'reason', p_reason, 'released', v_released, 'had_consumed', v_consumed > 0));
  return case when v_consumed > 0 then 'review' when v_released > 0 then 'released' else 'canceled' end;
end $$;

-- lo marcaron procesado en Wix (no desde Melania): no descuenta solo, avisa
create function wix_mark_fulfilled_externally(p_order_id uuid, p_actor text) returns void
language plpgsql as $$
begin
  update channel_orders set wix_fulfilled = true where id = p_order_id;
  if exists (select 1 from channel_orders where id = p_order_id and state in ('RESERVED','PARTIAL')) then
    perform _wix_append_review(p_order_id, 'Marcado procesado en Wix: confirmá en Melania quién lo armó');
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:fulfilled_externally', 'channel_orders', p_order_id, '{}'::jsonb);
end $$;

-- registrar/actualizar evento (idempotente por event_id). Devuelve id y si es nuevo.
create function wix_record_event(p_event_id text, p_event_type text, p_entity_id text,
  p_payload jsonb, p_source text, p_status integration_event_status)
returns table (id uuid, is_new boolean) language plpgsql as $$
declare v_id uuid;
begin
  insert into integration_events (event_id, event_type, entity_id, payload, source, status)
  values (p_event_id, p_event_type, p_entity_id, p_payload, p_source, p_status)
  on conflict (channel, event_id) do nothing
  returning integration_events.id into v_id;
  if v_id is not null then
    return query select v_id, true; return;
  end if;
  select e.id into v_id from integration_events e where e.channel = 'WIX' and e.event_id = p_event_id;
  return query select v_id, false;
end $$;


-- ids de Wix por SKU (para publicar el disponible); se completan con "Mapear catálogo"
alter table channel_skus add column wix_product_id text;
alter table channel_skus add column wix_variant_id text;
alter table channel_skus add column wix_inventory_item_id text;
alter table channel_skus add column wix_tracked boolean;        -- seguimiento de inventario activo en Wix
alter table channel_skus add column wix_mapped_at timestamptz;
alter table channel_skus add column wix_last_qty numeric(12,3); -- último disponible publicado
alter table channel_skus add column wix_last_sync_at timestamptz;
alter table channel_skus add column wix_sync_error text;

-- ───────────── permisos: solo service role ─────────────
revoke execute on function wix_settings() from public, anon, authenticated;
revoke execute on function wix_set_enabled(boolean, text, text) from public, anon, authenticated;
revoke execute on function wix_update_settings(jsonb, text) from public, anon, authenticated;
revoke execute on function reserved_qty(uuid, uuid) from public, anon, authenticated;
revoke execute on function sellable_on_hand(uuid, uuid) from public, anon, authenticated;
revoke execute on function available_stock(uuid, uuid) from public, anon, authenticated;
revoke execute on function wix_upsert_order(jsonb) from public, anon, authenticated;
revoke execute on function _wix_sale_type(text) from public, anon, authenticated;
revoke execute on function _wix_append_review(uuid, text) from public, anon, authenticated;
revoke execute on function wix_reserve_order(uuid, text) from public, anon, authenticated;
revoke execute on function wix_pos_sale(uuid, text) from public, anon, authenticated;
revoke execute on function wix_process_order(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function wix_release_order(uuid, text, text) from public, anon, authenticated;
revoke execute on function wix_mark_fulfilled_externally(uuid, text) from public, anon, authenticated;
revoke execute on function wix_record_event(text, text, text, jsonb, text, integration_event_status) from public, anon, authenticated;
revoke all on v_stock_disponible from public, anon, authenticated;
