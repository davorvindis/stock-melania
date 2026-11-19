-- Pedidos con pago parcial (Wix PARTIALLY_PAID, ej. mayorista que pagó una parte y retira todo
-- cuando completa): se reservan igual que los pagados, así la mercadería queda apartada.
-- Acá se actualizan los reintentos automáticos (equivalencia cargada después / SKU completado
-- por producto) para que también incluyan esos pedidos.


create or replace function wix_retry_missing_skus(p_skus text[], p_actor text) returns int
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
       and co.payment_status in ('PAID', 'PARTIALLY_REFUNDED', 'PARTIALLY_PAID')
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


create or replace function wix_fill_missing_skus(p_actor text) returns int
language plpgsql as $$
declare
  v_skus text[];
begin
  with candidatos as (
    select i.id, cs.external_sku, count(*) over (partition by i.id) n
      from channel_order_items i
      join channel_orders co on co.id = i.order_id
      cross join lateral jsonb_array_elements(coalesce(co.raw->'lineItems', '[]'::jsonb)) l
      join channel_skus cs
        on cs.active
       and cs.wix_product_id = l->'catalogReference'->>'catalogItemId'
       and cs.wix_variant_id = coalesce(l->'catalogReference'->'options'->>'variantId', '00000000-0000-0000-0000-000000000000')
     where i.external_sku is null and i.settled_at is null and not i.resolved
       and l->>'id' = i.external_line_id
       and co.channel_type is distinct from 'POS'
       and co.state in ('NEW', 'RESERVED', 'PARTIAL', 'PROCESSED')
       and co.payment_status in ('PAID', 'PARTIALLY_REFUNDED', 'PARTIALLY_PAID')
       and co.delivery_status is null
  ), completados as (
    update channel_order_items i set external_sku = c.external_sku
      from candidatos c
     where c.id = i.id and c.n = 1
    returning i.external_sku
  )
  select coalesce(array_agg(distinct external_sku), '{}') into v_skus from completados;
  if array_length(v_skus, 1) is null then return 0; end if;
  return wix_retry_missing_skus(v_skus, p_actor);
end $$;
revoke execute on function wix_fill_missing_skus(text) from public, anon, authenticated;
