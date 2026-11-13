-- Revisión de conteos producto por producto (propuesta de Yura y Juan).
-- Al revisar un conteo cerrado, cada diferencia se APRUEBA (ajusta stock ya) o se manda
-- A REVISAR. Si quedan productos a revisar, el conteo pasa a RECOUNT ("Recontar pendientes"):
-- el equipo vuelve a contar solo esos (a ciegas) y lo devuelve a revisión. Cuando no queda
-- ninguno, el conteo queda APROBADO. Lo aprobado antes no se vuelve a ajustar.
-- Al recontar, el teórico se toma del stock de ese momento (pudo haber ventas en el medio);
-- el primer conteo queda guardado en first_expected / first_counted.

alter type count_status add value if not exists 'RECOUNT';

alter table inventory_count_lines
  add column review_status text check (review_status in ('APROBADO', 'A_REVISAR')),
  add column review_note text,
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add column recount_round int not null default 0,
  add column first_expected numeric(12,3),
  add column first_counted numeric(12,3),
  add column recounted_by text,
  add column recounted_at timestamptz;

-- decide las líneas pendientes de un conteo cerrado.
-- p_aprobar: ids de línea a aprobar; p_revisar: [{line_id, note}] a recontar.
-- Toda línea contada con diferencia y sin decidir tiene que estar en una de las dos listas.
-- Las líneas contadas sin diferencia se aprueban solas (no mueven stock).
create function review_count_lines(p_count uuid, p_actor text, p_aprobar uuid[], p_revisar jsonb, p_reason text)
returns text language plpgsql as $$
declare
  c inventory_counts%rowtype;
  l record;
  v_diff numeric;
  v_faltan int;
  v_revisar uuid[];
  v_estado count_status;
begin
  select * into c from inventory_counts where id = p_count for update;
  if c.id is null then raise exception 'Conteo inexistente'; end if;
  if c.status <> 'CLOSED' then raise exception 'Solo se puede revisar un conteo cerrado.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Indicá el motivo de la decisión.'; end if;
  v_revisar := array(select (e->>'line_id')::uuid from jsonb_array_elements(coalesce(p_revisar, '[]'::jsonb)) e);
  if exists (select 1 from unnest(coalesce(p_aprobar, '{}')) a where a = any (v_revisar)) then
    raise exception 'Un producto no puede estar aprobado y a revisar a la vez.';
  end if;
  select count(*) into v_faltan
    from inventory_count_lines
   where count_id = p_count and counted is not null and counted <> expected and review_status is null
     and not (id = any (coalesce(p_aprobar, '{}'))) and not (id = any (v_revisar));
  if v_faltan > 0 then
    raise exception 'Faltan decidir % producto(s) con diferencia (aprobar o mandar a revisar).', v_faltan;
  end if;

  -- aprobadas: ajuste por la diferencia (idempotente por línea y vuelta de recuento)
  for l in
    select * from inventory_count_lines
     where count_id = p_count and review_status is null and counted is not null
       and (counted = expected or id = any (coalesce(p_aprobar, '{}')))
     for update
  loop
    v_diff := l.counted - l.expected;
    if v_diff < 0 then
      perform apply_movement('COUNT_ADJUSTMENT', l.product_id, l.lot_id, -v_diff,
        c.location_id, null, p_actor, p_reason, 'Ajuste por conteo ' || p_count,
        null, null, 'count:' || p_count || ':' || l.id || case when l.recount_round > 0 then ':r' || l.recount_round else '' end);
    elsif v_diff > 0 then
      perform apply_movement('COUNT_ADJUSTMENT', l.product_id, l.lot_id, v_diff,
        null, c.location_id, p_actor, p_reason, 'Ajuste por conteo ' || p_count,
        null, null, 'count:' || p_count || ':' || l.id || case when l.recount_round > 0 then ':r' || l.recount_round else '' end);
    end if;
    update inventory_count_lines
       set review_status = 'APROBADO', reviewed_by = p_actor, reviewed_at = now()
     where id = l.id;
  end loop;

  -- a revisar: vuelven al equipo para recontar
  update inventory_count_lines cl
     set review_status = 'A_REVISAR', reviewed_by = p_actor, reviewed_at = now(),
         review_note = nullif(btrim(e->>'note'), ''),
         recount_round = cl.recount_round + 1
    from jsonb_array_elements(coalesce(p_revisar, '[]'::jsonb)) e
   where cl.id = (e->>'line_id')::uuid and cl.count_id = p_count;

  v_estado := case when exists (select 1 from inventory_count_lines where count_id = p_count and review_status = 'A_REVISAR')
                   then 'RECOUNT'::count_status else 'APPROVED'::count_status end;
  update inventory_counts
     set status = v_estado, reviewed_by = p_actor, reviewed_at = now(),
         review_reason = case when review_reason is null then p_reason else review_reason || ' · ' || p_reason end
   where id = p_count;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when v_estado = 'APPROVED' then 'count:approve' else 'count:partial_approve' end,
          'inventory_counts', p_count,
          jsonb_build_object('reason', p_reason, 'aprobadas', coalesce(array_length(p_aprobar, 1), 0),
                             'a_revisar', coalesce(array_length(v_revisar, 1), 0)));
  return v_estado::text;
end $$;

-- recuento de los productos marcados a revisar (a ciegas). p_lines: [{line_id, counted}].
-- p_cerrar: devuelve el conteo a revisión (exige todos los pendientes recontados).
create function save_recount_lines(p_count uuid, p_lines jsonb, p_actor text, p_cerrar boolean)
returns void language plpgsql as $$
declare
  c inventory_counts%rowtype;
  e jsonb;
  l inventory_count_lines%rowtype;
  v_teorico numeric;
  v_pend int;
begin
  select * into c from inventory_counts where id = p_count for update;
  if c.id is null then raise exception 'Conteo inexistente'; end if;
  if c.status <> 'RECOUNT' then raise exception 'Este conteo no tiene productos para recontar.'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if nullif(e->>'counted', '') is null then continue; end if;
    if (e->>'counted')::numeric < 0 then raise exception 'Las cantidades no pueden ser negativas'; end if;
    select * into l from inventory_count_lines
     where id = (e->>'line_id')::uuid and count_id = p_count and review_status = 'A_REVISAR' for update;
    if l.id is null then continue; end if;
    -- teórico de ahora (pudo haber ventas desde el primer conteo)
    select coalesce(sum(quantity), 0) into v_teorico
      from stock_balances
     where product_id = l.product_id and location_id = c.location_id
       and lot_id is not distinct from l.lot_id;
    update inventory_count_lines
       set first_expected = coalesce(first_expected, expected),
           first_counted = coalesce(first_counted, counted),
           expected = v_teorico,
           counted = (e->>'counted')::numeric,
           recounted_by = p_actor, recounted_at = now(), updated_at = now()
     where id = l.id;
  end loop;
  if p_cerrar then
    select count(*) into v_pend from inventory_count_lines
     where count_id = p_count and review_status = 'A_REVISAR'
       and (recounted_at is null or recounted_at < reviewed_at);
    if v_pend > 0 then
      raise exception 'Faltan recontar % producto(s).', v_pend;
    end if;
    update inventory_count_lines set review_status = null
     where count_id = p_count and review_status = 'A_REVISAR';
    update inventory_counts set status = 'CLOSED', closed_by = p_actor, closed_at = now() where id = p_count;
    insert into audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'count:recount', 'inventory_counts', p_count, null);
  end if;
end $$;

-- aprobar / rechazar todo (botones de siempre): aprobar = todas las pendientes;
-- rechazar no toca el stock de lo pendiente (lo ya aprobado queda aprobado)
create or replace function review_count(p_count uuid, p_actor text, p_approve boolean, p_reason text) returns void
language plpgsql as $$
declare c inventory_counts%rowtype;
begin
  select * into c from inventory_counts where id = p_count;
  if c.id is null then raise exception 'Conteo inexistente'; end if;
  if c.status <> 'CLOSED' then raise exception 'Solo se puede revisar un conteo cerrado.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Indicá el motivo de la decisión.'; end if;
  if p_approve then
    perform review_count_lines(p_count, p_actor,
      array(select id from inventory_count_lines where count_id = p_count and review_status is null and counted is not null),
      '[]'::jsonb, p_reason);
  else
    update inventory_counts set status = 'REJECTED', reviewed_by = p_actor, reviewed_at = now(),
           review_reason = case when review_reason is null then p_reason else review_reason || ' · ' || p_reason end
     where id = p_count;
    insert into audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'count:reject', 'inventory_counts', p_count, jsonb_build_object('reason', p_reason));
  end if;
end $$;

revoke execute on function review_count_lines(uuid, text, uuid[], jsonb, text) from public, anon, authenticated;
revoke execute on function save_recount_lines(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke execute on function review_count(uuid, text, boolean, text) from public, anon, authenticated;
