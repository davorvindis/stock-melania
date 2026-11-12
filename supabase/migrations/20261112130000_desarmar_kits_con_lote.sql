-- Desarmar kits indicando a qué lote vuelve cada componente. La pantalla sugiere los lotes
-- según con qué se armaron los últimos kits, y quien desarma lo confirma o corrige (ej. una
-- clienta devuelve kits de dos tandas distintas). Lo que vuelve "sin lote" queda como antes.
-- p_lotes: [{ "component_id": uuid, "lot_id": uuid | null, "quantity": numeric }, ...]
-- Por cada componente del kit la suma tiene que dar cantidad del componente × kits.

create function disassemble_kits_lotes(
  p_kit uuid,
  p_qty numeric,
  p_location uuid,
  p_lotes jsonb,
  p_actor text,
  p_idem text
) returns void language plpgsql as $$
declare
  c record;
  r record;
  v_name text;
  v_total numeric;
  v_j int;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
  select name into v_name from products where id = p_kit and type = 'KIT';
  if v_name is null then raise exception 'El producto no es un kit'; end if;
  if jsonb_typeof(p_lotes) <> 'array' then raise exception 'Faltan los lotes de los componentes'; end if;
  if p_idem is not null and exists (
    select 1 from inventory_movements where idempotency_key = p_idem || ':kit'
  ) then
    return; -- desarmado ya procesado (doble click / reintento)
  end if;

  -- validación: cada componente reparte exactamente lo que trae el kit, en lotes suyos
  for c in select k.component_id, k.quantity, p.name from kit_components k join products p on p.id = k.component_id where k.kit_id = p_kit loop
    select coalesce(sum((e->>'quantity')::numeric), 0) into v_total
      from jsonb_array_elements(p_lotes) e
     where (e->>'component_id')::uuid = c.component_id;
    if v_total <> c.quantity * p_qty then
      raise exception 'Los lotes de "%" suman % y tienen que sumar %', c.name, trim_scale(v_total), trim_scale(c.quantity * p_qty);
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_lotes) e
     where not exists (select 1 from kit_components k where k.kit_id = p_kit and k.component_id = (e->>'component_id')::uuid)
        or (e->>'quantity')::numeric < 0
        or (nullif(e->>'lot_id', '') is not null and not exists (
              select 1 from lots l where l.id = (e->>'lot_id')::uuid and l.product_id = (e->>'component_id')::uuid))
  ) then
    raise exception 'Hay un lote que no corresponde a un componente del kit';
  end if;

  -- el kit sale del stock (falla si no hay suficientes armados)
  perform apply_movement('KIT_DISASSEMBLY', p_kit, null, p_qty, p_location, null,
    p_actor, 'Desarmado de ' || v_name || ' x' || p_qty, null, null, null,
    case when p_idem is not null then p_idem || ':kit' else null end);

  -- los componentes vuelven al lote confirmado
  v_j := 0;
  for r in
    select (e->>'component_id')::uuid as component_id, nullif(e->>'lot_id', '')::uuid as lot_id, sum((e->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_lotes) e
     group by 1, 2
    having sum((e->>'quantity')::numeric) > 0
     order by 1, 2
  loop
    v_j := v_j + 1;
    perform apply_movement('KIT_DISASSEMBLY', r.component_id, r.lot_id, r.quantity,
      null, p_location, p_actor, 'Desarmado de ' || v_name || ' x' || p_qty,
      case when r.lot_id is null then 'Vuelve sin lote asignado' else 'Lote confirmado al desarmar' end, null, null,
      case when p_idem is not null then p_idem || ':c:' || r.component_id || ':' || v_j else null end);
  end loop;
end $$;

revoke execute on function disassemble_kits_lotes(uuid, numeric, uuid, jsonb, text, text) from public, anon, authenticated;
