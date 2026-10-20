-- "Caja cerrada": un lote recién ingresado puede quedar cerrado para que primero
-- se termine el lote anterior. Cuenta en el stock total, pero no se puede vender
-- ni sacar hasta que alguien lo abra. Conteos, ajustes y reversiones sí lo tocan.

alter table lots add column sealed boolean not null default false;
alter table lots add column opened_at timestamptz;
alter table lots add column opened_by text;

-- igual que antes + bloqueo de salidas de un lote cerrado
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
  if p_lot is not null and p_from is not null
     and p_type not in ('COUNT_ADJUSTMENT','REVERSAL','LOT_ASSIGNMENT') then
    select sealed, code into v_sealed, v_code from lots where id = p_lot;
    if v_sealed then
      raise exception 'El lote % está en caja cerrada: abrí la caja antes de sacar unidades.', v_code;
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

-- FEFO (kits): no consume lotes en caja cerrada
create or replace function _consume_fefo(
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
  v_cerrado numeric;
begin
  for r in
    select b.lot_id, b.quantity, l.expires_on
      from stock_balances b
      left join lots l on l.id = b.lot_id
     where b.product_id = p_product
       and b.location_id = p_from
       and b.quantity > 0
       and (b.lot_id is null or (l.status = 'ACTIVE' and not l.sealed))
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
    select coalesce(sum(b.quantity), 0) into v_cerrado
      from stock_balances b join lots l on l.id = b.lot_id
     where b.product_id = p_product and b.location_id = p_from and l.sealed;
    raise exception 'Stock insuficiente de "%": faltan % unidades en la ubicación de origen%',
      (select name from products where id = p_product), v_rest,
      case when v_cerrado > 0 then ' (hay ' || trim_scale(v_cerrado) || ' en caja cerrada: abrila primero)' else '' end;
  end if;
end $$;

-- ingreso: igual que antes + cada línea puede venir con "sealed" (caja cerrada)
create or replace function create_stock_entry(
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
  v_sealed boolean;
  v_con_stock numeric;
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
    v_sealed := coalesce((l->>'sealed')::boolean, false);
    if v_unit is null and v_total is not null and v_qty > 0 then
      v_unit := round(v_total / v_qty, 2);
    elsif v_total is null and v_unit is not null then
      v_total := round(v_unit * v_qty, 2);
    end if;
    v_lot := null;
    if v_sealed and nullif(l->>'lot_code','') is null then
      raise exception 'Línea %: para dejarla en caja cerrada indicá el número de lote', v_i;
    end if;
    if nullif(l->>'lot_code','') is not null then
      insert into lots (product_id, code, expires_on)
      values (v_product, l->>'lot_code', nullif(l->>'expires_on','')::date)
      on conflict (product_id, code) do update set code = excluded.code
      returning id into v_lot;
      if v_sealed then
        -- un lote que ya tiene unidades abiertas no se cierra (se trabarían también esas)
        select coalesce(sum(quantity), 0) into v_con_stock from stock_balances
         where lot_id = v_lot and quantity > 0;
        if v_con_stock > 0 and not (select sealed from lots where id = v_lot) then
          raise exception 'Línea %: el lote % ya tiene % unidades en uso; no puede quedar en caja cerrada. Usá otro número de lote o destildá la caja cerrada.',
            v_i, l->>'lot_code', trim_scale(v_con_stock);
        end if;
        update lots set sealed = true, opened_at = null, opened_by = null where id = v_lot;
      end if;
    end if;
    insert into stock_entry_lines (entry_id, product_id, lot_id, location_id, quantity, unit_cost, total_cost)
    values (v_entry, v_product, v_lot, v_loc, v_qty, v_unit, v_total);
    perform apply_movement(
      'RECEIPT', v_product, v_lot, v_qty, null, v_loc, p_actor,
      'Ingreso de stock', case when v_sealed then 'Caja cerrada' else null end, v_entry, null,
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

-- abrir (o volver a cerrar) la caja de un lote, con auditoría
create function set_lot_sealed(p_lot uuid, p_sealed boolean, p_actor text) returns void
language plpgsql as $$
declare v_old boolean;
begin
  select sealed into v_old from lots where id = p_lot for update;
  if v_old is null then raise exception 'Lote inexistente'; end if;
  if v_old = p_sealed then
    raise exception '%', case when p_sealed then 'La caja ya está cerrada.' else 'La caja ya está abierta.' end;
  end if;
  update lots
     set sealed = p_sealed,
         opened_at = case when p_sealed then null else now() end,
         opened_by = case when p_sealed then null else p_actor end
   where id = p_lot;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_sealed then 'lot:seal' else 'lot:open' end, 'lots', p_lot,
          jsonb_build_object('sealed', p_sealed));
end $$;

revoke execute on function apply_movement(movement_type, uuid, uuid, numeric, uuid, uuid, text, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function _consume_fefo(uuid, uuid, uuid, numeric, movement_type, text, text, text, text) from public, anon, authenticated;
revoke execute on function create_stock_entry(date, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function set_lot_sealed(uuid, boolean, text) from public, anon, authenticated;
