# Stock Melania

Sistema interno de inventario de Melania. Fuente de verdad del stock.

**Regla esencial:** el stock NO se edita a mano — se deriva de movimientos confirmados. Los movimientos confirmados no se borran ni modifican; los errores se corrigen con reversión/compensación.

## Stack

- Next.js (App Router) + TypeScript
- PostgreSQL vía Supabase (Auth, RLS, Storage privado)
- Tailwind CSS
- Hosting: Vercel · Repo: GitHub

## Alcance V1

Autenticación, roles (ADMIN/MANAGER/OPERATOR), productos/SKU, lotes con vencimiento, ubicaciones, proveedores, ingresos, movimientos (ledger), transferencias atómicas, cuarentena, conteo físico ciego, aprobación de diferencias, auditoría, exportación Excel y dashboard operativo.

Fuera de V1: integración Wix (preparada, V2), Correo Argentino, BI de ventas.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar con credenciales Supabase (NUNCA commitear)
npm run dev
```

## Documentación

- `docs/ARCHITECTURE.md` — arquitectura y decisiones
- `docs/DATABASE.md` — modelo de datos, migrations
- `docs/OPERATIONS.md` — operatoria: usuarios, roles, ubicaciones, deploy, rollback
- `docs/SECURITY.md` — RLS, secretos, storage privado
- `docs/WIX_V2.md` — plan de integración Wix
- `docs/TROUBLESHOOTING.md` — problemas comunes y recuperación
- `CHANGELOG.md` — historial de cambios

## Reglas de oro

1. Nunca subir `.env*` al repo (ya está en `.gitignore`).
2. Nunca exponer la service role key de Supabase al browser.
3. Nunca hard-delete de movimientos, productos con historial ni audit logs.
4. Migraciones destructivas jamás directo en producción.
