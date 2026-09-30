-- KITS (producto compuesto) + movimientos multi-producto atómicos.
-- Un KIT no tiene stock propio: al moverlo se descuentan sus componentes,
-- consumiendo lotes por vencimiento más próximo (FEFO) en la ubicación origen.

alter type product_type add value if not exists 'KIT';

create table kit_components (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references products(id) on delete cascade,
  component_id uuid not null references products(id),
  quantity numeric(12,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (kit_id, component_id),
  check (kit_id <> component_id)
);
alter table kit_components enable row level security;

-- consume stock de un producto en una ubicación eligiendo lotes FEFO
-- (vencimiento más próximo primero; solo lotes liberados). Puede partir
-- la cantidad entre varios lotes. Falla si no alcanza.
create function _consume_fefo(
  p_product uuid,
  p_from uuid,
  p_to uuid,
  p_qty numeric,
  p_type movement_type,
  p_actor text,
  p_reason text,
  p_notes text,
  p_idem_prefix text
) returns void language plpgsql as $$
declare
  r record;
  v_rest numeric := p_qty;
  v_take numeric;
  v_j int := 0;
begin
  for r in
    select b.lot_id, b.quantity, l.expires_on
      from stock_balances b
      left join lots l on l.id = b.lot_id
     where b.product_id = p_product
       and b.location_id = p_from
       and b.quantity > 0
       and (b.lot_id is null or l.status = 'ACTIVE')
     order by l.expires_on asc nulls last, b.quantity desc
       for update of b
  loop
    exit when v_rest <= 0;
    v_take := least(v_rest, r.quantity);
    v_j := v_j + 1;
    perform apply_movement(p_type, p_product, r.lot_id, v_take, p_from, p_to,
      p_actor, p_reason, p_notes, null, null,
      case when p_idem_prefix is not null then p_idem_prefix || ':' || v_j else null end);
    v_rest := v_rest - v_take;
  end loop;
  if v_rest > 0 then
    raise exception 'Stock insuficiente de "%": faltan % unidades en la ubicación de origen',
      (select name from products where id = p_product), v_rest;
  end if;
end $$;

-- movimiento multi-producto: todas las líneas en una sola transacción.
-- p_lines: [{product_id, lot_id, from_location_id, quantity, is_kit}]
-- Las líneas kit expanden sus componentes vía FEFO.
create function apply_movement_batch(
  p_type movement_type,
  p_to uuid,
  p_actor text,
  p_reason text,
  p_notes text,
  p_idem text,
  p_lines jsonb
) returns int language plpgsql as $$
declare
  l jsonb;
  c record;
  v_i int := 0;
  v_n int := 0;
  v_qty numeric;
  v_kit_name text;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'El movimiento necesita al menos un producto';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    v_qty := (l->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Línea %: la cantidad debe ser mayor a 0', v_i;
    end if;
    if coalesce((l->>'is_kit')::boolean, false) then
      select name into v_kit_name from products where id = (l->>'product_id')::uuid;
      if not exists (select 1 from kit_components where kit_id = (l->>'product_id')::uuid) then
        raise exception 'El kit "%" no tiene componentes definidos todavía', v_kit_name;
      end if;
      for c in
        select component_id, quantity from kit_components
         where kit_id = (l->>'product_id')::uuid
      loop
        perform _consume_fefo(c.component_id,
          (l->>'from_location_id')::uuid, p_to,
          c.quantity * v_qty, p_type, p_actor, p_reason,
          'Kit ' || v_kit_name || ' x' || v_qty,
          case when p_idem is not null then p_idem || ':l' || v_i || ':' || c.component_id else null end);
        v_n := v_n + 1;
      end loop;
    else
      perform apply_movement(p_type, (l->>'product_id')::uuid,
        nullif(l->>'lot_id','')::uuid, v_qty,
        (l->>'from_location_id')::uuid, p_to, p_actor, p_reason, p_notes,
        null, null,
        case when p_idem is not null then p_idem || ':l' || v_i else null end);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

revoke execute on function _consume_fefo(uuid, uuid, uuid, numeric, movement_type, text, text, text, text) from public, anon, authenticated;
revoke execute on function apply_movement_batch(movement_type, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
