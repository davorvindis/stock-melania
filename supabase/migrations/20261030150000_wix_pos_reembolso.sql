-- Reembolso en el POS de una venta ya descontada del Store: queda "A revisar" y quien
-- está en el local indica si el producto volvió al mostrador (se revierte la venta y
-- vuelve al stock del Store) o no volvió (ej. fallado que se tiró: el stock no se toca).
-- Resuelto, el pedido queda "Reembolsado" y sale de Retirados.

alter table channel_orders
  add column refund_resolution text check (refund_resolution in ('RETURNED', 'NOT_RETURNED')),
  add column refund_resolved_at timestamptz,
  add column refund_resolved_by text;

create function wix_pos_refund(p_order_id uuid, p_returned boolean, p_actor text) returns text
language plpgsql as $$
declare
  o channel_orders;
  m record;
  v_revertidos int := 0;
  v_nota text;
begin
  if p_returned is null then raise exception 'Indicá si el producto volvió al Store'; end if;
  select * into o from channel_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if o.channel_type <> 'POS' then raise exception 'Solo para ventas del local (POS)'; end if;
  if o.refund_resolution is not null then return 'sin-cambios'; end if;
  if o.state <> 'PROCESSED' then raise exception 'Esta venta no se descontó del Store'; end if;
  if not (o.payment_status = 'FULLY_REFUNDED' or o.wix_status = 'CANCELED') then
    raise exception 'Esta venta no figura reembolsada en Wix';
  end if;

  if p_returned then
    -- las ventas del POS llevan idempotency_key 'wix:<pedido>:<línea>:<producto>:<n>'
    for m in
      select id from inventory_movements mv
       where mv.idempotency_key like 'wix:' || o.external_id || ':%'
         and mv.type <> 'REVERSAL'
         and not exists (select 1 from inventory_movements x where x.reversal_of = mv.id)
       order by mv.created_at
    loop
      perform reverse_movement(m.id, p_actor, 'Reembolso POS #' || coalesce(o.number, o.external_id) || ': volvió al Store');
      v_revertidos := v_revertidos + 1;
    end loop;
    v_nota := 'Volvió al Store: venta revertida, el producto volvió al stock';
  else
    v_nota := 'No volvió al Store: el stock no se tocó';
  end if;

  -- el aviso del reembolso queda resuelto en el historial de revisiones
  if o.review_reason is not null then
    insert into channel_order_reviews (order_id, reason, note, reviewed_by)
    values (p_order_id, o.review_reason, v_nota, p_actor);
  end if;
  update channel_orders
     set state = 'CANCELED',
         refund_resolution = case when p_returned then 'RETURNED' else 'NOT_RETURNED' end,
         refund_resolved_at = now(),
         refund_resolved_by = p_actor,
         delivery_status = null,
         delivered_at = null,
         delivered_by = null,
         review_resolved = review_resolved || coalesce(string_to_array(review_reason, ' · '), '{}'),
         review_reason = null,
         updated_at = now()
   where id = p_order_id;
  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'wix:pos_refund', 'channel_orders', p_order_id,
          jsonb_build_object('number', o.number, 'returned', p_returned, 'reversed', v_revertidos));
  return case when p_returned then 'devuelto:' || v_revertidos else 'no-devuelto' end;
end $$;

revoke execute on function wix_pos_refund(uuid, boolean, text) from public, anon, authenticated;

-- reembolsos del POS ya resueltos a mano (revertidos en Movimientos y marcados revisados)
update channel_orders o
   set state = 'CANCELED',
       refund_resolution = case when exists (
             select 1 from inventory_movements mv
              where mv.idempotency_key like 'wix:' || o.external_id || ':%' and mv.type <> 'REVERSAL'
                and not exists (select 1 from inventory_movements x where x.reversal_of = mv.id))
           then 'NOT_RETURNED' else 'RETURNED' end,
       refund_resolved_at = now(),
       refund_resolved_by = 'Revisado a mano',
       delivery_status = null,
       delivered_at = null,
       delivered_by = null,
       updated_at = now()
 where o.channel_type = 'POS' and o.state = 'PROCESSED' and o.review_reason is null
   and (o.payment_status = 'FULLY_REFUNDED' or o.wix_status = 'CANCELED');
