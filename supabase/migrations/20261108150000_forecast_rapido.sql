-- Forecast más rápido con el historial completo de Wix (~33.000 líneas):
-- la equivalencia se resuelve con joins (antes, una subconsulta por línea) y la demanda
-- vuelve en una sola llamada, una fila por producto con sus días en jsonb.
create or replace function _forecast_wix_lineas()
returns table (ordered_at timestamptz, external_sku text, name text, quantity numeric, channel_sku_id uuid)
language sql stable
-- el planificador estima mal las filas filtradas y elige nested loops (3 s); con hash joins, ms
set enable_nestloop = off
as $$
  with por_sku as (
    select upper(external_sku) as k, min(id::text)::uuid as id
      from channel_skus where active group by 1
  ), por_producto as (
    select wix_product_id, coalesce(wix_variant_id, '00000000-0000-0000-0000-000000000000') as v, min(id::text)::uuid as id
      from channel_skus where active and wix_product_id is not null
     group by 1, 2 having count(*) = 1
  )
  select h.ordered_at, h.external_sku, h.name, h.quantity, coalesce(s.id, p.id)
    from wix_sales_history h
    left join por_sku s on s.k = upper(h.external_sku)
    left join por_producto p on p.wix_product_id = h.wix_product_id
                            and p.v = coalesce(h.wix_variant_id, '00000000-0000-0000-0000-000000000000')
   where coalesce(h.wix_status, '') not in ('CANCELED', 'REJECTED')
     and coalesce(h.payment_status, '') in ('PAID', 'PARTIALLY_REFUNDED')
$$;

-- una fila por producto: {"2026-10-01": 12, ...} (APP y WIX sumados)
create function forecast_demanda_json(p_desde date)
returns table (product_id uuid, dias jsonb)
language sql stable as $$
  select product_id, jsonb_object_agg(dia::text, qty)
    from (select product_id, dia, sum(qty) as qty from forecast_demanda(p_desde) group by 1, 2) x
   group by 1
$$;
revoke execute on function _forecast_wix_lineas() from public, anon, authenticated;
revoke execute on function forecast_demanda_json(date) from public, anon, authenticated;

-- la tabla se llenó de golpe: estadísticas al día para que el planificador use hash joins
analyze wix_sales_history;
