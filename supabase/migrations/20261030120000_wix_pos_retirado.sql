-- Ventas del POS de Wix (local): la clienta paga y se lo lleva en el momento, así que
-- al descontarse quedan solas como "Retirado" (en el Store). No mueve stock.
create function wix_pos_mark_picked_up(p_order_id uuid) returns void
language plpgsql as $$
begin
  update channel_orders
     set delivery_status = 'PICKED_UP',
         delivered_at = coalesce(processed_at, now()),
         delivered_by = coalesce(processed_by, 'Wix POS'),
         updated_at = now()
   where id = p_order_id and channel_type = 'POS' and state = 'PROCESSED' and delivery_status is null;
end $$;

revoke execute on function wix_pos_mark_picked_up(uuid) from public, anon, authenticated;

-- las que ya estaban procesadas
update channel_orders
   set delivery_status = 'PICKED_UP',
       delivered_at = coalesce(processed_at, now()),
       delivered_by = coalesce(processed_by, 'Wix POS')
 where channel_type = 'POS' and state = 'PROCESSED' and delivery_status is null;
