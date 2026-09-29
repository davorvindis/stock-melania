# Changelog — Stock Melania

## 2026-09-29 — Paso 2b: schema núcleo + app operativa

- Migrations: products, lots, locations, suppliers, stock_entries(+lines), inventory_movements (ledger append-only con triggers anti update/delete), stock_balances (proyección), audit_logs. RLS en todo (acceso solo vía servidor).
- Funciones atómicas: `apply_movement` (idempotente, valida lote liberado en ventas), `create_stock_entry`, `reverse_movement`, `_adjust_balance` (UPDATE-primero para respetar CHECK >= 0; el upsert directo con delta negativo violaba el check antes de resolver el conflicto).
- Seed piloto (§28): 5 productos, 5 ubicaciones, 6 proveedores, ingreso 100 + transferencia 20 + venta 5 + regalo 2 + cuarentena 10. Verificado: balances exactos, idempotencia, rechazo de stock negativo, ledger inmutable.
- App (ES, mobile-first): Dashboard, Stock, Nuevo ingreso, Nuevo movimiento, Movimientos (con reversión), Productos, Proveedores.
- Candado Basic Auth vía `proxy.ts` + APP_PASSWORD (Vercel Production). Sin usuarios/roles todavía.

## 2026-09-29 — Paso 2a: Supabase

- Proyecto Supabase free creado: org `melania`, ref `kpybwbjhiitezthammhz`, región São Paulo.
- CLI linkeado (`supabase/config.toml`), keys en `.env.local` y en Vercel (Production + Development).
- Sin auth/roles por ahora (decisión del dueño: arrancar sin usuarios).

## 2026-09-29 — Paso 1

- Scaffold Next.js (App Router) + TypeScript + Tailwind + ESLint.
- Documentación base (`docs/`), `.env.example`, `.gitignore`.
- Repo GitHub (davorvindis/stock-melania) + deploy inicial en Vercel.
