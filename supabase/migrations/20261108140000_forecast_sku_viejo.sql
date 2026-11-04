-- Historial de Wix: en 2025 varios productos tenían otro SKU (ej. "Prolashbotox_Monodosis").
-- Si el SKU no tiene equivalencia, se busca por el producto y la variante de Wix (el mismo
-- producto aunque le hayan cambiado el SKU). Los pedidos viejos no traen variante: cuenta
-- como la variante única.
create or replace function _forecast_wix_lineas()
returns table (ordered_at timestamptz, external_sku text, name text, quantity numeric, channel_sku_id uuid)
language sql stable as $$
  select h.ordered_at, h.external_sku, h.name, h.quantity,
         coalesce(
           (select cs.id from channel_skus cs
             where cs.active and h.external_sku is not null and upper(cs.external_sku) = upper(h.external_sku)
             limit 1),
           (select min(cs.id::text)::uuid from channel_skus cs
             where cs.active
               and cs.wix_product_id = h.wix_product_id
               and coalesce(cs.wix_variant_id, '00000000-0000-0000-0000-000000000000') = coalesce(h.wix_variant_id, '00000000-0000-0000-0000-000000000000')
            having count(*) = 1)
         )
    from wix_sales_history h
   where coalesce(h.wix_status, '') not in ('CANCELED', 'REJECTED')
     and coalesce(h.payment_status, '') in ('PAID', 'PARTIALLY_REFUNDED')
$$;
revoke execute on function _forecast_wix_lineas() from public, anon, authenticated;
