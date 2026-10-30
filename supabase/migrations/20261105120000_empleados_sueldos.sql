-- Empleados y novedades de sueldo: ficha de cada persona (empleador, cómo cobra) y las
-- novedades que se le pasan a la contadora cada mes. Los montos los carga el admin desde la
-- app (no van en el repo). La contadora arma los recibos; acá queda el historial mes a mes.

alter table employees
  add column full_name text,
  add column employer text not null default 'MARRUDI' check (employer in ('MARRUDI', 'ECP')),
  -- CONVENIO: sueldo de comercio que calcula la contadora · EN_MANO: monto fijo a cobrar
  -- FIJO_COMISION: básico + comisiones del mes · POR_HORA: horas del mes × valor hora
  add column pay_scheme text not null default 'CONVENIO' check (pay_scheme in ('CONVENIO', 'EN_MANO', 'FIJO_COMISION', 'POR_HORA')),
  add column base_amount numeric(14, 2) check (base_amount >= 0),
  add column hourly_rate numeric(14, 2) check (hourly_rate >= 0),
  add column start_date date,
  add column end_date date,
  add column sort_order int not null default 100,
  add column notes text,
  add constraint employees_fechas check (end_date is null or start_date is null or end_date >= start_date);

-- una fila por persona y mes
create table payroll_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  period date not null check (extract(day from period) = 1), -- primer día del mes
  base_amount numeric(14, 2) check (base_amount >= 0),      -- básico / en mano de ese mes
  commissions numeric(14, 2) check (commissions >= 0),      -- FIJO_COMISION
  minutes_worked int check (minutes_worked >= 0),           -- POR_HORA
  hourly_rate numeric(14, 2) check (hourly_rate >= 0),      -- POR_HORA
  total numeric(14, 2),                                      -- total a cobrar (si se puede calcular)
  report_amount boolean not null default false,              -- EN_MANO: informar el monto en el mensaje
  raise_pct numeric(6, 2),                                   -- aumento al básico este mes
  bonus numeric(14, 2) check (bonus >= 0),
  aguinaldo boolean not null default false,
  no_presentismo boolean not null default false,             -- restarle el presentismo
  pending boolean not null default false,                    -- "mañana te paso bien"
  notes text,                                                -- texto libre para la contadora
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (employee_id, period)
);
create index idx_payroll_period on payroll_entries (period);

alter table payroll_entries enable row level security;

-- el equipo actual (sin montos: se cargan desde la pestaña Empleados)
update employees set full_name = 'Juan Martín Arocena', pay_scheme = 'CONVENIO', sort_order = 10 where name = 'Juan';
update employees set full_name = 'Karla López', pay_scheme = 'EN_MANO', sort_order = 20 where name = 'Karla';
update employees set full_name = 'Francisco Marchena', pay_scheme = 'CONVENIO', sort_order = 30 where name = 'Francisco';
update employees set full_name = 'Yuransis Afanador Liscano', pay_scheme = 'FIJO_COMISION', sort_order = 40 where name = 'Yura';
update employees set full_name = 'Margarita Perich', pay_scheme = 'EN_MANO', start_date = '2026-07-07', sort_order = 50 where name = 'Magui';
insert into employees (name, full_name, employer, pay_scheme, sort_order, end_date) values
  ('Clara', 'Clara Ríos', 'ECP', 'POR_HORA', 110, '2026-10-30'),
  ('Romina', 'Romina Galeano', 'ECP', 'POR_HORA', 120, null),
  ('Agustina', 'Agustina Florentin', 'ECP', 'POR_HORA', 130, null);

-- la pestaña nueva la ve solo Joel (se puede habilitar a otro desde Configuración)
update profiles set permissions = permissions || '{"empleados": true}'::jsonb where alias = 'Joel';
