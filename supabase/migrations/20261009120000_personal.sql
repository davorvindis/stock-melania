-- Personal: faltas / horas a favor o en deuda, y vacaciones con aprobación.
-- Saldo de horas = suma de minutos de time_records (+ a favor, − debe).

create table employees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into employees (name) values ('Yura'), ('Juan'), ('Francisco'), ('Magui'), ('Karla');

create table time_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  record_date date not null,
  kind text not null check (kind in (
    'FALTA', 'LLEGADA_TARDE', 'SALIDA_ANTICIPADA', 'TURNO_MEDICO',
    'HORAS_A_FAVOR', 'RECUPERO', 'SALDO_INICIAL', 'OTRO'
  )),
  reason text,
  schedule text,                -- "ingresa 11 am", "10:00"…
  certificate text check (certificate in ('SI', 'NO', 'NO_CORRESPONDE')),
  certificate_path text,        -- archivo en el bucket privado "certificados"
  minutes int not null default 0, -- + a favor / − debe; 0 = no afecta el saldo
  notes text,
  imported boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_time_records_emp on time_records (employee_id, record_date);

-- días de vacaciones que le corresponden a cada uno en cada año (lo define el admin)
create table vacation_allowances (
  employee_id uuid not null references employees(id),
  year int not null check (year between 2020 and 2100),
  days int not null check (days >= 0),
  notes text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (employee_id, year)
);

create table vacation_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  year int not null check (year between 2020 and 2100), -- año de vacaciones al que se imputa
  start_date date not null,
  end_date date not null,
  days int not null check (days > 0),                     -- días corridos
  status text not null default 'PENDIENTE'
    check (status in ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA')),
  notes text,
  decision_note text,
  requested_by text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index idx_vacation_requests_year on vacation_requests (year, start_date);

alter table employees enable row level security;
alter table time_records enable row level security;
alter table vacation_allowances enable row level security;
alter table vacation_requests enable row level security;
