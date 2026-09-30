-- LIMPIEZA DE DATOS DE PRUEBA — correr UNA sola vez antes de la carga real.
-- Borra: productos, lotes, movimientos, ingresos, balances, conteos y auditoría.
-- Conserva: ubicaciones, proveedores y usuarios.
begin;
truncate inventory_movements, stock_entry_lines, stock_entries, stock_balances,
         inventory_count_lines, inventory_counts, lots, products, audit_logs;
insert into audit_logs (actor, action, entity, detail)
values ('sistema', 'system:reset', 'all',
        '{"detalle":"Limpieza de datos de prueba previa a la carga real. Ubicaciones, proveedores y usuarios conservados."}');
commit;
select 'products' tabla, count(*) filas from products
union all select 'inventory_movements', count(*) from inventory_movements
union all select 'stock_balances', count(*) from stock_balances
union all select 'lots', count(*) from lots
union all select 'locations (se conservan)', count(*) from locations
union all select 'suppliers (se conservan)', count(*) from suppliers
union all select 'profiles (se conservan)', count(*) from profiles;
