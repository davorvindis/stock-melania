-- Forecast: análisis de gerencia con permiso propio (antes colgaba de Órdenes de compra).
-- Por defecto nadie lo ve; solo Joel y Mel.
update profiles set permissions = permissions || '{"forecast": true}'::jsonb where alias in ('Joel', 'Mel');
