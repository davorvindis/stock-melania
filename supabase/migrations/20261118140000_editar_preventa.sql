-- Editar una preventa abierta (pendiente o parcial): datos (cliente, pedido, canal, fecha, notas),
-- cantidades de cada producto (nunca menos de lo ya entregado; en 0 se quita si no se entregó nada)
-- y productos nuevos (si ya estaba, se suma a la misma línea). Todo junto o nada, con auditoría.
-- No mueve stock: la preventa es solo lo anotado hasta que se entrega.
create function edit_preorder(p_id uuid, p_datos jsonb, p_lineas jsonb, p_nuevas jsonb, p_actor text)
returns jsonb language plpgsql as $$
declare
  pv record;
  a jsonb;
  l record;
  v_qty numeric;
  v_cambios jsonb := '[]'::jsonb;
  v_id uuid;
begin
  select * into pv from preorders where id = p_id for update;
  if pv.id is null then raise exception 'Preventa inexistente'; end if;
  if pv.status not in ('PENDIENTE', 'PARCIAL') then
    raise exception 'Solo se pueden editar preventas pendientes o parciales (esta está %)', lower(pv.status);
  end if;
  -- bloquea las líneas: que no se entregue algo mientras se edita
  perform 1 from preorder_lines where preorder_id = p_id for update;

  -- cantidades de las líneas existentes
  for a in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    select pl.*, p.name into l from preorder_lines pl join products p on p.id = pl.product_id
     where pl.id = (a->>'line_id')::uuid and pl.preorder_id = p_id;
    if l.id is null then raise exception 'Línea de preventa inexistente'; end if;
    v_qty := (a->>'quantity')::numeric;
    if v_qty is null or v_qty < 0 then raise exception '%: cantidad inválida', l.name; end if;
    if v_qty = l.quantity then continue; end if;
    if v_qty < l.delivered then
      raise exception '%: ya se entregaron %, no puede quedar en menos', l.name, l.delivered::float8;
    end if;
    if v_qty = 0 then
      if exists (select 1 from preorder_deliveries where line_id = l.id) then
        raise exception '%: tiene entregas, no se puede quitar', l.name;
      end if;
      delete from preorder_lines where id = l.id;
    else
      update preorder_lines set quantity = v_qty where id = l.id;
    end if;
    v_cambios := v_cambios || jsonb_build_object('producto', l.name, 'antes', l.quantity, 'despues', v_qty);
  end loop;

  -- productos nuevos
  for a in select * from jsonb_array_elements(coalesce(p_nuevas, '[]'::jsonb)) loop
    v_qty := (a->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'La cantidad de un producto nuevo debe ser mayor a 0'; end if;
    if not exists (select 1 from products where id = (a->>'product_id')::uuid and active and type <> 'KIT') then
      raise exception 'Producto inválido (inactivo o kit)';
    end if;
    select id into v_id from preorder_lines where preorder_id = p_id and product_id = (a->>'product_id')::uuid limit 1;
    if v_id is not null then
      update preorder_lines set quantity = quantity + v_qty where id = v_id;
    else
      insert into preorder_lines (preorder_id, product_id, quantity) values (p_id, (a->>'product_id')::uuid, v_qty);
    end if;
    v_cambios := v_cambios || jsonb_build_object('agregado', (select name from products where id = (a->>'product_id')::uuid), 'cantidad', v_qty);
  end loop;

  if not exists (select 1 from preorder_lines where preorder_id = p_id) then
    raise exception 'La preventa tiene que quedar con al menos un producto (para darla de baja, cancelala)';
  end if;

  update preorders set
    customer = coalesce(nullif(trim(p_datos->>'customer'), ''), customer),
    order_ref = nullif(trim(p_datos->>'order_ref'), ''),
    channel = coalesce(nullif(p_datos->>'channel', ''), channel),
    order_date = coalesce(nullif(p_datos->>'order_date', '')::date, order_date),
    notes = nullif(trim(p_datos->>'notes'), ''),
    status = case
      when not exists (select 1 from preorder_lines x where x.preorder_id = p_id and x.delivered < x.quantity) then 'ENTREGADA'
      when exists (select 1 from preorder_lines x where x.preorder_id = p_id and x.delivered > 0) then 'PARCIAL'
      else 'PENDIENTE' end,
    updated_at = now()
  where id = p_id;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'preorder:edit', 'preorders', p_id, jsonb_build_object(
    'antes', jsonb_build_object('cliente', pv.customer, 'pedido', pv.order_ref, 'canal', pv.channel, 'fecha', pv.order_date, 'notas', pv.notes),
    'despues', p_datos,
    'productos', v_cambios));
  return jsonb_build_object('cambios', jsonb_array_length(v_cambios));
end $$;

revoke execute on function edit_preorder(uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
