-- Rol VIEWER (Observador): usuario de solo lectura para un asesor externo.
-- Ve las pestañas que tenga habilitadas y descarga reportes, pero no puede modificar nada:
-- el servidor rechaza toda acción que cambie datos (requireUser en src/lib/auth.ts).
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('ADMIN','MANAGER','OPERATOR','VIEWER'));
