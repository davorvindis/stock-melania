-- Productos que fabrica Melania (no se compran hechos): el forecast los muestra primero.
-- Se puede cambiar desde la ficha del producto.
alter table products add column own_made boolean not null default false;

update products set own_made = true
 where sku in (
   'MEL-MONOD-BOTOX-X-1-UNIDA', 'MEL-MONOD-BOTOX-BLIST-X-4-UNIDA', 'MEL-MONOD-KERAT-X-1-UNIDA', 'MEL-MONOD-1-2',
   'MEL-PRO-GLUE-7ML', 'MEL-PRO-LASH-BOTOX-15ML-ACOND', 'MEL-PRO-LASH-KERAT-15ML', 'MEL-PRO-LASH-ONE-CRECI',
   'MEL-SERUM-ELIXI-NUTRI', 'MEL-SERUM-HIDRA-HIDRA', 'MEL-EASY-GEL', 'MEL-PERM-1-10ML', 'MEL-PRO-SETTI-2-10-ML',
   'MEL-MOUSS-60ML', 'MEL-PRO-MOUSS-120ML', 'MEL-MOUSS-500-ML'
 );
