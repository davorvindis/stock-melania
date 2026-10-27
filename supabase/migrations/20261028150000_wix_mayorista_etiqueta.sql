-- Mayorista por etiqueta del pedido en Wix + no publicar stock de los MAYORISTA.
--
-- Yura carga los pedidos mayoristas a mano en Wix con los productos individuales y
-- los etiqueta "Mayorista". Si el pedido tiene alguna de las etiquetas configuradas
-- (app_settings 'wix' → wholesale_tag_ids; Wix manda ids, no nombres), sus reservas
-- activas pasan a WHOLESALE_SALE y así salen como venta mayorista al procesarse.
-- Los productos "MAYORISTA…" de Wix (ocultos, marcadores internos) no reciben stock.

alter table channel_orders add column wholesale boolean not null default false;
alter table channel_skus add column publish_stock boolean not null default true;

-- los MAYORISTA (sufijo -MAY o nombre en Wix con "mayorista") no se publican
update channel_skus
   set publish_stock = false
 where upper(external_sku) ~ '(^|-)MAY(-|$)' or label ilike '%mayorista%';

-- etiqueta "Mayorista" de Wix (id visto en los pedidos manuales mayoristas de Yura)
update app_settings
   set value = value || '{"wholesale_tag_ids": ["UxcgC"]}'::jsonb
 where key = 'wix' and not (value ? 'wholesale_tag_ids');

create function wix_apply_order_tags(p_order_id uuid, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders%rowtype;
  v_tags text[];
  v_ids text[];
  v_mayorista boolean;
  v_cambiadas int := 0;
  v_ya_despachado boolean;
begin
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  select array_agg(t) into v_tags from (
    select jsonb_array_elements_text(coalesce(o.raw->'tags'->'privateTags'->'tagIds', '[]'::jsonb)) t
    union
    select jsonb_array_elements_text(coalesce(o.raw->'tags'->'tags'->'tagIds', '[]'::jsonb))
    union
    select jsonb_array_elements_text(coalesce(o.raw->'tags'->'publicTags'->'tagIds', '[]'::jsonb))
  ) x;
  select array_agg(t) into v_ids
    from jsonb_array_elements_text(coalesce(wix_settings()->'wholesale_tag_ids', '[]'::jsonb)) t;
  v_mayorista := coalesce(v_tags && v_ids, false);
  if v_mayorista = o.wholesale then return 'sin-cambios'; end if;
  v_ya_despachado := exists (select 1 from reservations where order_id = p_order_id and consumed > 0);

  update channel_orders set wholesale = v_mayorista, updated_at = now() where id = p_order_id;
  -- lo todavía reservado sale con el tipo que corresponde; sin etiqueta vuelve a depender del SKU (-MAY)
  update reservations r
     set sale_type = case when v_mayorista then 'WHOLESALE_SALE'::movement_type
                          else _wix_sale_type((select i.external_sku from channel_order_items i where i.id = r.item_id)) end
   where r.order_id = p_order_id and r.status = 'ACTIVE';
  get diagnostics v_cambiadas = row_count;
  if v_mayorista and v_ya_despachado then
    perform _wix_append_review(p_order_id, 'Etiquetado mayorista después de procesar: lo ya despachado quedó como venta minorista');
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:order_wholesale', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'mayorista', v_mayorista, 'reservas', v_cambiadas));
  return case when v_mayorista then 'mayorista' else 'minorista' end;
end $$;

revoke execute on function wix_apply_order_tags(uuid, text) from public, anon, authenticated;
