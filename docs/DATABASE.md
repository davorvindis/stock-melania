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
- `reservations`, `integration_events` — preparados para Wix V2

Migrations versionadas en `supabase/migrations/`. Nunca aplicar migraciones destructivas directo en producción.
