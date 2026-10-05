-- Asignación / reasignación de lote a stock existente.
-- Pasa stock de un renglón (sin lote, o de otro lote) a un lote con código y
-- vencimiento, en la misma ubicación. Queda en el ledger como par de
-- movimientos LOT_ASSIGNMENT (sale del origen / entra al lote): el total del
-- producto no cambia. Atómica, idempotente y con lock de filas.

alter type movement_type add value if not exists 'LOT_ASSIGNMENT';

create function assign_lot(
  p_product uuid,
  p_from_lot uuid,     -- null = stock sin lote
  p_location uuid,     -- null = todas las ubicaciones
  p_qty numeric,       -- null = todo lo que haya en el origen
  p_code text,
  p_expires date,
  p_actor text,
  p_idem text
) returns int language plpgsql as $$
declare
  v_code text := btrim(p_code);
  v_lot uuid;
  v_exp date;
  v_rest numeric := p_qty;
  v_take numeric;
  v_n int := 0;
  r record;
begin
  if v_code is null or v_code = '' then
    raise exception 'Indicá el número de lote';
  end if;
  if p_qty is not null and p_qty <= 0 then
    raise exception 'La cantidad debe ser mayor a 0';
  end if;
  if p_qty is not null and p_location is null then
    raise exception 'Para asignar una cantidad parcial elegí la ubicación';
  end if;
  if p_idem is not null and exists (
    select 1 from inventory_movements where idempotency_key = p_idem || ':1:in'
  ) then
    return 0;
  end if;

  -- lote destino: se crea si no existe; si existe, el vencimiento debe coincidir
  select id, expires_on into v_lot, v_exp
    from lots where product_id = p_product and code = v_code
     for update;
  if v_lot is null then
    insert into lots (product_id, code, expires_on)
    values (p_product, v_code, p_expires)
    returning id into v_lot;
  elsif p_expires is not null and v_exp is distinct from p_expires then
    if v_exp is null then
      update lots set expires_on = p_expires where id = v_lot;
    else
      raise exception 'El lote % ya existe con vencimiento %. Si está mal, corregilo desde la ficha del lote.',
        v_code, to_char(v_exp, 'DD/MM/YYYY');
    end if;
  end if;
  if v_lot is not distinct from p_from_lot then
    raise exception 'Ese stock ya está en el lote %', v_code;
  end if;

  for r in
    select location_id, quantity
      from stock_balances
     where product_id = p_product
       and lot_id is not distinct from p_from_lot
       and (p_location is null or location_id = p_location)
       and quantity > 0
     order by location_id
       for update
  loop
    exit when p_qty is not null and v_rest <= 0;
    v_take := case when p_qty is null then r.quantity else least(v_rest, r.quantity) end;
    v_n := v_n + 1;
    perform apply_movement('LOT_ASSIGNMENT', p_product, p_from_lot, v_take,
      r.location_id, null, p_actor, 'Asignación al lote ' || v_code, null, null, null,
      case when p_idem is not null then p_idem || ':' || v_n || ':out' else null end);
    perform apply_movement('LOT_ASSIGNMENT', p_product, v_lot, v_take,
      null, r.location_id, p_actor, 'Asignación al lote ' || v_code, null, null, null,
      case when p_idem is not null then p_idem || ':' || v_n || ':in' else null end);
    if p_qty is not null then
      v_rest := v_rest - v_take;
    end if;
  end loop;

  if v_n = 0 then
    raise exception 'No hay stock en el origen elegido para pasar al lote %', v_code;
  end if;
  if p_qty is not null and v_rest > 0 then
    raise exception 'Stock insuficiente en el origen: faltan % unidades', v_rest;
  end if;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'lot:assign', 'lots', v_lot,
          jsonb_build_object('product', p_product, 'from_lot', p_from_lot,
                             'location', p_location, 'quantity', p_qty, 'code', v_code));
  return v_n;
end $$;

-- una asignación son dos movimientos que se compensan: revertir uno solo
-- descuadraría el stock. Para corregir, se reasigna al lote correcto.
create or replace function reverse_movement(p_movement uuid, p_actor text, p_reason text)
returns uuid language plpgsql as $$
declare m inventory_movements%rowtype;
begin
  select * into m from inventory_movements where id = p_movement;
  if not found then raise exception 'Movimiento inexistente'; end if;
  if m.type::text = 'LOT_ASSIGNMENT' then
    raise exception 'Las asignaciones de lote no se revierten: reasigná el stock al lote correcto desde Lotes';
  end if;
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

revoke execute on function assign_lot(uuid, uuid, uuid, numeric, text, date, text, text) from public, anon, authenticated;
revoke execute on function reverse_movement(uuid, text, text) from public, anon, authenticated;
