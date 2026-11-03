-- Ventas de Wix que llegaron sin SKU (el producto no lo tenía cargado en ese momento): si el
-- producto y la variante de Wix ya están mapeados a una equivalencia, se completa el SKU del
-- ítem y el pedido se reserva solo (wix_retry_missing_skus). Si el producto de Wix apunta a más
-- de una equivalencia no se adivina: sigue a revisar.

create function wix_fill_missing_skus(p_actor text) returns int
language plpgsql as $$
declare
  v_skus text[];
begin
  with candidatos as (
    select i.id, cs.external_sku, count(*) over (partition by i.id) n
      from channel_order_items i
      join channel_orders co on co.id = i.order_id
      cross join lateral jsonb_array_elements(coalesce(co.raw->'lineItems', '[]'::jsonb)) l
      join channel_skus cs
        on cs.active
       and cs.wix_product_id = l->'catalogReference'->>'catalogItemId'
       and cs.wix_variant_id = coalesce(l->'catalogReference'->'options'->>'variantId', '00000000-0000-0000-0000-000000000000')
     where i.external_sku is null and i.settled_at is null and not i.resolved
       and l->>'id' = i.external_line_id
       and co.channel_type is distinct from 'POS'
       and co.state in ('NEW', 'RESERVED', 'PARTIAL', 'PROCESSED')
       and co.payment_status in ('PAID', 'PARTIALLY_REFUNDED')
       and co.delivery_status is null
  ), completados as (
    update channel_order_items i set external_sku = c.external_sku
      from candidatos c
     where c.id = i.id and c.n = 1
    returning i.external_sku
  )
  select coalesce(array_agg(distinct external_sku), '{}') into v_skus from completados;
  if array_length(v_skus, 1) is null then return 0; end if;
  return wix_retry_missing_skus(v_skus, p_actor);
end $$;
revoke execute on function wix_fill_missing_skus(text) from public, anon, authenticated;
