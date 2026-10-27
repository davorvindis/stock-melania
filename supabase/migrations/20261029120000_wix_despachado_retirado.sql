-- Pedidos Wix: después de "Procesado" (armado, stock ya descontado) el paquete puede
-- quedar "Despachado" (salió por correo / moto / se llevó a algún lado) o "Retirado"
-- (la clienta lo pasó a buscar por el local). No mueve stock: solo registra la entrega.

alter table channel_orders
  add column delivery_status text check (delivery_status in ('DISPATCHED', 'PICKED_UP')),
  add column delivered_at timestamptz,
  add column delivered_by text;

-- p_status null = deshacer (marcado por error)
create function wix_mark_delivered(p_order_id uuid, p_status text, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders;
begin
  if p_status is not null and p_status not in ('DISPATCHED', 'PICKED_UP') then
    raise exception 'Estado de entrega inválido';
  end if;
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if p_status is not null and o.state <> 'PROCESSED' then
    raise exception 'Primero hay que armarlo y marcarlo como procesado';
  end if;
  if p_status is not null and o.channel_type = 'POS' then
    raise exception 'Las ventas del local (POS) se entregan en el momento';
  end if;
  if p_status is not distinct from o.delivery_status then return 'sin-cambios'; end if;
  update channel_orders
     set delivery_status = p_status,
         delivered_at = case when p_status is null then null else now() end,
         delivered_by = case when p_status is null then null else p_actor end,
         updated_at = now()
   where id = p_order_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_status is null then 'wix:delivery_undone' else 'wix:delivered' end,
          'channel_orders', p_order_id,
          jsonb_build_object('status', p_status, 'previous', o.delivery_status));
  return coalesce(p_status, 'deshecho');
end $$;

revoke execute on function wix_mark_delivered(uuid, text, text) from public, anon, authenticated;
