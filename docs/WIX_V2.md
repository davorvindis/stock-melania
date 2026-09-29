# Wix — V2 (no bloquea V1)

Preparado en el modelo: `reservations`, `integration_events`, campo disponible = eligible_on_hand − reserved.

Plan V2: mapear wix_product_id/variant ↔ SKU; webhooks de pedidos con idempotencia (event_id/order_id únicos); reserva → egreso → liberación según estado del pedido; reintentos + dead-letter; reconciliación periódica; Stock Melania es fuente de verdad y sincroniza "available" hacia Wix.

**Antes de programar:** definir con el dueño qué estado de Wix reserva y cuál descuenta definitivamente.
