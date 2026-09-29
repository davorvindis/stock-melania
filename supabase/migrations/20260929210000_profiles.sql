-- Usuarios de la app: perfil 1:1 con auth.users (Supabase Auth maneja el PIN/password).
-- role define permisos por defecto; permissions (jsonb) los sobreescribe por sección.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  alias text not null,
  dni text,
  role text not null default 'OPERATOR' check (role in ('ADMIN','MANAGER','OPERATOR')),
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  must_change_pin boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index profiles_alias_key on profiles (lower(alias));
create unique index profiles_dni_key on profiles (dni) where dni is not null;

alter table profiles enable row level security;
