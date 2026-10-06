-- Ubicación de trabajo de cada usuario (la asigna solo un ADMIN desde Configuración).
-- location_locked = el usuario solo puede operar stock desde esa ubicación
-- (ej. la vendedora del Store: sus ventas salen siempre de Store).

alter table profiles add column location_id uuid references locations(id);
alter table profiles add column location_locked boolean not null default false;
alter table profiles add constraint profiles_lock_needs_location
  check (not location_locked or location_id is not null);
