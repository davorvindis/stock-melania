-- Pedido que figuraba procesado en Wix y lo vuelven a "no procesado" (antes de armarlo en
-- Melania): se olvida la marca, así al procesarlo en Melania se crea el envío en Wix,
-- y se saca el aviso "Marcado procesado en Wix".
create function wix_unmark_fulfilled(p_order_id uuid, p_actor text) returns void
language plpgsql as $$
begin
  update channel_orders
     set wix_fulfilled = false,
         review_reason = nullif(array_to_string(array(
           select s from unnest(string_to_array(review_reason, ' · ')) s
            where s !~ '^Marcado procesado en Wix'), ' · '), '')
   where id = p_order_id and wix_fulfilled;
  if found then
    insert into audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'wix:fulfilled_undone', 'channel_orders', p_order_id, '{}'::jsonb);
  end if;
end $$;

revoke execute on function wix_unmark_fulfilled(uuid, text) from public, anon, authenticated;
