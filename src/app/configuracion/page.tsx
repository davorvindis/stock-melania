import { requireSection, SECTIONS, can, type Profile } from "@/lib/auth";
import { crearUsuario, blanquearPin, actualizarUsuario } from "@/lib/auth-actions";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

const ROLES = [
  ["ADMIN", "Admin — todo, incl. usuarios y aprobaciones"],
  ["MANAGER", "Manager — opera y aprueba, sin configuración"],
  ["OPERATOR", "Operadora — opera, sin auditoría ni configuración"],
] as const;

export default async function Configuracion({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const admin = await requireSection("configuracion");
  const { ok, error } = await searchParams;
  const { data } = await db().from("profiles").select("*").order("created_at");
  const usuarios = (data ?? []) as (Profile & { created_at: string })[];

  return (
    <div className="max-w-3xl">
      <PageTitle>Configuración — Usuarios</PageTitle>
      <Flash ok={ok} error={error} />

      <Card className="mb-6">
        <h2 className="mb-1 font-semibold">Dar de alta un usuario</h2>
        <p className="mb-3 text-sm text-soft">
          Se genera un PIN temporal de 6 dígitos que se muestra una sola vez. La persona entra con
          su email, alias o DNI y elige su PIN definitivo en el primer ingreso.
        </p>
        <form action={crearUsuario} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Email *</label>
            <input type="email" name="email" required className={input} />
          </div>
          <div>
            <label className={label}>Alias *</label>
            <input type="text" name="alias" required placeholder="ej. caro" className={input} />
          </div>
          <div>
            <label className={label}>DNI</label>
            <input type="text" name="dni" inputMode="numeric" className={input} />
          </div>
          <div>
            <label className={label}>Rol *</label>
            <select name="rol" required defaultValue="OPERATOR" className={input}>
              {ROLES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={button}>
              Crear usuario y generar PIN
            </button>
          </div>
        </form>
      </Card>

      <h2 className="mb-2 font-display text-2xl tracking-wide">Usuarios</h2>
      <div className="space-y-3">
        {usuarios.map((u) => (
          <Card key={u.id} className={u.active ? "" : "opacity-60"}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold">{u.alias}</span>
                <span className="ml-2 text-sm text-soft">{u.email}</span>
                {u.id === admin.id && (
                  <span className="ml-2 rounded-full bg-blush-100 px-2 py-0.5 text-xs text-rose-deeper">
                    vos
                  </span>
                )}
              </div>
              <div className="text-xs text-soft">
                {u.dni ? `DNI ${u.dni} · ` : ""}alta {fmtDate(u.created_at)}
                {u.must_change_pin ? " · PIN temporal pendiente" : ""}
              </div>
            </div>

            <form action={actualizarUsuario} className="mt-3 space-y-3">
              <input type="hidden" name="usuario" value={u.id} />
              <div className="flex flex-wrap items-center gap-4">
                <select name="rol" defaultValue={u.role} className={`${input} w-auto`}>
                  {ROLES.map(([v]) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="activo" defaultChecked={u.active} className="h-4 w-4 accent-rose-deep" />
                  Activo
                </label>
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-ink">Acceso por sección</legend>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {SECTIONS.map((s) => (
                    <label key={s.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={`perm_${s.key}`}
                        defaultChecked={can(u, s.key)}
                        disabled={s.key === "configuracion" && u.role !== "ADMIN"}
                        className="h-4 w-4 accent-rose-deep"
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
                >
                  Guardar cambios
                </button>
                <button
                  type="submit"
                  formAction={blanquearPin}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
                >
                  Blanquear PIN
                </button>
              </div>
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
