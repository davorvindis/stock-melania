-- Ajuste directo de stock: fija la cantidad real de un renglón generando el
-- movimiento COUNT_ADJUSTMENT por la diferencia (nunca se pisa el número a mano).
-- Lock de fila para que la diferencia se calcule sin carreras.

create function adjust_stock_to(
  p_product uuid,
  p_lot uuid,
  p_location uuid,
  p_new numeric,
  p_actor text,
  p_reason text
) returns uuid language plpgsql as $$
declare
  v_cur numeric;
  v_delta numeric;
begin
  if p_new is null or p_new < 0 then
    raise exception 'La cantidad debe ser 0 o mayor';
  end if;
  if p_reason is null or p_reason = '' then
    raise exception 'Indicá el motivo del ajuste';
  end if;
  select quantity into v_cur
    from stock_balances
   where product_id = p_product
     and location_id = p_location
     and lot_id is not distinct from p_lot
   for update;
  v_cur := coalesce(v_cur, 0);
  v_delta := p_new - v_cur;
  if v_delta = 0 then
    raise exception 'La cantidad ya es %: no hay nada para ajustar', p_new;
  end if;
  if v_delta > 0 then
    return apply_movement('COUNT_ADJUSTMENT', p_product, p_lot, v_delta,
      null, p_location, p_actor, p_reason, 'Ajuste directo desde Stock', null, null, null);
  else
    return apply_movement('COUNT_ADJUSTMENT', p_product, p_lot, -v_delta,
      p_location, null, p_actor, p_reason, 'Ajuste directo desde Stock', null, null, null);
  end if;
end $$;

revoke execute on function adjust_stock_to(uuid, uuid, uuid, numeric, text, text) from public, anon, authenticated;
