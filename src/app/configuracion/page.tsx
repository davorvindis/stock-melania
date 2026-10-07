import { SubmitButton } from "@/components/submit-button";
import { requireSection, SECTIONS, can, type Profile } from "@/lib/auth";
import { crearUsuario, blanquearPin, actualizarUsuario } from "@/lib/auth-actions";
import { db } from "@/lib/db";
import { getLocations } from "@/lib/queries";
import { listarBackups } from "@/lib/backup";
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
  const [{ data }, ubicaciones, backups] = await Promise.all([
    db().from("profiles").select("*").order("created_at"),
    getLocations(),
    listarBackups(),
  ]);
  const usuarios = (data ?? []) as (Profile & { created_at: string })[];
  const nombreUbic = new Map(ubicaciones.map((u) => [u.id, u.name]));

  const camposUbicacion = (u?: Profile) => (
    <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
      <div>
        <label className={label}>Ubicación de trabajo</label>
        <select name="ubicacion" defaultValue={u?.location_id ?? ""} className={input}>
          <option value="">Sin ubicación asignada</option>
          {ubicaciones.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 pb-3 text-sm">
        <input
          type="checkbox"
          name="ubicacion_fija"
          defaultChecked={!!u?.location_locked}
          className="h-4 w-4 accent-rose-deep"
        />
        Solo puede operar desde esta ubicación
      </label>
    </div>
  );

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
            {camposUbicacion()}
            <p className="mt-1 text-xs text-soft">
              La ubicación se precarga en sus movimientos e ingresos. Restringida: solo ve y mueve
              stock de esa ubicación (ej. Store → Venta). Solo un administrador puede cambiarla.
            </p>
          </div>
          <div className="sm:col-span-2">
            <SubmitButton className={button}>
              Crear usuario y generar PIN
            </SubmitButton>
          </div>
        </form>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 font-semibold">Copias de seguridad</h2>
        <p className="mb-3 text-sm text-soft">
          Todos los días a la madrugada se guarda sola una copia completa de los datos (se conservan
          30 días). Para estar cubiertos aunque falle Supabase, descargá una copia de vez en cuando
          (por ejemplo, una vez por semana) y guardala en tu compu o en Drive.
        </p>
        <a
          href="/api/backup/descargar"
          className="inline-block rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
        >
          Descargar copia ahora
        </a>
        {backups.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-rose-deep">
              Copias automáticas guardadas ({backups.length}) · última:{" "}
              {backups[0].name.replace("backup-", "").replace(".json.gz", "")}
            </summary>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
              {backups.map((b) => (
                <li key={b.name}>
                  <a
                    href={`/api/backup/descargar?archivo=${encodeURIComponent(b.name)}`}
                    className="text-rose-deep hover:underline"
                  >
                    {b.name.replace("backup-", "").replace(".json.gz", "")}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="mt-3 text-sm text-soft">Todavía no hay copias automáticas guardadas.</p>
        )}
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
                {u.location_id ? `📍 ${nombreUbic.get(u.location_id) ?? "?"}${u.location_locked ? " (fija)" : ""} · ` : ""}
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
              {camposUbicacion(u)}
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
                <SubmitButton
                  className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
                >
                  Guardar cambios
                </SubmitButton>
                <SubmitButton
                  formAction={blanquearPin}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
                >
                  Blanquear PIN
                </SubmitButton>
              </div>
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
