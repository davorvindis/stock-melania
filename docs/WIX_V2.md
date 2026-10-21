# Wix — integración de ventas (V2)

## Estado al 21/10/2026

- **SKU cargados en Wix** (Wix Stores): 276 productos/variantes tienen SKU. Wix exige SKU únicos, así que **no todos coinciden con un SKU de Stock Melania**:
  - producto principal → SKU exacto nuestro (ej. `MEL-MOUSS-60ML`)
  - versiones repetidas → sufijo: `-MAY`, `-NAV`, `-BLACK`, `-CYBER`, `-SV`, `-HOT`, `-2`… (ej. `MEL-MOUSS-60ML-MAY`)
  - packs → `-X10`, `-X25`, `-X50` (ej. `MEL-PRO-GLUE-7ML-X10` descuenta 10)
  - combos → `COMBO-…` (descuentan varios productos); `MEL-PERM-SETT-10ML(-Xn)` = Perm 1 + Setting 2 10ml
- **Equivalencias** en la base: `channel_skus` (channel `WIX`, `external_sku` único) + `channel_sku_lines` (product_id, quantity por unidad vendida). Pantalla `/equivalencias` (sección `wix`) para que el dueño agregue o corrija combos. Carga inicial: 275 SKU / 460 líneas, revisada por el dueño.
- **Resolver un SKU de Wix**: `select * from resolve_channel_sku('WIX', '<sku>')` → filas `(product_id, sku, name, quantity, is_kit)` por **1 unidad** vendida; vacío si no existe o está desactivado. Multiplicar `quantity` por la cantidad del ítem del pedido. Si `is_kit`, descontar con `apply_movement_batch` (`is_kit: true`, consume componentes FEFO).
- ~39 productos con SKU en Wix **no tienen seguimiento de inventario** (InStock/OutOfStock), sobre todo los packs "Mayorista 10/20/30%".
- `reservations` / `integration_events` **no existen todavía** en la base (estaban solo planificadas): crearlas como migración nueva.

## Plan

Webhook de pedido de Wix → idempotencia por `order_id`/ítem (`integration_events` con clave única) → por cada ítem: `resolve_channel_sku` → egreso `SALE`/`WHOLESALE_SALE` desde la ubicación de la tienda online con `apply_movement`/`apply_movement_batch` y `p_idem` derivado del pedido → reintentos + dead-letter → reconciliación periódica → Stock Melania es la fuente de verdad y sincroniza "available" hacia Wix.

- Ítem con SKU sin equivalencia (o sin SKU): no descontar; registrar el evento y avisar en el Dashboard.
- Las funciones SQL solo se ejecutan con service role (server); RLS deniega acceso directo.
- Lotes en **caja cerrada** (`lots.sealed`) y lotes no liberados no se pueden vender: `apply_movement` lo rechaza.

**Decisiones del dueño (pendientes de confirmar con Davor):** descuenta el pedido **pagado/aprobado**; cancelación/reembolso → reversión automática del movimiento (`reverse_movement`) con aviso en el Dashboard.
