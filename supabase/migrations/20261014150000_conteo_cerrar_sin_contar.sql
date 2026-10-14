-- Cerrar un conteo sin haber contado nada (con motivo obligatorio): queda
-- "Cerrado sin contar" (CANCELLED), no pasa a revisión y no toca el stock.
-- Si hay líneas contadas, cierra como siempre (CLOSED) y el motivo es opcional.

alter type count_status add value if not exists 'CANCELLED';

drop function close_count(uuid, text);
create function close_count(p_count uuid, p_actor text, p_reason text default null) returns void
language plpgsql as $$
declare v_status count_status; v_pend int; v_contadas int; v_motivo text := nullif(btrim(p_reason), '');
begin
  select status into v_status from inventory_counts where id = p_count;
  if v_status is null then raise exception 'Conteo inexistente'; end if;
  if v_status <> 'OPEN' then raise exception 'El conteo ya fue cerrado.'; end if;
  select count(*) filter (where counted is null), count(*) filter (where counted is not null)
    into v_pend, v_contadas
    from inventory_count_lines where count_id = p_count;
  if v_contadas = 0 then
    if v_motivo is null then
      raise exception 'No contaste ningún producto: indicá el motivo para cerrarlo sin contar.';
    end if;
    update inventory_counts
       set status = 'CANCELLED', closed_by = p_actor, closed_at = now(), notes = v_motivo
     where id = p_count;
  else
    update inventory_counts
       set status = 'CLOSED', closed_by = p_actor, closed_at = now(), notes = coalesce(v_motivo, notes)
     where id = p_count;
  end if;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when v_contadas = 0 then 'count:cancel' else 'count:close' end,
          'inventory_counts', p_count,
          jsonb_build_object('contadas', v_contadas, 'sin_contar', v_pend, 'motivo', v_motivo));
end $$;

revoke execute on function close_count(uuid, text, text) from public, anon, authenticated;
