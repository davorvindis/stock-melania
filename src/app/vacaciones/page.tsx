import Link from "next/link";
import { requireSection } from "@/lib/auth";
import {
  ESTADOS_VACACIONES,
  estadoVacClass,
  getDiasCorresponden,
  getEmpleados,
  getSolicitudes,
  seSuperponen,
  type SolicitudVacaciones,
} from "@/lib/personal";
import { decidirVacaciones, guardarDiasVacaciones, retirarSolicitud, solicitarVacaciones } from "@/lib/personal-actions";
import { fmtDate } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const rango = (s: SolicitudVacaciones) => `${fmtDate(s.start_date)} al ${fmtDate(s.end_date)}`;

// posición de una fecha dentro del año (0 a 1), recortada al año
function pos(fecha: string, anio: number) {
  const ini = Date.UTC(anio, 0, 1);
  const fin = Date.UTC(anio + 1, 0, 1);
  const t = Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10));
  return Math.min(Math.max((t - ini) / (fin - ini), 0), 1);
}

export default async function Vacaciones({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; anio?: string }>;
}) {
  const user = await requireSection("vacaciones");
  const esAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const anioHoy = +hoy.slice(0, 4);
  const anio = sp.anio && /^\d{4}$/.test(sp.anio) ? +sp.anio : anioHoy;

  const [empleados, solicitudes, todas, dias] = await Promise.all([
    getEmpleados(),
    getSolicitudes(anio),
    getSolicitudes(),
    getDiasCorresponden(anio),
  ]);
  const anios = [...new Set([anioHoy, anioHoy + 1, anio, ...todas.map((s) => s.year)])].sort();
  const vigentes = solicitudes.filter((s) => s.status === "APROBADA" || s.status === "PENDIENTE");
  const pendientes = todas.filter((s) => s.status === "PENDIENTE");
  // choques: otra persona de vacaciones (aprobada o pendiente) en fechas que se pisan
  const choques = (s: SolicitudVacaciones) =>
    todas.filter(
      (o) => o.id !== s.id && o.employee.id !== s.employee.id && (o.status === "APROBADA" || o.status === "PENDIENTE") && seSuperponen(s, o)
    );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Vacaciones</PageTitle>
        <div className="inline-flex rounded-lg border border-line bg-white p-1 text-sm">
          {anios.map((a) => (
            <Link
              key={a}
              href={`/vacaciones?anio=${a}`}
              className={`rounded-md px-3 py-1.5 font-medium ${a === anio ? "bg-rose-deep text-white" : "text-soft hover:text-ink"}`}
            >
              {a}
            </Link>
          ))}
        </div>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      {/* pendientes de aprobación */}
      {pendientes.length > 0 && (
        <Card className="mb-4 border-amber-200">
          <h2 className="mb-1 font-semibold text-amber-800">
            {pendientes.length} solicitud(es) pendiente(s) de aprobación
          </h2>
          {!esAdmin && <p className="mb-2 text-sm text-soft">Las aprueba Joel.</p>}
          <div className="space-y-3">
            {pendientes.map((s) => {
              const c = choques(s);
              return (
                <div key={s.id} className="rounded-lg border border-blush-100 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <b>{s.employee.name}</b> · {rango(s)} · <b>{s.days} días</b>
                      <span className="text-sm text-soft"> (vacaciones {s.year})</span>
                    </span>
                    <span className="text-xs text-soft">cargó {s.requested_by ?? "—"}</span>
                  </div>
                  {s.notes && <p className="text-sm text-soft">{s.notes}</p>}
                  {c.length > 0 && (
                    <p className="mt-1 text-sm font-medium text-amber-700">
                      ⚠ Se superpone con {c.map((o) => `${o.employee.name} (${rango(o)})`).join(", ")}
                    </p>
                  )}
                  {esAdmin ? (
                    <form action={decidirVacaciones} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="solicitud" value={s.id} />
                      <input type="hidden" name="anio" value={anio} />
                      <div>
                        <label className="mb-1 block text-xs text-soft">Desde</label>
                        <input type="date" name="desde" defaultValue={s.start_date} className="rounded-lg border border-line px-2 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-soft">Hasta</label>
                        <input type="date" name="hasta" defaultValue={s.end_date} className="rounded-lg border border-line px-2 py-1.5 text-sm" />
                      </div>
                      <div className="min-w-48 flex-1">
                        <label className="mb-1 block text-xs text-soft">Nota (obligatoria si rechazás)</label>
                        <input type="text" name="nota" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                      </div>
                      <SubmitButton name="decision" value="aprobar" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
                        Aprobar
                      </SubmitButton>
                      <SubmitButton name="decision" value="rechazar" className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
                        Rechazar
                      </SubmitButton>
                    </form>
                  ) : (
                    <form action={retirarSolicitud} className="mt-1">
                      <input type="hidden" name="solicitud" value={s.id} />
                      <input type="hidden" name="anio" value={anio} />
                      <SubmitButton className="text-xs text-soft hover:text-red-700">Retirar solicitud</SubmitButton>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          {esAdmin && <p className="mt-2 text-xs text-soft">Si cambiás las fechas antes de aprobar, se aprueban con las fechas nuevas.</p>}
        </Card>
      )}

      {/* calendario */}
      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">Calendario {anio}</h2>
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="ml-24 flex text-[11px] text-soft">
              {MESES.map((m) => (
                <div key={m} className="flex-1 border-l border-line pl-1">
                  {m}
                </div>
              ))}
            </div>
            {empleados.map((e) => (
              <div key={e.id} className="flex items-center border-t border-blush-100 py-1.5">
                <div className="w-24 shrink-0 truncate pr-2 text-sm font-medium">{e.name}</div>
                <div className="relative h-6 flex-1 rounded bg-blush-50">
                  {MESES.map((m, i) => (
                    <div key={m} className="absolute top-0 h-full border-l border-white" style={{ left: `${(i / 12) * 100}%` }} />
                  ))}
                  {vigentes
                    .filter((s) => s.employee.id === e.id)
                    .map((s) => {
                      const a = pos(s.start_date, anio);
                      const b = pos(s.end_date, anio) + 1 / 365;
                      return (
                        <div
                          key={s.id}
                          title={`${e.name}: ${rango(s)} (${s.days} días) · ${ESTADOS_VACACIONES[s.status]}`}
                          className={`absolute top-0.5 h-5 rounded ${s.status === "APROBADA" ? "bg-emerald-600" : "bg-amber-400"}`}
                          style={{ left: `${a * 100}%`, width: `${Math.max((Math.min(b, 1) - a) * 100, 0.6)}%` }}
                        />
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-soft">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded bg-emerald-600" /> Aprobadas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded bg-amber-400" /> Pendientes
          </span>
        </div>
      </Card>

      {/* por persona */}
      <Card className="mb-4">
        <h2 className="mb-1 font-semibold">Días por persona — vacaciones {anio}</h2>
        <p className="mb-3 text-sm text-soft">
          Días corridos. Para agregar o dar de baja empleados: <Link href="/faltas" className="text-rose-deep hover:underline">Faltas y horas → Empleados</Link>.{" "}
          {esAdmin ? "Cargá cuántos días le corresponden a cada uno (según antigüedad) y guardá." : "Los días que corresponden los define Joel."}
        </p>
        <form action={guardarDiasVacaciones}>
          <input type="hidden" name="anio" value={anio} />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Persona</th>
                  <th className={th}>Le corresponden</th>
                  <th className={th}>Aprobados</th>
                  <th className={th}>Pendientes</th>
                  <th className={th}>Le quedan</th>
                </tr>
              </thead>
              <tbody>
                {empleados.map((e) => {
                  const corresponde = dias.get(e.id)?.days;
                  const delEmp = solicitudes.filter((s) => s.employee.id === e.id);
                  const aprob = delEmp.filter((s) => s.status === "APROBADA").reduce((n, s) => n + s.days, 0);
                  const pend = delEmp.filter((s) => s.status === "PENDIENTE").reduce((n, s) => n + s.days, 0);
                  const quedan = corresponde != null ? corresponde - aprob : null;
                  return (
                    <tr key={e.id} className="border-b border-blush-100">
                      <td className={`${td} font-medium`}>{e.name}</td>
                      <td className={td}>
                        {esAdmin ? (
                          <input
                            type="number"
                            name={`dias_${e.id}`}
                            min="0"
                            max="60"
                            defaultValue={corresponde ?? ""}
                            placeholder="sin definir"
                            className="w-28 rounded-lg border border-line px-2 py-1.5 text-sm"
                          />
                        ) : corresponde != null ? (
                          `${corresponde} días`
                        ) : (
                          <span className="text-soft">sin definir</span>
                        )}
                      </td>
                      <td className={td}>{aprob || "—"}</td>
                      <td className={td}>{pend ? <span className="text-amber-700">{pend}</span> : "—"}</td>
                      <td className={`${td} font-semibold ${quedan != null && quedan < 0 ? "text-red-700" : ""}`}>
                        {quedan != null ? quedan : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {esAdmin && (
            <SubmitButton className="mt-3 rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
              Guardar días
            </SubmitButton>
          )}
        </form>
      </Card>

      {/* nueva solicitud */}
      <Card className="mb-4">
        <details open={!!sp.error}>
          <summary className="cursor-pointer font-semibold text-rose-deep">+ Cargar vacaciones</summary>
          <p className="mt-2 text-sm text-soft">
            {esAdmin ? "Si las cargás vos quedan aprobadas directamente." : "Quedan pendientes hasta que Joel las apruebe."}
          </p>
          <form action={solicitarVacaciones} className="mt-3 grid gap-3 sm:grid-cols-4">
            <div>
              <label className={label}>Persona *</label>
              <select name="empleado" required className={input}>
                <option value="">Elegir…</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Desde *</label>
              <input type="date" name="desde" required className={input} />
            </div>
            <div>
              <label className={label}>Hasta (último día) *</label>
              <input type="date" name="hasta" required className={input} />
            </div>
            <div>
              <label className={label}>Vacaciones del año</label>
              <select name="anio" defaultValue={anio} className={input}>
                {[anio - 1, anio, anio + 1].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-4">
              <label className={label}>Observaciones</label>
              <input type="text" name="notas" placeholder="ej. segunda semana, la pidió por viaje" className={input} />
            </div>
            <div className="sm:col-span-4">
              <SubmitButton className="rounded-lg bg-rose-deep px-5 py-2.5 font-semibold text-white hover:bg-rose-deeper">
                {esAdmin ? "Cargar y aprobar" : "Enviar para aprobar"}
              </SubmitButton>
            </div>
          </form>
        </details>
      </Card>

      {/* todas las del año */}
      <h2 className="mb-2 font-display text-2xl tracking-wide">Vacaciones {anio}</h2>
      <div className="space-y-2">
        {solicitudes.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3">
            <div>
              <b>{s.employee.name}</b> · {rango(s)} · {s.days} días
              {s.notes && <span className="text-sm text-soft"> · {s.notes}</span>}
              <div className="text-xs text-soft">
                cargó {s.requested_by ?? "—"}
                {s.decided_by ? ` · ${s.status === "RECHAZADA" ? "rechazó" : "aprobó"} ${s.decided_by}` : ""}
                {s.decision_note ? ` · “${s.decision_note}”` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estadoVacClass(s.status)}`}>
                {ESTADOS_VACACIONES[s.status]}
              </span>
              {esAdmin && s.status === "APROBADA" && (
                <form action={decidirVacaciones}>
                  <input type="hidden" name="solicitud" value={s.id} />
                  <input type="hidden" name="anio" value={anio} />
                  <SubmitButton name="decision" value="cancelar" className="text-xs text-soft hover:text-red-700">
                    Cancelar
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        ))}
        {solicitudes.length === 0 && (
          <Card>
            <p className="text-sm text-soft">Todavía no hay vacaciones cargadas para {anio}.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
