-- Cierre de caja diario (lo carga Yura): pagos que no entran por Wix/Mercado Pago
-- automático (efectivo, transferencias, link MP manual, posnet, USD), gastos del día,
-- caja chica, contadores operativos y tareas. No toca el stock.

create table cash_closings (
  id uuid primary key default gen_random_uuid(),
  closing_date date not null unique,
  status text not null default 'BORRADOR' check (status in ('BORRADOR', 'ENVIADO')),
  opening_cash numeric(14,2) not null default 0,   -- caja inicial (= caja chica del cierre anterior)
  surplus numeric(14,2) not null default 0,        -- "sobran" (+) / faltan (−)
  counters jsonb not null default '{}'::jsonb,     -- mercado libre, motomensajería, correos…
  tasks text,                                      -- tareas operativas / observaciones (una por línea)
  notes text,
  created_by text,
  updated_by text,
  submitted_by text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cash_closing_lines (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references cash_closings(id) on delete cascade,
  kind text not null default 'MINORISTA' check (kind in ('MINORISTA', 'MAYORISTA')),
  position int not null default 0,
  order_ref text,       -- PEDIDO
  customer text,        -- CLIENTE
  description text,     -- DESCRIPCIÓN
  cash numeric(14,2),           -- EFECTIVO
  money_in numeric(14,2),       -- INGRESOS DE DINERO (entra a la caja, no es venta)
  posnet numeric(14,2),         -- POSNET
  mp_link numeric(14,2),        -- LINK DE PAGO MP
  transfer numeric(14,2),       -- TRANSFERENCIA
  account text,                 -- EXTRAS: cuenta donde entró (Marrudi, Joel, Melania…)
  usd numeric(14,2),            -- PAGO USD
  invoice text                  -- FACTURA
);
create index idx_cash_lines_closing on cash_closing_lines (closing_id, kind, position);

create table cash_closing_expenses (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references cash_closings(id) on delete cascade,
  position int not null default 0,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  description text,
  from_petty_cash boolean not null default true  -- se pagó con la caja chica
);
create index idx_cash_expenses_closing on cash_closing_expenses (closing_id, position);

-- quién ya vio cada cierre enviado (para el aviso de Joel y Mel)
create table cash_closing_views (
  closing_id uuid not null references cash_closings(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (closing_id, profile_id)
);

alter table cash_closings enable row level security;
alter table cash_closing_lines enable row level security;
alter table cash_closing_expenses enable row level security;
alter table cash_closing_views enable row level security;

-- guarda el cierre completo de un día (cabecera + pagos + gastos), todo junto.
-- p_data: {opening_cash, surplus, counters, tasks, notes, lines:[…], expenses:[…]}
-- p_submit: true = "Enviar cierre" (queda ENVIADO y avisa); false = borrador.
create function save_cash_closing(p_date date, p_data jsonb, p_submit boolean, p_actor text)
returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_status text;
  v_reenviado boolean := false;
begin
  if p_date is null then raise exception 'Falta la fecha del cierre'; end if;
  if p_date > (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception 'No se puede cargar un cierre de una fecha futura';
  end if;
  select id, status into v_id, v_status from cash_closings where closing_date = p_date for update;
  if v_id is null then
    insert into cash_closings (closing_date, created_by) values (p_date, p_actor) returning id into v_id;
    v_status := 'BORRADOR';
  end if;
  v_reenviado := p_submit and v_status = 'ENVIADO';
  update cash_closings set
    opening_cash = coalesce(nullif(p_data->>'opening_cash', '')::numeric, 0),
    surplus = coalesce(nullif(p_data->>'surplus', '')::numeric, 0),
    counters = coalesce(p_data->'counters', '{}'::jsonb),
    tasks = nullif(trim(p_data->>'tasks'), ''),
    notes = nullif(trim(p_data->>'notes'), ''),
    status = case when p_submit then 'ENVIADO' else status end,
    submitted_by = case when p_submit then p_actor else submitted_by end,
    submitted_at = case when p_submit then now() else submitted_at end,
    updated_by = p_actor,
    updated_at = now()
  where id = v_id;

  delete from cash_closing_lines where closing_id = v_id;
  insert into cash_closing_lines (closing_id, kind, position, order_ref, customer, description,
                                  cash, money_in, posnet, mp_link, transfer, account, usd, invoice)
  select v_id,
         case when l.value->>'kind' = 'MAYORISTA' then 'MAYORISTA' else 'MINORISTA' end,
         l.ordinality,
         nullif(trim(l.value->>'order_ref'), ''), nullif(trim(l.value->>'customer'), ''),
         nullif(trim(l.value->>'description'), ''),
         nullif(l.value->>'cash', '')::numeric, nullif(l.value->>'money_in', '')::numeric,
         nullif(l.value->>'posnet', '')::numeric, nullif(l.value->>'mp_link', '')::numeric,
         nullif(l.value->>'transfer', '')::numeric, nullif(trim(l.value->>'account'), ''),
         nullif(l.value->>'usd', '')::numeric, nullif(trim(l.value->>'invoice'), '')
    from jsonb_array_elements(coalesce(p_data->'lines', '[]'::jsonb)) with ordinality l;

  delete from cash_closing_expenses where closing_id = v_id;
  insert into cash_closing_expenses (closing_id, position, amount, currency, description, from_petty_cash)
  select v_id, e.ordinality, (e.value->>'amount')::numeric,
         case when e.value->>'currency' = 'USD' then 'USD' else 'ARS' end,
         nullif(trim(e.value->>'description'), ''),
         coalesce((e.value->>'from_petty_cash')::boolean, true)
    from jsonb_array_elements(coalesce(p_data->'expenses', '[]'::jsonb)) with ordinality e
   where nullif(e.value->>'amount', '') is not null;

  -- reenviar un cierre ya enviado vuelve a avisar
  if v_reenviado then delete from cash_closing_views where closing_id = v_id; end if;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_submit then 'cash_closing:submit' else 'cash_closing:save' end,
          'cash_closings', v_id, jsonb_build_object('fecha', p_date,
            'pagos', jsonb_array_length(coalesce(p_data->'lines', '[]'::jsonb)),
            'gastos', jsonb_array_length(coalesce(p_data->'expenses', '[]'::jsonb))));
  return v_id;
end $$;

revoke execute on function save_cash_closing(date, jsonb, boolean, text) from public, anon, authenticated;
