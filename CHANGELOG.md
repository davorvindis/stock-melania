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

## 2026-09-29 — Branding Melania Professional

- Logo real de melaniapro.com (recortado) en header + ícono "M".
- Paleta de marca: blush #EDB6B1, tinta #2E2E2E, rosa profundo #A85751 para acciones.
- Tipografías del sitio oficial: Bebas Neue (títulos/números) + Montserrat (cuerpo).
- Nav con estado activo (client component).

## 2026-09-29 — Adaptación mobile

- Tablas (dashboard, stock, movimientos, productos, proveedores) se vuelven tarjetas apiladas en pantallas chicas; tabla solo desde md.
- Componente MovementCard compartido; reversión con botones táctiles en mobile.

## 2026-09-29 — Conteo ciego, lotes, auditoría, Excel, búsqueda, gráficos

- Conteo físico ciego: abrir por ubicación (snapshot), operador carga físico sin ver teórico, cierre inmutable, comparación y aprobación/rechazo; aprobar genera COUNT_ADJUSTMENT idempotentes.
- Lotes: listado con búsqueda, detalle con trazabilidad completa (origen/costos/remito, saldos, historial) y cambio de estado (cuarentena/bloqueo/liberación) con motivo auditado.
- Auditoría: pantalla del log append-only con filtro.
- Exportación Excel (exceljs encapsulado): stock y movimientos.
- Stock y Movimientos: buscador, filtros (ubicación/disponibilidad/tipo) y ordenamiento por cabecera.
- Dashboard: gráficos (disponible por producto; entradas vs salidas 14 días, paleta validada CVD) y alerta de conteos a revisar.
- E2E verificado contra DB real: conteo 13→12 ajusta a 12 tras aprobar; lote en cuarentena no vendible.

## 2026-09-29 — Usuarios, roles y permisos + edición e importación de productos

- Login con email, alias o DNI + PIN de 6 dígitos (Supabase Auth). PIN temporal en el alta con cambio obligado al primer ingreso; blanqueo por admin.
- Configuración (solo ADMIN): alta de usuarios, roles ADMIN/MANAGER/OPERATOR, activar/desactivar, permisos por sección (checkboxes que sobreescriben el rol).
- Autorización server-side en páginas, actions y exports; nav filtrada por permisos. Aprobar conteos = ADMIN; revertir y estado de lote = ADMIN/MANAGER.
- El actor de cada movimiento sale de la sesión (adiós campo "tu nombre").
- Productos: edición completa (/productos/[id]) e importación masiva vía plantilla Excel con validación total antes de insertar (SKUs existentes se saltean).
- Reemplaza el Basic Auth compartido. E2E Playwright: login DNI→cambio PIN→roles→bloqueos→relogin; import crea/saltea.

## 2026-09-30 — Movimientos multi-producto + KITS

- Nuevo movimiento acepta N líneas (productos y/o kits) en una sola operación atómica e idempotente (apply_movement_batch); campo "Motivo / N° de pedido" compartido.
- KITS: tipo de producto KIT con componentes configurables (productos/[id]); al mover/vender un kit se descuentan sus componentes eligiendo lotes FEFO (vence antes, sale antes), partiendo entre lotes si hace falta. Kits sin stock propio (bloqueados en ingresos).
- Verificado en transacción con rollback: FEFO, expansión 4×(2A+1B), idempotencia, insuficiencia con mensaje claro.
