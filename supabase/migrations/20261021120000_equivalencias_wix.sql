-- Equivalencias de SKU de canales de venta (Wix) → productos de Stock Melania.
-- Wix no acepta SKU repetidos y vende combos/packs, así que un SKU de Wix
-- puede descontar varios productos nuestros con cantidades (ej. -X10, COMBO-…).
-- No mueve stock: es solo el mapa que usa la integración.

create table channel_skus (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'WIX' check (channel in ('WIX')),
  external_sku text not null check (length(trim(external_sku)) > 0),
  label text,          -- nombre del producto en Wix
  option_label text,   -- variante en Wix (ej. "Talle M")
  active boolean not null default true,
  notes text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_sku)
);

create table channel_sku_lines (
  id uuid primary key default gen_random_uuid(),
  channel_sku_id uuid not null references channel_skus(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(12,3) not null check (quantity > 0),
  unique (channel_sku_id, product_id)
);
create index idx_channel_sku_lines_product on channel_sku_lines (product_id);

alter table channel_skus enable row level security;
alter table channel_sku_lines enable row level security;

-- crea o actualiza una equivalencia con sus productos, todo junto.
-- p_lines: [{product_id, quantity}]
create function save_channel_sku(
  p_id uuid,
  p_channel text,
  p_sku text,
  p_label text,
  p_option text,
  p_active boolean,
  p_notes text,
  p_lines jsonb,
  p_actor text
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Indicá al menos un producto a descontar';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l->>'quantity')::numeric, 0) <= 0) then
    raise exception 'Las cantidades deben ser mayores a 0';
  end if;
  if p_id is null then
    insert into channel_skus (channel, external_sku, label, option_label, active, notes, updated_by)
    values (p_channel, trim(p_sku), p_label, p_option, coalesce(p_active, true), p_notes, p_actor)
    returning id into v_id;
  else
    update channel_skus
       set external_sku = trim(p_sku), label = p_label, option_label = p_option,
           active = coalesce(p_active, true), notes = p_notes, updated_by = p_actor, updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Equivalencia inexistente'; end if;
    delete from channel_sku_lines where channel_sku_id = v_id;
  end if;
  insert into channel_sku_lines (channel_sku_id, product_id, quantity)
  select v_id, (l->>'product_id')::uuid, sum((l->>'quantity')::numeric)
    from jsonb_array_elements(p_lines) l
   group by (l->>'product_id')::uuid;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_id is null then 'channel_sku:create' else 'channel_sku:update' end,
          'channel_skus', v_id, jsonb_build_object('sku', trim(p_sku), 'lines', p_lines, 'active', p_active));
  return v_id;
exception when unique_violation then
  raise exception 'Ya existe una equivalencia con el SKU %', trim(p_sku);
end $$;

-- para la integración: qué productos y cuántos descuenta 1 unidad de un SKU del canal.
-- Devuelve vacío si el SKU no existe o está inactivo.
create function resolve_channel_sku(p_channel text, p_sku text)
returns table (product_id uuid, sku text, name text, quantity numeric, is_kit boolean)
language sql stable as $$
  select p.id, p.sku, p.name, l.quantity, p.type = 'KIT'
    from channel_skus c
    join channel_sku_lines l on l.channel_sku_id = c.id
    join products p on p.id = l.product_id
   where c.channel = p_channel and c.external_sku = trim(p_sku) and c.active
$$;

revoke execute on function save_channel_sku(uuid, text, text, text, text, boolean, text, jsonb, text) from public, anon, authenticated;
revoke execute on function resolve_channel_sku(text, text) from public, anon, authenticated;
