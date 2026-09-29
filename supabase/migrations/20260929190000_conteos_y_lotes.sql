-- Conteo físico ciego + gestión de estado de lotes.
-- El operador ingresa cantidades físicas SIN ver el teórico (snapshot al abrir).
-- Las diferencias solo ajustan stock tras aprobación explícita (COUNT_ADJUSTMENT).

create type count_status as enum ('OPEN','CLOSED','APPROVED','REJECTED');

create table inventory_counts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  status count_status not null default 'OPEN',
  opened_by text not null,
  opened_at timestamptz not null default now(),
  closed_by text,
  closed_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  review_reason text,
  notes text
);

create table inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references inventory_counts(id),
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  expected numeric(12,3) not null,
  counted numeric(12,3) check (counted >= 0),
  updated_at timestamptz not null default now()
);
create unique index count_lines_key on inventory_count_lines
  (count_id, product_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table inventory_counts enable row level security;
alter table inventory_count_lines enable row level security;

-- abre sesión de conteo con snapshot del stock esperado de la ubicación
create function open_count(p_location uuid, p_actor text) returns uuid
language plpgsql as $$
declare v_id uuid; v_n int;
begin
  if exists (select 1 from inventory_counts where location_id = p_location and status = 'OPEN') then
    raise exception 'Ya hay un conteo abierto para esta ubicación. Cerralo antes de abrir otro.';
  end if;
  insert into inventory_counts (location_id, opened_by) values (p_location, p_actor)
  returning id into v_id;
  insert into inventory_count_lines (count_id, product_id, lot_id, expected)
  select v_id, product_id, lot_id, quantity
  from stock_balances
  where location_id = p_location and quantity > 0;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No hay stock esperado en esta ubicación: nada para contar.';
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'count:open', 'inventory_counts', v_id, jsonb_build_object('location', p_location, 'lines', v_n));
  return v_id;
end $$;

-- guarda cantidades físicas (p_lines: [{line_id, counted}]) mientras el conteo está abierto
create function save_count_lines(p_count uuid, p_lines jsonb, p_actor text) returns void
language plpgsql as $$
declare l jsonb; v_status count_status;
begin
  select status into v_status from inventory_counts where id = p_count;
  if v_status is null then raise exception 'Conteo inexistente'; end if;
  if v_status <> 'OPEN' then raise exception 'El conteo ya está cerrado: no se puede modificar.'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if nullif(l->>'counted','') is not null then
      update inventory_count_lines
         set counted = (l->>'counted')::numeric, updated_at = now()
       where id = (l->>'line_id')::uuid and count_id = p_count;
    end if;
  end loop;
end $$;

-- cierra el conteo: exige todas las líneas contadas; desde acá no se modifica más
create function close_count(p_count uuid, p_actor text) returns void
language plpgsql as $$
declare v_status count_status; v_pend int;
begin
  select status into v_status from inventory_counts where id = p_count;
  if v_status is null then raise exception 'Conteo inexistente'; end if;
  if v_status <> 'OPEN' then raise exception 'El conteo ya fue cerrado.'; end if;
  select count(*) into v_pend from inventory_count_lines where count_id = p_count and counted is null;
  if v_pend > 0 then
    raise exception 'Faltan % líneas por contar. Completá todo antes de cerrar.', v_pend;
  end if;
  update inventory_counts set status = 'CLOSED', closed_by = p_actor, closed_at = now()
   where id = p_count;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'count:close', 'inventory_counts', p_count, null);
end $$;

-- revisión: aprobar genera movimientos COUNT_ADJUSTMENT por cada diferencia; rechazar no toca stock
create function review_count(p_count uuid, p_actor text, p_approve boolean, p_reason text) returns void
language plpgsql as $$
declare c inventory_counts%rowtype; l record; v_diff numeric;
begin
  select * into c from inventory_counts where id = p_count;
  if c.id is null then raise exception 'Conteo inexistente'; end if;
  if c.status <> 'CLOSED' then raise exception 'Solo se puede revisar un conteo cerrado.'; end if;
  if p_reason is null or p_reason = '' then raise exception 'Indicá el motivo de la decisión.'; end if;
  if p_approve then
    for l in select * from inventory_count_lines where count_id = p_count and counted <> expected loop
      v_diff := l.counted - l.expected;
      if v_diff < 0 then
        perform apply_movement('COUNT_ADJUSTMENT', l.product_id, l.lot_id, -v_diff,
          c.location_id, null, p_actor, p_reason, 'Ajuste por conteo ' || p_count,
          null, null, 'count:' || p_count || ':' || l.id);
      else
        perform apply_movement('COUNT_ADJUSTMENT', l.product_id, l.lot_id, v_diff,
          null, c.location_id, p_actor, p_reason, 'Ajuste por conteo ' || p_count,
          null, null, 'count:' || p_count || ':' || l.id);
      end if;
    end loop;
    update inventory_counts set status = 'APPROVED', reviewed_by = p_actor, reviewed_at = now(), review_reason = p_reason
     where id = p_count;
  else
    update inventory_counts set status = 'REJECTED', reviewed_by = p_actor, reviewed_at = now(), review_reason = p_reason
     where id = p_count;
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_approve then 'count:approve' else 'count:reject' end,
          'inventory_counts', p_count, jsonb_build_object('reason', p_reason));
end $$;

-- cambia estado de un lote (cuarentena/bloqueo/liberación) con motivo obligatorio
create function change_lot_status(p_lot uuid, p_status lot_status, p_actor text, p_reason text) returns void
language plpgsql as $$
declare v_old lot_status;
begin
  if p_reason is null or p_reason = '' then raise exception 'Indicá el motivo del cambio de estado.'; end if;
  select status into v_old from lots where id = p_lot;
  if v_old is null then raise exception 'Lote inexistente'; end if;
  if v_old = p_status then raise exception 'El lote ya está en ese estado.'; end if;
  update lots set status = p_status where id = p_lot;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'lot:status', 'lots', p_lot,
          jsonb_build_object('before', v_old, 'after', p_status, 'reason', p_reason));
end $$;

revoke execute on function open_count(uuid, text) from public, anon, authenticated;
revoke execute on function save_count_lines(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function close_count(uuid, text) from public, anon, authenticated;
revoke execute on function review_count(uuid, text, boolean, text) from public, anon, authenticated;
revoke execute on function change_lot_status(uuid, lot_status, text, text) from public, anon, authenticated;
