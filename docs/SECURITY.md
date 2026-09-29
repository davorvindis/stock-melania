# Seguridad — Stock Melania

- Secretos solo en variables de entorno (Vercel / `.env.local`). Nunca en el repo.
- `SUPABASE_SERVICE_ROLE_KEY` solo en servidor. Jamás `NEXT_PUBLIC_`.
- RLS activo en todas las tablas; autorización server-side, no solo UI.
- Storage privado, acceso por signed URLs.
- Auth: Supabase Auth (nada casero). 2FA para admins cuando se configure.
- Validación de inputs con Zod en cada server action.
- Ledger y audit_logs append-only: sin UPDATE/DELETE para usuarios normales (enforced en DB).
