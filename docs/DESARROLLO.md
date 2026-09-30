# Guía de desarrollo — Stock Melania

Onboarding para desarrollar y mantener el proyecto. Leé esto entero antes del primer cambio.

## Stack

- **Next.js 16** (App Router, `src/app/`) + TypeScript + Tailwind CSS v4
- **Supabase**: PostgreSQL + Auth (proyecto `kpybwbjhiitezthammhz`, región São Paulo, org "melania")
- **Vercel**: hosting. Cada push a `main` en GitHub deploya solo a https://stock-melania.vercel.app
- **GitHub**: `davorvindis/stock-melania` (privado)

## Arranque local

```bash
git clone https://github.com/davorvindis/stock-melania.git
cd stock-melania
npm install
# pedir el archivo .env.local por canal seguro (NUNCA está en el repo)
npm run dev   # http://localhost:3000 — usa la MISMA base de producción
```

⚠️ **No hay base de datos de prueba separada**: local apunta a producción. Cualquier movimiento que hagas desde local es real. Para probar lógica SQL usá transacciones con `rollback` (ver abajo).

`.env.local` contiene: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (solo servidor, jamás al browser), `SUPABASE_DB_PASSWORD`.

## Reglas de oro (NO negociables)

1. **El stock nunca se edita**: se deriva del ledger `inventory_movements` (append-only, triggers en DB impiden UPDATE/DELETE). Errores → movimiento de REVERSIÓN. `stock_balances` es una proyección que se actualiza en la misma transacción.
2. **Toda operación crítica es una función SQL** (`apply_movement`, `create_stock_entry`, `apply_movement_batch`, `assemble_kits`, `adjust_stock_to`, etc.): atómica, idempotente (idempotency_key) y con lock de fila. La lógica de stock NO vive en React ni en TypeScript.
3. **RLS deniega todo acceso directo**: el único camino a la DB es el servidor Next con `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/db.ts`). La autorización real está en `requireSection`/`requireRole` dentro de páginas y server actions — nunca solo ocultar botones.
4. **Nunca** subir `.env*`, exponer la service role key, ni hacer deletes destructivos de ledger/auditoría.
5. Productos/proveedores/ubicaciones **con historial no se borran**: se desactivan.

## Estructura

```
src/lib/db.ts          cliente Supabase (service role, server-only)
src/lib/auth.ts        sesión, roles, permisos por sección (SECTIONS, can, requireSection)
src/lib/auth-actions.ts login/PIN/gestión de usuarios
src/lib/actions.ts     server actions de negocio (validación Zod → RPC)
src/lib/queries.ts     lecturas (joins anidados supabase-js)
src/lib/export.ts      Excel (exceljs) + parser de importación
src/app/<sección>/     páginas server-rendered (force-dynamic) en español
src/components/        ui.tsx (tokens), nav, submit-button (spinner), lineas-movimiento
src/proxy.ts           middleware de sesión (@supabase/ssr) — sin sesión → /login
supabase/migrations/   schema versionado
```

## Flujo de cambios

1. Rama o directo a `main` (commits chicos y descriptivos).
2. Cambios de schema: `supabase migration new <nombre>` → escribir SQL → `supabase db push --password $SUPABASE_DB_PASSWORD` (el CLI ya está linkeado; migración nueva SIEMPRE, nunca editar una aplicada).
3. `npm run build` antes de pushear (corre TypeScript + lint).
4. `git push` → Vercel deploya solo (~1 min). Rollback: Vercel → Deployments → Promote anterior, o `git revert` + push.
5. Probar lógica SQL sin ensuciar datos: en `psql`, envolver en `begin; ... rollback;`.

Conexión psql directa (el host db.*.supabase.co no resuelve; usar pooler):
`psql "postgresql://postgres.kpybwbjhiitezthammhz:$SUPABASE_DB_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"`

## Diseño

Marca Melania Professional: tokens en `globals.css` (@theme) — blush `#EDB6B1`, tinta `#2E2E2E`, rose-deep `#A85751` para acciones. Bebas Neue (títulos) + Montserrat (cuerpo) vía next/font. Mobile-first: tablas de escritorio + tarjetas apiladas en `md:hidden`. El blush puro no tiene contraste para texto: usar rose-deep/ink.

## Usuarios y permisos

Login: email/alias/DNI + PIN 6 dígitos (Supabase Auth; el PIN es la password). Alta/blanqueo desde /configuracion (solo ADMIN). Roles ADMIN/MANAGER/OPERATOR + overrides por sección (`profiles.permissions` jsonb). El actor de cada movimiento sale de la sesión.

Blanqueo de emergencia por consola (si un ADMIN queda afuera): con la service key, `auth.admin.updateUserById(id, { password: nuevoPin })` + `profiles.must_change_pin = true`.

## Gotchas conocidos

- Next 16: `middleware` se llama `proxy.ts`; `params`/`searchParams` son Promise (await).
- Agregar un valor a un enum SQL exige actualizar también los `z.enum([...])` de `actions.ts` y los arrays TIPOS de las páginas.
- Cambiar la password de un usuario invalida su sesión: re-loguear (ver `cambiarPin`).
- Tras un deploy, pestañas abiertas viejas pueden fallar al enviar formularios (action id viejo): recargar.
- El upsert de balances usa UPDATE-primero porque Postgres valida el CHECK (quantity >= 0) antes de resolver ON CONFLICT.
- Kits: armado físico (assemble_kits consume componentes FEFO y suma stock del kit). El kit vendible es stock propio; no hay descuento "virtual" en la venta.

## Pendientes conocidos

Tests automatizados en CI, backup programado de la DB (plan free retiene poco), adjuntos de remito/factura (Supabase Storage), integración Wix (docs/WIX_V2.md), PWA, escáner de códigos.
