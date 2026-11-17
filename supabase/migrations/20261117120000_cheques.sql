-- Control de cheques (Productos y compras → Cheques). Reemplaza el Excel Control_Cheques_Melania.
-- Estados: PENDIENTE (emitido, falta que se debite), PROPUESTO (compra a confirmar, se incluye
-- en los fondos a reservar), PAGADO (debitado) y ANULADO (no cuenta). No se borran: se anulan.

create table cheques (
  id uuid primary key default gen_random_uuid(),
  due_date date not null,
  supplier_id uuid references suppliers(id),
  payee text,                         -- beneficiario si no es un proveedor cargado
  concept text not null,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'PENDIENTE' check (status in ('PENDIENTE','PROPUESTO','PAGADO','ANULADO')),
  bank text,
  number text,
  notes text,
  paid_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz,
  check (supplier_id is not null or nullif(btrim(payee), '') is not null)
);
create index cheques_due_date_idx on cheques (due_date);
alter table cheques enable row level security;

-- pestaña nueva: solo Joel y Mel (el resto la ve si se la habilitan en Configuración)
update profiles set permissions = permissions || '{"cheques": true}'::jsonb where alias in ('Joel', 'Mel');

-- carga inicial desde el Excel
insert into cheques (due_date, supplier_id, concept, amount, status, notes, paid_at, created_by)
select v.d::date, s.id, v.concepto, v.importe, v.estado, 'Emitido',
       case when v.estado = 'PAGADO' then v.d::date + time '12:00' end, 'Joel'
  from (values
    ('2026-10-09', 'Folia nueva p1yp2', 15703380, 'PAGADO'),
    ('2026-10-25', 'Folia nueva p1yp2', 15703380, 'PAGADO'),
    ('2026-10-30', 'Tintura negra',     14487330, 'PAGADO'),
    ('2026-11-09', 'Folia nueva p1yp2', 15703380, 'PAGADO'),
    ('2026-11-30', 'Tintura negra',     14487330, 'PENDIENTE'),
    ('2026-12-30', 'Tintura negra',     14487330, 'PENDIENTE'),
    ('2027-01-30', 'Tintura negra',     14487330, 'PENDIENTE')
  ) as v(d, concepto, importe, estado)
  cross join (select id from suppliers where name = 'One Pack') s;
