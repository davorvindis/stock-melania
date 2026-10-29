-- Pedidos sin nombre de cliente porque la facturación vino vacía en Wix:
-- se completa con el destinatario del envío (lo nuevo ya lo toma así el sincronizador)
update channel_orders
   set customer = nullif(trim(concat_ws(' ',
         nullif(trim(raw->'recipientInfo'->'contactDetails'->>'firstName'), ''),
         nullif(trim(raw->'recipientInfo'->'contactDetails'->>'lastName'), ''))), ''),
       updated_at = now()
 where channel = 'WIX' and customer is null
   and coalesce(trim(raw->'recipientInfo'->'contactDetails'->>'firstName'), '') || coalesce(trim(raw->'recipientInfo'->'contactDetails'->>'lastName'), '') <> '';
