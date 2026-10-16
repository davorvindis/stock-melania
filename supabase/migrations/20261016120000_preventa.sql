-- Preventa: productos vendidos antes de tener stock. Cuando entra la mercadería
-- se reparte (primero las preventas más viejas) y cada entrega es una venta normal
-- del ledger (SALE / WHOLESALE_SALE), todo en una sola transacción.

create table preorders (
  id uuid primary key default gen_random_uuid(),
  customer text not null,
  order_ref text,                         -- N° de pedido
  channel text not null default 'MAYORISTA' check (channel in ('MAYORISTA', 'MINORISTA')),
  order_date date not null default current_date,
  status text not null default 'PENDIENTE' check (status in ('PENDIENTE', 'PARCIAL', 'ENTREGADA', 'CANCELADA')),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_preorders_status on preorders (status, order_date);

create table preorder_lines (
  id uuid primary key default gen_random_uuid(),
  preorder_id uuid not null references preorders(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(12,3) not null check (quantity > 0),
  delivered numeric(12,3) not null default 0 check (delivered >= 0),
  check (delivered <= quantity)
);
create index idx_preorder_lines_product on preorder_lines (product_id);

-- cada entrega: qué línea, con qué movimiento de venta y desde qué ingreso (si vino de uno)
create table preorder_deliveries (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references preorder_lines(id),
  movement_id uuid not null references inventory_movements(id),
  entry_id uuid references stock_entries(id),
  quantity numeric(12,3) not null check (quantity > 0),
  actor text,
  created_at timestamptz not null default now()
);

alter table preorders enable row level security;
alter table preorder_lines enable row level security;
alter table preorder_deliveries enable row level security;

-- entrega preventas. p_allocs: [{line_id, quantity, lot_id, location_id}]
-- Valida lo pendiente de cada línea, genera la venta desde esa ubicación/lote
-- (apply_movement impide stock negativo) y actualiza el estado de cada preventa.
create function fulfill_preorders(p_allocs jsonb, p_entry uuid, p_actor text, p_idem text)
returns int language plpgsql as $$
declare
  a jsonb;
  l record;
  v_qty numeric;
  v_mov uuid;
  v_i int := 0;
  v_tocadas uuid[] := '{}';
begin
  if p_allocs is null or jsonb_array_length(p_allocs) = 0 then
    raise exception 'No hay nada para entregar';
  end if;
  if p_idem is not null and exists (
    select 1 from inventory_movements where idempotency_key = p_idem || ':1'
  ) then
    return 0; -- reintento del mismo reparto
  end if;
  for a in select * from jsonb_array_elements(p_allocs) loop
    v_qty := (a->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then continue; end if;
    v_i := v_i + 1;
    select pl.*, p.customer, p.order_ref, p.channel, p.status as po_status
      into l
      from preorder_lines pl join preorders p on p.id = pl.preorder_id
     where pl.id = (a->>'line_id')::uuid
       for update of pl;
    if l.id is null then raise exception 'Línea de preventa inexistente'; end if;
    if l.po_status = 'CANCELADA' then raise exception 'La preventa de % está cancelada', l.customer; end if;
    if v_qty > l.quantity - l.delivered then
      raise exception 'A % le quedan % unidades pendientes y se quieren entregar %',
        l.customer, l.quantity - l.delivered, v_qty;
    end if;
    v_mov := apply_movement(
      case when l.channel = 'MINORISTA' then 'SALE' else 'WHOLESALE_SALE' end::movement_type,
      l.product_id, nullif(a->>'lot_id', '')::uuid, v_qty,
      (a->>'location_id')::uuid, null, p_actor,
      coalesce(l.order_ref, 'Preventa'),
      'Preventa: ' || l.customer,
      null, null,
      case when p_idem is not null then p_idem || ':' || v_i else null end);
    insert into preorder_deliveries (line_id, movement_id, entry_id, quantity, actor)
    values (l.id, v_mov, p_entry, v_qty, p_actor);
    update preorder_lines set delivered = delivered + v_qty where id = l.id;
    v_tocadas := array_append(v_tocadas, l.preorder_id);
  end loop;
  if v_i = 0 then raise exception 'No hay nada para entregar'; end if;

  update preorders p
     set status = case
           when not exists (select 1 from preorder_lines x where x.preorder_id = p.id and x.delivered < x.quantity)
             then 'ENTREGADA'
           else 'PARCIAL' end,
         updated_at = now()
   where p.id = any (v_tocadas);

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'preorder:fulfill', 'preorders', null,
          jsonb_build_object('entregas', v_i, 'ingreso', p_entry));
  return v_i;
end $$;

revoke execute on function fulfill_preorders(jsonb, uuid, text, text) from public, anon, authenticated;
