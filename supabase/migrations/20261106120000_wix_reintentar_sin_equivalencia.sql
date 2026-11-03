-- Equivalencia cargada después de la venta: los pedidos web pagados que esperaban ese SKU se
-- vuelven a reservar solos (antes quedaban en "A revisar" hasta tocar "Actualizar desde Wix").
-- wix_reserve_order recalcula solo los avisos de equivalencia y de stock; los demás avisos del
-- pedido (reembolso parcial, editado en Wix, etc.) se conservan.

create function wix_retry_missing_skus(p_skus text[], p_actor text) returns int
language plpgsql as $$
declare
  o record;
  v_old text[];
  v_new text[];
  v_final text[];
  v_n int := 0;
  p text;
begin
  for o in
    select co.id, co.review_reason
      from channel_orders co
     where co.channel_type is distinct from 'POS'
       and co.state in ('NEW', 'RESERVED', 'PARTIAL', 'PROCESSED')
       and co.payment_status in ('PAID', 'PARTIALLY_REFUNDED')
       and co.delivery_status is null -- ya salió: no se rearma
       and exists (
         select 1 from channel_order_items i
          where i.order_id = co.id and i.settled_at is null and not i.resolved
            and upper(i.external_sku) = any (select upper(s) from unnest(p_skus) s))
     order by co.ordered_at
  loop
    v_old := coalesce(string_to_array(o.review_reason, ' · '), '{}');
    perform wix_reserve_order(o.id, p_actor);
    select coalesce(string_to_array(review_reason, ' · '), '{}') into v_new from channel_orders where id = o.id;
    -- los avisos viejos que no son de equivalencia/stock, más los que calculó la reserva
    v_final := '{}';
    foreach p in array v_old || v_new loop
      if (p like 'Sin equivalencia:%' or p like 'Falta stock en Depósito:%') and not (p = any(v_new)) then continue; end if;
      if not (p = any(v_final)) then v_final := v_final || p; end if;
    end loop;
    update channel_orders set review_reason = nullif(array_to_string(v_final, ' · '), '') where id = o.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function wix_retry_missing_skus(text[], text) from public, anon, authenticated;
