-- Productos que vienen en blister/pack y se venden sueltos (ej. Monodosis Botox: el
-- laboratorio entrega blisters x4 y a veces se venden de a 1). Se siguen manejando como dos
-- productos; el blister dice en qué se separa y cuántas unidades trae, y "Separar" pasa
-- N blisters a N × factor unidades del MISMO lote y vencimiento, en un solo paso.

alter table products
  add column split_into_product_id uuid references products(id),
  add column split_factor numeric(12,3) check (split_factor > 0),
  add column split_label text,
  add constraint products_split_completo check (
    (split_into_product_id is null and split_factor is null)
    or (split_into_product_id is not null and split_factor is not null and split_into_product_id <> id));

create function split_product(p_product uuid, p_lot uuid, p_location uuid, p_qty numeric, p_actor text, p_idem text)
returns jsonb language plpgsql as $$
declare
  p products;
  d products;
  l lots;
  v_lot uuid;
  v_units numeric;
  v_motivo text;
begin
  if p_qty is null or p_qty <= 0 or p_qty <> trunc(p_qty) then raise exception 'Indicá cuántos se separan (número entero)'; end if;
  select * into p from products where id = p_product;
  if not found then raise exception 'Producto inexistente'; end if;
  if p.split_into_product_id is null then raise exception '"%" no está configurado para separarse en unidades', p.name; end if;
  select * into d from products where id = p.split_into_product_id;
  if p_idem is not null and exists (select 1 from inventory_movements where idempotency_key = p_idem || ':sale') then
    return jsonb_build_object('repeated', true);
  end if;

  -- el lote de las unidades: mismo código y vencimiento que el del blister
  if p_lot is not null then
    select * into l from lots where id = p_lot and product_id = p_product;
    if not found then raise exception 'El lote no es de este producto'; end if;
    select id into v_lot from lots where product_id = d.id and code = l.code;
    if v_lot is null then
      insert into lots (product_id, code, manufactured_on, expires_on, status, notes)
      values (d.id, l.code, l.manufactured_on, l.expires_on, l.status, 'Creado al separar ' || p.name)
      returning id into v_lot;
    end if;
  end if;

  v_units := p_qty * p.split_factor;
  v_motivo := 'Separado: ' || trim_scale(p_qty) || ' ' || coalesce(p.split_label, p.name) || ' → ' || trim_scale(v_units) || ' ' || d.name;
  -- sale el blister (falla si no alcanza, si está reservado o si la caja está cerrada)
  perform apply_movement('KIT_DISASSEMBLY', p.id, p_lot, p_qty, p_location, null, p_actor, v_motivo, null, null, null,
    case when p_idem is not null then p_idem || ':sale' end);
  perform apply_movement('KIT_DISASSEMBLY', d.id, v_lot, v_units, null, p_location, p_actor, v_motivo, null, null, null,
    case when p_idem is not null then p_idem || ':entra' end);
  return jsonb_build_object('separados', p_qty, 'unidades', v_units);
end $$;

revoke execute on function split_product(uuid, uuid, uuid, numeric, text, text) from public, anon, authenticated;

-- Monodosis Botox: el blister x4 se separa en 4 monodosis x1
update products b
   set split_into_product_id = u.id, split_factor = 4, split_label = 'blister x4'
  from products u
 where b.sku = 'MEL-MONOD-BOTOX-BLIST-X-4-UNIDA' and u.sku = 'MEL-MONOD-BOTOX-X-1-UNIDA';
