-- Conteos parciales: se puede abrir un conteo solo de algunos tipos de producto
-- y cerrarlo aunque haya líneas sin contar. Las líneas sin contar NO se ajustan
-- al aprobar (review_count ya ignora counted null).

alter table inventory_counts add column product_types text[]; -- null = todos los tipos

drop function open_count(uuid, text);
create function open_count(p_location uuid, p_actor text, p_types text[] default null) returns uuid
language plpgsql as $$
declare v_id uuid; v_n int;
begin
  if exists (select 1 from inventory_counts where location_id = p_location and status = 'OPEN') then
    raise exception 'Ya hay un conteo abierto para esta ubicación. Cerralo antes de abrir otro.';
  end if;
  insert into inventory_counts (location_id, opened_by, product_types)
  values (p_location, p_actor, nullif(p_types, '{}'))
  returning id into v_id;
  insert into inventory_count_lines (count_id, product_id, lot_id, expected)
  select v_id, b.product_id, b.lot_id, b.quantity
    from stock_balances b
    join products p on p.id = b.product_id
   where b.location_id = p_location
     and b.quantity > 0
     and (p_types is null or cardinality(p_types) = 0 or p.type::text = any (p_types));
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No hay stock esperado en esta ubicación para los tipos elegidos: nada para contar.';
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'count:open', 'inventory_counts', v_id,
          jsonb_build_object('location', p_location, 'lines', v_n, 'types', p_types));
  return v_id;
end $$;

-- cerrar: alcanza con al menos una línea contada; las demás quedan "sin contar"
create or replace function close_count(p_count uuid, p_actor text) returns void
language plpgsql as $$
declare v_status count_status; v_pend int; v_contadas int;
begin
  select status into v_status from inventory_counts where id = p_count;
  if v_status is null then raise exception 'Conteo inexistente'; end if;
  if v_status <> 'OPEN' then raise exception 'El conteo ya fue cerrado.'; end if;
  select count(*) filter (where counted is null), count(*) filter (where counted is not null)
    into v_pend, v_contadas
    from inventory_count_lines where count_id = p_count;
  if v_contadas = 0 then
    raise exception 'Contá al menos un producto antes de cerrar el conteo.';
  end if;
  update inventory_counts set status = 'CLOSED', closed_by = p_actor, closed_at = now()
   where id = p_count;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'count:close', 'inventory_counts', p_count,
          jsonb_build_object('contadas', v_contadas, 'sin_contar', v_pend));
end $$;

revoke execute on function open_count(uuid, text, text[]) from public, anon, authenticated;
revoke execute on function close_count(uuid, text) from public, anon, authenticated;
