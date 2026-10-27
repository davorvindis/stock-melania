-- N° de seguimiento (Correo Argentino) cargado en Stock Melania: se manda a Wix en el
-- envío (fulfillment) para que a la clienta le llegue el email con el número.
-- tracking_synced = false → falta mandarlo a Wix (se reintenta solo en la sincronización).

alter table channel_orders
  add column tracking_number text check (tracking_number is null or length(trim(tracking_number)) between 1 and 100),
  add column tracking_synced boolean not null default true,
  add column tracking_error text,
  add column tracking_attempts int not null default 0;

create function wix_set_tracking(p_order_id uuid, p_number text, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders;
  v_num text := nullif(upper(regexp_replace(coalesce(p_number, ''), '\s', '', 'g')), '');
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if v_num is null then raise exception 'Escribí el número de seguimiento'; end if;
  if length(v_num) > 100 then raise exception 'Número de seguimiento demasiado largo'; end if;
  if o.channel_type = 'POS' then raise exception 'Las ventas del local no llevan seguimiento'; end if;
  if v_num is not distinct from o.tracking_number and o.tracking_synced then return 'sin-cambios'; end if;
  update channel_orders
     set tracking_number = v_num, tracking_synced = false, tracking_error = null, tracking_attempts = 0, updated_at = now()
   where id = p_order_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:tracking_set', 'channel_orders', p_order_id,
          jsonb_build_object('tracking', v_num, 'previous', o.tracking_number));
  return v_num;
end $$;

revoke execute on function wix_set_tracking(uuid, text, text) from public, anon, authenticated;
