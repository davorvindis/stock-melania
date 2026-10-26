-- "Marcar como revisado" en pedidos Wix: limpia el aviso "A revisar" dejando
-- registro de quién lo resolvió, cuándo y qué se hizo. Los avisos ya revisados
-- no se vuelven a agregar si Wix reenvía el pedido (un aviso distinto sí).

alter table channel_orders add column review_resolved text[] not null default '{}';

create table channel_order_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references channel_orders(id) on delete cascade,
  reason text not null,      -- el aviso que estaba
  note text not null,        -- qué se hizo
  reviewed_by text not null,
  reviewed_at timestamptz not null default now()
);
create index idx_order_reviews_order on channel_order_reviews (order_id, reviewed_at desc);
alter table channel_order_reviews enable row level security;

-- igual que antes, pero no vuelve a agregar un aviso que ya se revisó
create or replace function _wix_append_review(p_order uuid, p_text text) returns void language plpgsql as $$
begin
  update channel_orders
     set review_reason = case when review_reason is null then p_text
                              when position(p_text in review_reason) > 0 then review_reason
                              else review_reason || ' · ' || p_text end
   where id = p_order
     and not (p_text = any(review_resolved));
end $$;

create function wix_mark_reviewed(p_order_id uuid, p_note text, p_actor text) returns void
language plpgsql as $$
declare v_reason text;
begin
  if coalesce(trim(p_note), '') = '' then raise exception 'Contá qué se hizo para resolverlo'; end if;
  select review_reason into v_reason from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if v_reason is null then raise exception 'Este pedido no tiene nada para revisar'; end if;
  insert into channel_order_reviews (order_id, reason, note, reviewed_by)
  values (p_order_id, v_reason, trim(p_note), p_actor);
  update channel_orders
     set review_resolved = review_resolved || string_to_array(v_reason, ' · '),
         review_reason = null,
         updated_at = now()
   where id = p_order_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:order_reviewed', 'channel_orders', p_order_id,
          jsonb_build_object('reason', v_reason, 'note', trim(p_note)));
end $$;

revoke execute on function _wix_append_review(uuid, text) from public, anon, authenticated;
revoke execute on function wix_mark_reviewed(uuid, text, text) from public, anon, authenticated;
