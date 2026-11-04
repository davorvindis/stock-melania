-- Forecast: días en que un producto arrancó sin stock (fuera de cuarentena), desde que
-- arrancó la app. Esos días no cuentan para el ritmo de venta: si no había, no se pudo
-- vender, y el faltante no tiene que bajar el promedio.
-- El stock de cada día se reconstruye hacia atrás desde el saldo actual con el ledger.
create function forecast_dias_sin_stock(p_desde date)
returns table (product_id uuid, dias date[])
language sql stable as $$
  with cuar as (select id from locations where is_quarantine),
  actual as (
    select b.product_id, sum(b.quantity) as q
      from stock_balances b where b.location_id not in (select id from cuar)
     group by 1
  ), neto as (
    select m.product_id, (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as dia,
           sum(case when m.to_location_id is not null and m.to_location_id not in (select id from cuar) then m.quantity else 0 end
             - case when m.from_location_id is not null and m.from_location_id not in (select id from cuar) then m.quantity else 0 end) as q
      from inventory_movements m
     where m.occurred_at >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
     group by 1, 2
  ), prods as (
    select product_id from actual union select product_id from neto
  ), grilla as (
    select p.product_id, d::date as dia
      from prods p cross join generate_series(p_desde, current_date, interval '1 day') d
  ), inicio_dia as (
    -- stock al empezar el día = actual − todo lo que se movió desde ese día en adelante
    select g.product_id, g.dia,
           coalesce(a.q, 0) - coalesce(sum(n.q) over (partition by g.product_id order by g.dia desc
                                                       rows between unbounded preceding and current row), 0) as q
      from grilla g
      left join actual a on a.product_id = g.product_id
      left join neto n on n.product_id = g.product_id and n.dia = g.dia
  )
  select product_id, array_agg(dia order by dia)
    from inicio_dia where q <= 0 and dia < current_date
   group by 1
$$;
revoke execute on function forecast_dias_sin_stock(date) from public, anon, authenticated;

-- ritmos a mano: pasan de número a {semana, desde} para que puedan vencer solos
update app_settings
   set value = jsonb_set(value, '{ritmos}', coalesce((
         select jsonb_object_agg(k, case when jsonb_typeof(v) = 'number'
                                         then jsonb_build_object('semana', v, 'desde', current_date::text)
                                         else v end)
           from jsonb_each(value->'ritmos') as e(k, v)), '{}'::jsonb))
 where key = 'forecast' and value ? 'ritmos';
