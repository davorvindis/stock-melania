-- Seed piloto — datos ficticios para probar (master prompt §28).
-- Idempotente: se puede correr más de una vez sin duplicar.

insert into locations (name, is_quarantine) values
  ('Depósito', false),
  ('Store', false),
  ('Cuarentena', true),
  ('Baricosmos', false),
  ('One Pack', false)
on conflict (name) do nothing;

insert into suppliers (name) values
  ('Baricosmos'), ('One Pack'), ('Oxapharma'), ('Akian'), ('Microbottles'), ('Lab Victoria')
on conflict (name) do nothing;

insert into products (sku, name, unit, type, min_stock, tracks_lot, tracks_expiry) values
  ('MEL-BOTOX-15',   'Pro Lash Botox 15 ml',   'unidad', 'TERMINADO', 20, true, true),
  ('MEL-KERATIN-15', 'Pro Lash Keratin 15 ml', 'unidad', 'TERMINADO', 20, true, true),
  ('MEL-EASYGEL',    'Easy Gel',               'unidad', 'TERMINADO', 10, true, true),
  ('MEL-MOUSSE-60',  'Pro Mousse 60 ml',       'unidad', 'TERMINADO', 15, true, true),
  ('MEL-GLUE-7',     'Pro Glue 7 ml',          'unidad', 'TERMINADO', 30, true, true)
on conflict (sku) do nothing;

do $$
declare
  v_boto uuid; v_kera uuid; v_dep uuid; v_store uuid; v_cuar uuid;
  v_oxa uuid; v_lote uuid;
begin
  select id into v_boto from products where sku = 'MEL-BOTOX-15';
  select id into v_kera from products where sku = 'MEL-KERATIN-15';
  select id into v_dep from locations where name = 'Depósito';
  select id into v_store from locations where name = 'Store';
  select id into v_cuar from locations where name = 'Cuarentena';
  select id into v_oxa from suppliers where name = 'Oxapharma';

  -- +100 ingreso Botox lote L-2026-01 (idempotente por clave)
  perform create_stock_entry(
    current_date, v_oxa, 'R-0001', 'FC-A-0001', 'Seed piloto', 'seed', 'seed-ingreso-1',
    jsonb_build_array(
      jsonb_build_object('product_id', v_boto, 'lot_code', 'L-2026-01', 'expires_on', '2027-06-30',
                         'quantity', 100, 'total_cost', 250000, 'location_id', v_dep),
      jsonb_build_object('product_id', v_kera, 'lot_code', 'K-2026-01', 'expires_on', '2027-08-31',
                         'quantity', 50, 'unit_cost', 2100, 'location_id', v_dep)
    )
  );

  select id into v_lote from lots where product_id = v_boto and code = 'L-2026-01';

  -- transferir 20 a Store
  perform apply_movement('TRANSFER', v_boto, v_lote, 20, v_dep, v_store, 'seed',
                         'Reposición Store', null, null, null, 'seed-transfer-1');
  -- vender 5 desde Store
  perform apply_movement('SALE', v_boto, v_lote, 5, v_store, null, 'seed',
                         'Venta mostrador', null, null, null, 'seed-venta-1');
  -- regalar 2 desde Store
  perform apply_movement('GIFT', v_boto, v_lote, 2, v_store, null, 'seed',
                         'Regalo a clienta', null, null, null, 'seed-regalo-1');
  -- 10 a cuarentena desde Depósito
  perform apply_movement('QUARANTINE_IN', v_boto, v_lote, 10, v_dep, v_cuar, 'seed',
                         'Revisión de calidad', null, null, null, 'seed-cuarentena-1');
end $$;
