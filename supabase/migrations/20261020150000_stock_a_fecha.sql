-- Stock al cierre de un día (hora Argentina), reconstruido desde el ledger de
-- movimientos. Solo lectura: no toca saldos ni movimientos.
create function stock_at(p_date date)
returns table (product_id uuid, lot_id uuid, location_id uuid, quantity numeric)
language sql stable as $$
  with hasta as (
    select ((p_date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as t
  )
  select x.product_id, x.lot_id, x.location_id, sum(x.d) as quantity
    from (
      select m.product_id, m.lot_id, m.to_location_id as location_id, m.quantity as d
        from inventory_movements m, hasta
       where m.to_location_id is not null and m.occurred_at < hasta.t
      union all
      select m.product_id, m.lot_id, m.from_location_id, -m.quantity
        from inventory_movements m, hasta
       where m.from_location_id is not null and m.occurred_at < hasta.t
    ) x
   group by x.product_id, x.lot_id, x.location_id
  having sum(x.d) > 0
$$;

revoke execute on function stock_at(date) from public, anon, authenticated;
