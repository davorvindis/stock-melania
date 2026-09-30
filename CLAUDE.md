@AGENTS.md

# Stock Melania — reglas del proyecto

App interna de inventario de Melania Professional, **en producción con datos reales**.

Antes de cualquier cambio leé `docs/DESARROLLO.md` (onboarding, reglas de oro, gotchas) y `docs/ARCHITECTURE.md`. Resumen crítico:

- El stock se deriva del ledger append-only `inventory_movements`; NUNCA escribir "stock = X" a mano ni borrar movimientos. Correcciones = reversión.
- Operaciones críticas = funciones SQL atómicas e idempotentes en `supabase/migrations/` (nuevas migraciones, nunca editar aplicadas; deploy con `supabase db push`).
- Autorización server-side (`requireSection`/`requireRole`) en cada página y action; RLS deniega acceso directo; service role solo en servidor.
- Local usa la MISMA base que producción: probar lógica SQL en transacciones con rollback; no crear datos de prueba sueltos.
- UI en español (es-AR), mobile-first (tarjetas en mobile, tablas en desktop), tokens de marca en `globals.css`.
- `npm run build` debe pasar antes de pushear; push a `main` deploya solo a Vercel.
- Nunca subir `.env*` ni exponer claves; nunca deshabilitar triggers/RLS como atajo.
