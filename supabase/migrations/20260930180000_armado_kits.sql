-- Armado físico de kits: consume los componentes (FEFO) y suma stock del kit
-- en la misma ubicación, todo en una transacción. Desarmar hace lo inverso.

alter type movement_type add value if not exists 'KIT_ASSEMBLY';
alter type movement_type add value if not exists 'KIT_DISASSEMBLY';

create function assemble_kits(
  p_kit uuid,
  p_qty numeric,
  p_location uuid,
  p_actor text,
  p_idem text
) returns void language plpgsql as $$
declare c record; v_name text;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
  select name into v_name from products where id = p_kit and type = 'KIT';
  if v_name is null then raise exception 'El producto no es un kit'; end if;
  if not exists (select 1 from kit_components where kit_id = p_kit) then
    raise exception 'El kit "%" no tiene componentes definidos todavía', v_name;
  end if;
  if p_idem is not null and exists (
    select 1 from inventory_movements where idempotency_key = p_idem || ':kit'
  ) then
    return; -- armado ya procesado (doble click / reintento)
  end if;
  for c in select component_id, quantity from kit_components where kit_id = p_kit loop
    perform _consume_fefo(c.component_id, p_location, null, c.quantity * p_qty,
      'KIT_ASSEMBLY', p_actor, 'Armado de ' || v_name || ' x' || p_qty, null,
      case when p_idem is not null then p_idem || ':c:' || c.component_id else null end);
  end loop;
  perform apply_movement('KIT_ASSEMBLY', p_kit, null, p_qty, null, p_location,
    p_actor, 'Armado de ' || v_name || ' x' || p_qty, null, null, null,
    case when p_idem is not null then p_idem || ':kit' else null end);
end $$;

create function disassemble_kits(
  p_kit uuid,
  p_qty numeric,
  p_location uuid,
  p_actor text,
  p_idem text
) returns void language plpgsql as $$
declare c record; v_name text;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
  select name into v_name from products where id = p_kit and type = 'KIT';
  if v_name is null then raise exception 'El producto no es un kit'; end if;
  if p_idem is not null and exists (
    select 1 from inventory_movements where idempotency_key = p_idem || ':kit'
  ) then
    return;
  end if;
  -- el kit sale del stock (falla si no hay suficientes armados)
  perform apply_movement('KIT_DISASSEMBLY', p_kit, null, p_qty, p_location, null,
    p_actor, 'Desarmado de ' || v_name || ' x' || p_qty, null, null, null,
    case when p_idem is not null then p_idem || ':kit' else null end);
  -- los componentes vuelven (sin lote: al desarmar se pierde la trazabilidad de lote)
  for c in select component_id, quantity from kit_components where kit_id = p_kit loop
    perform apply_movement('KIT_DISASSEMBLY', c.component_id, null, c.quantity * p_qty,
      null, p_location, p_actor, 'Desarmado de ' || v_name || ' x' || p_qty,
      'Vuelve sin lote asignado', null, null,
      case when p_idem is not null then p_idem || ':c:' || c.component_id else null end);
  end loop;
end $$;

revoke execute on function assemble_kits(uuid, numeric, uuid, text, text) from public, anon, authenticated;
revoke execute on function disassemble_kits(uuid, numeric, uuid, text, text) from public, anon, authenticated;
