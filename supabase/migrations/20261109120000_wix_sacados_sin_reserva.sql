-- Pedido editado en Wix ANTES de pagarse (ej. parcialmente pago): Wix saca la línea vieja y
-- agrega una nueva, pero acá la línea sacada quedaba y al pagarse se iba a reservar también
-- (descuento doble). wix_sync_order_items solo mira pedidos ya reservados; esto cubre las
-- líneas sin reserva: si ya no están en Wix, se descartan ("Sacado del pedido en Wix").
create function wix_drop_removed_items(p_order_id uuid, p_actor text) returns int
language plpgsql as $$
declare
  o channel_orders;
  v_lines text[];
  v_n int;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found or o.channel_type = 'POS' or o.delivery_status is not null then return 0; end if;
  select coalesce(array_agg(l->>'id'), '{}') into v_lines
    from jsonb_array_elements(coalesce(o.raw->'lineItems', '[]'::jsonb)) l;
  if array_length(v_lines, 1) is null then return 0; end if;
  update channel_order_items i
     set settled_at = now(), settled_by = p_actor, settled_action = 'DESCARTADO', settled_note = 'Sacado del pedido en Wix'
   where i.order_id = p_order_id and i.settled_at is null
     and not (i.external_line_id = any(v_lines))
     and not exists (select 1 from reservations r where r.item_id = i.id);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'wix:order_edited', 'channel_orders', p_order_id,
            jsonb_build_object('number', o.number, 'estado', o.state, 'lineas_sacadas', v_n));
  end if;
  return v_n;
end $$;
revoke execute on function wix_drop_removed_items(uuid, text) from public, anon, authenticated;

-- los que ya quedaron así (ej. #90442)
select wix_drop_removed_items(id, 'sistema') from channel_orders
 where channel_type is distinct from 'POS' and state in ('NEW', 'RESERVED', 'PARTIAL') and delivery_status is null;
