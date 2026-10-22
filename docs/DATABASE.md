# Base de datos — Stock Melania

Pendiente: se define en Paso 2 (proyecto Supabase + migrations iniciales).

## ERD V1 propuesto (resumen)

- `profiles` (1:1 auth.users, rol: ADMIN/MANAGER/OPERATOR)
- `products` (sku único, tipo, unidad, stock_min, maneja_lote, maneja_vencimiento, activo)
- `categories`, `suppliers`, `locations`
- `lots` (producto, código, vencimiento, estado: ACTIVE/QUARANTINE/BLOCKED/EXPIRED/DEPLETED)
- `stock_entries` + `stock_entry_lines` (ingreso: remito, factura, proveedor, costos históricos)
- `inventory_movements` — **ledger append-only**
- `stock_balances` — proyección (producto × lote × ubicación), actualizada en la misma tx
- `transfers` + `transfer_lines` (CREATED → SENT → RECEIVED opcional)
- `inventory_counts` + `inventory_count_lines` (conteo ciego)
- `adjustment_approvals`
- `documents` (Storage privado, signed URLs)
- `audit_logs` — append-only
- `cash_closings` + `cash_closing_lines` + `cash_closing_expenses` + `cash_closing_views` — cierre de caja diario (pestaña "Cierre de caja", sección `caja`); se guarda con `save_cash_closing` y al enviarse se respalda el Excel del mes en `backups/caja/INFORMES-AAAA-MM.xlsx`
- `channel_skus` + `channel_sku_lines` — equivalencias SKU de Wix → productos y cantidades (ver `docs/WIX_V2.md`)
- `reservations`, `integration_events` — **todavía no creadas**: se crean al programar la integración con Wix

Migrations versionadas en `supabase/migrations/`. Nunca aplicar migraciones destructivas directo en producción.


## Integración Wix (migraciones `wix_integracion`, `wix_cron`)

Ver `docs/WIX_V2.md`. Tablas: `app_settings`, `integration_events`, `channel_orders`, `channel_order_items`, `reservations`, `channel_order_fulfillments`, `wix_sync_queue`; vista `v_stock_disponible` (físico, vendible, reservado, disponible por producto y ubicación). `reservations` nunca se borra: pasa a CONSUMED (egreso hecho) o RELEASED. `channel_order_fulfillments` registra quién despachó qué cantidad de cada ítem.
