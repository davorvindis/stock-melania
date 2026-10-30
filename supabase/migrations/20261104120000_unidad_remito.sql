-- Unidad del remito distinta a la nuestra: el laboratorio cuenta MONODOSIS 1 y 2 por blister
-- (cada blister trae 2 pares: paso 1 + paso 2 dos veces) y nosotros por par. En Nuevo
-- ingreso, al elegir el producto, se carga lo que dice el remito y se calcula lo nuestro.
alter table products
  add column purchase_unit text,
  add column purchase_factor numeric(12,3) check (purchase_factor > 0),
  add constraint products_purchase_completo check ((purchase_unit is null) = (purchase_factor is null));

update products set purchase_unit = 'blisters', purchase_factor = 2, unit = 'par' where sku = 'MEL-MONOD-1-2';
