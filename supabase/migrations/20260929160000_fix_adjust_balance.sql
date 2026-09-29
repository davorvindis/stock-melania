-- Fix: el upsert con delta negativo violaba el CHECK (quantity >= 0) antes de
-- resolver el conflicto (Postgres valida checks sobre la fila propuesta primero).
-- Patrón correcto: UPDATE primero (toma lock de fila = serializa concurrencia);
-- si no existe la fila, INSERT (solo válido para deltas positivos).

create or replace function _adjust_balance(p_product uuid, p_lot uuid, p_location uuid, p_delta numeric)
returns void language plpgsql as $$
begin
  update stock_balances
     set quantity = quantity + p_delta, updated_at = now()
   where product_id = p_product
     and location_id = p_location
     and lot_id is not distinct from p_lot;
  if not found then
    insert into stock_balances (product_id, lot_id, location_id, quantity)
    values (p_product, p_lot, p_location, p_delta)
    on conflict (product_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set quantity = stock_balances.quantity + excluded.quantity, updated_at = now();
  end if;
exception when check_violation then
  raise exception 'Stock insuficiente: la operación dejaría stock negativo';
end $$;

revoke execute on function _adjust_balance(uuid, uuid, uuid, numeric) from public, anon, authenticated;
