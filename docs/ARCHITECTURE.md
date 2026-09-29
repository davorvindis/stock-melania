# Arquitectura — Stock Melania

## Principio central

`inventory_movements` es un **ledger append-only**: todo cambio de stock es un movimiento confirmado con actor, timestamp de servidor, producto, lote, cantidad, origen/destino, tipo y motivo. El stock actual se deriva del ledger (con `stock_balances` como proyección materializada, actualizada atómicamente en la misma transacción).

Errores → movimiento de REVERSIÓN vinculado al original. Nunca update/delete destructivo.

## Capas

1. **UI (Next.js App Router)** — pantallas en español, mobile-first para depósito.
2. **Server Actions / Route Handlers** — validación con Zod, autorización server-side, idempotency keys en operaciones de escritura.
3. **PostgreSQL (Supabase)** — funciones RPC transaccionales para operaciones críticas (ingreso, transferencia, ajuste), RLS por rol, constraints (FK, unique, check ≥ 0 en balances).

## Protecciones obligatorias

- Transacciones atómicas: transferencia descuenta origen y suma destino en una sola tx.
- Idempotencia: cada operación de escritura lleva una clave única; requests repetidos/doble click no duplican.
- Concurrencia: lock de fila sobre `stock_balances` (SELECT ... FOR UPDATE) antes de descontar; check constraint impide negativo.
- Autorización real en DB/servidor, no solo botones ocultos.

## Estado

- [x] Scaffold Next.js + TS + Tailwind (Paso 1)
- [ ] Proyecto Supabase + schema inicial (Paso 2)
- [ ] Auth + roles
- [ ] CRUD productos/lotes/ubicaciones/proveedores
- [ ] Ingresos + ledger + transferencias
- [ ] Cuarentena + conteo ciego + aprobaciones
- [ ] Auditoría + exportación + dashboard
