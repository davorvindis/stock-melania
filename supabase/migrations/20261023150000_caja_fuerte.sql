-- Caja fuerte: retiros (total / parcial) e ingresos manuales. Los registra Yura
-- (o un admin) y quedan PENDIENTES hasta que Joel o Mel los aprueban.
-- Lo que entra por los cierres de caja con "¿Dónde ingresó el dinero?" = Caja fuerte
-- se suma solo (se calcula desde cash_closing_lines), no se carga acá.

create table cash_vault_movements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('RETIRO', 'INGRESO')),
  scope text check (scope in ('TOTAL', 'PARCIAL')),          -- solo retiros
  movement_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  person text,                 -- quién retiró / quién trajo la plata
  notes text,
  status text not null default 'PENDIENTE' check (status in ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  check ((kind = 'RETIRO') = (scope is not null))
);
create index idx_vault_status on cash_vault_movements (status, movement_date desc);
alter table cash_vault_movements enable row level security;

-- aprobar / rechazar (solo un pendiente; queda auditado)
create function review_vault_movement(p_id uuid, p_approve boolean, p_actor text, p_note text)
returns void language plpgsql as $$
declare v_status text;
begin
  select status into v_status from cash_vault_movements where id = p_id for update;
  if v_status is null then raise exception 'Movimiento inexistente'; end if;
  if v_status <> 'PENDIENTE' then raise exception 'Ya fue revisado (%).', lower(v_status); end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then
    raise exception 'Indicá el motivo del rechazo';
  end if;
  update cash_vault_movements
     set status = case when p_approve then 'APROBADO' else 'RECHAZADO' end,
         reviewed_by = p_actor, reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_approve then 'vault:approve' else 'vault:reject' end,
          'cash_vault_movements', p_id, jsonb_build_object('note', p_note));
end $$;

revoke execute on function review_vault_movement(uuid, boolean, text, text) from public, anon, authenticated;
