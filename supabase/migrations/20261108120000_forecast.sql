-- Forecast de ventas: previsión de cuándo se acaba cada producto y cuándo/cuánto comprar.
-- Junta dos fuentes de demanda:
--   1. el ledger (ventas minoristas/mayoristas, regalos, muestras, uso interno y
--      componentes usados para armar kits), sin las ventas revertidas;
--   2. el historial de ventas de Wix (2025 en adelante) para los días ANTERIORES a la
--      primera venta cargada en la app: así no se cuenta dos veces.
-- Las ventas de Wix se pasan a nuestros productos con las equivalencias vigentes
-- (packs y combos incluidos), así que corregir una equivalencia mejora el historial.
-- No mueve stock: solo lectura + una tabla de historial importado.

create table wix_sales_history (
  order_id text not null,
  line_id text not null,
  number text,
  ordered_at timestamptz not null,
  channel_type text,
  wix_status text,
  payment_status text,
  external_sku text,
  wix_product_id text,
  wix_variant_id text,
  name text,
  quantity numeric(12,3) not null,
  imported_at timestamptz not null default now(),
  primary key (order_id, line_id)
);
create index idx_wix_sales_history_date on wix_sales_history (ordered_at);
alter table wix_sales_history enable row level security;
revoke all on wix_sales_history from public, anon, authenticated;

-- ventas válidas del historial: pagadas (o con reembolso parcial), no canceladas
create function _forecast_wix_lineas()
returns table (ordered_at timestamptz, external_sku text, name text, quantity numeric, channel_sku_id uuid)
language sql stable as $$
  select h.ordered_at, h.external_sku, h.name, h.quantity,
         coalesce(
           (select cs.id from channel_skus cs
             where cs.active and h.external_sku is not null and upper(cs.external_sku) = upper(h.external_sku)
             limit 1),
           (select min(cs.id::text)::uuid from channel_skus cs
             where cs.active and h.external_sku is null
               and cs.wix_product_id = h.wix_product_id
               and coalesce(cs.wix_variant_id, '00000000-0000-0000-0000-000000000000') = coalesce(h.wix_variant_id, '00000000-0000-0000-0000-000000000000')
            having count(*) = 1)
         )
    from wix_sales_history h
   where coalesce(h.wix_status, '') not in ('CANCELED', 'REJECTED')
     and coalesce(h.payment_status, '') in ('PAID', 'PARTIALLY_REFUNDED')
$$;

-- demanda diaria por producto desde p_desde (día argentino)
create function forecast_demanda(p_desde date)
returns table (product_id uuid, dia date, origen text, qty numeric)
language sql stable as $$
  with corte as (
    select coalesce(min((occurred_at at time zone 'America/Argentina/Buenos_Aires')::date), current_date) as dia
      from inventory_movements where type in ('SALE', 'WHOLESALE_SALE')
  ), app as (
    select m.product_id, (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as dia, m.quantity
      from inventory_movements m
     where (m.type in ('SALE', 'WHOLESALE_SALE', 'GIFT', 'SAMPLE', 'INTERNAL_USE')
            or (m.type = 'KIT_ASSEMBLY' and m.from_location_id is not null))
       and m.occurred_at >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and not exists (select 1 from inventory_movements r where r.reversal_of = m.id)
  ), wix as (
    select l.product_id, (w.ordered_at at time zone 'America/Argentina/Buenos_Aires')::date as dia, w.quantity * l.quantity as quantity
      from _forecast_wix_lineas() w
      join channel_sku_lines l on l.channel_sku_id = w.channel_sku_id
     where (w.ordered_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde
       and (w.ordered_at at time zone 'America/Argentina/Buenos_Aires')::date < (select dia from corte)
  )
  select product_id, dia, 'APP', sum(quantity) from app group by 1, 2
  union all
  select product_id, dia, 'WIX', sum(quantity) from wix group by 1, 2
$$;

-- resumen del historial importado y lo que no se pudo pasar a productos (falta equivalencia)
create function forecast_historial_resumen()
returns table (lineas bigint, desde timestamptz, hasta timestamptz, importado timestamptz, corte date,
               sin_equivalencia jsonb)
language sql stable as $$
  select (select count(*) from wix_sales_history),
         (select min(ordered_at) from wix_sales_history),
         (select max(ordered_at) from wix_sales_history),
         (select max(imported_at) from wix_sales_history),
         (select min((occurred_at at time zone 'America/Argentina/Buenos_Aires')::date)
            from inventory_movements where type in ('SALE', 'WHOLESALE_SALE')),
         coalesce((
           select jsonb_agg(x order by x.unidades desc)
             from (select coalesce(external_sku, '(sin SKU)') as sku, max(name) as nombre, sum(quantity) as unidades
                     from _forecast_wix_lineas() where channel_sku_id is null
                    group by 1 order by 3 desc limit 30) x
         ), '[]'::jsonb)
$$;

revoke execute on function _forecast_wix_lineas() from public, anon, authenticated;
revoke execute on function forecast_demanda(date) from public, anon, authenticated;
revoke execute on function forecast_historial_resumen() from public, anon, authenticated;
