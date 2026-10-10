import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { CERTIFICADO, TIPOS_REGISTRO, fmtHoras, getEmpleados, getRegistros } from "@/lib/personal";
import { adjuntarCertificado, bajaEmpleado, crearEmpleado, eliminarRegistro, eliminarRegistros, reactivarEmpleado, registrarFalta } from "@/lib/personal-actions";
import { SeleccionMasiva } from "@/components/seleccion-masiva";
import { nombreMes } from "@/lib/compras";
import { fmtDate } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; empleado?: string; mes?: string };

const claseSaldo = (m: number) => (m > 0 ? "text-emerald-700" : m < 0 ? "text-red-700" : "text-soft");

export default async function Faltas({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSection("faltas");
  const sp = await searchParams;
  const [todosEmpleados, registros] = await Promise.all([getEmpleados(false), getRegistros()]);
  const empleados = todosEmpleados.filter((e) => e.active);
  const inactivos = todosEmpleados.filter((e) => !e.active);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const mesActual = hoy.slice(0, 7);

  // saldo acumulado y del mes por empleado
  const saldo = new Map<string, { total: number; mes: number }>();
  for (const r of registros) {
    const s = saldo.get(r.employee.id) ?? { total: 0, mes: 0 };
    s.total += r.minutes;
    if (r.record_date.startsWith(mesActual)) s.mes += r.minutes;
    saldo.set(r.employee.id, s);
  }

  // resumen mes a mes (solo meses con movimientos de horas)
  const meses = [...new Set(registros.filter((r) => r.minutes !== 0).map((r) => r.record_date.slice(0, 7)))].sort();
  const netoMes = (empId: string, mes: string) =>
    registros.filter((r) => r.employee.id === empId && r.record_date.startsWith(mes)).reduce((s, r) => s + r.minutes, 0);
  const acumuladoHasta = (empId: string, mes: string) =>
    registros.filter((r) => r.employee.id === empId && r.record_date.slice(0, 7) <= mes).reduce((s, r) => s + r.minutes, 0);

  let lista = registros;
  if (sp.empleado) lista = lista.filter((r) => r.employee.id === sp.empleado);
  if (sp.mes && /^\d{4}-\d{2}$/.test(sp.mes)) lista = lista.filter((r) => r.record_date.startsWith(sp.mes!));
  const mesesLista = [...new Set(registros.map((r) => r.record_date.slice(0, 7)))].sort().reverse();
  // para volver a esta misma vista filtrada después de cada acción
  const filtros = new URLSearchParams();
  if (sp.empleado) filtros.set("empleado", sp.empleado);
  if (sp.mes) filtros.set("mes", sp.mes);
  const volver = filtros.toString() ? `/faltas?${filtros.toString()}` : "/faltas";

  return (
    <div>
      <PageTitle>Faltas y horas</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />

      {/* saldos */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {empleados.map((e) => {
          const s = saldo.get(e.id) ?? { total: 0, mes: 0 };
          return (
            <Link key={e.id} href={`/faltas?empleado=${e.id}`} className="block rounded-xl border border-line bg-white p-4 hover:border-blush">
              <div className="text-sm font-semibold">{e.name}</div>
              <div className={`mt-1 font-display text-3xl leading-none ${claseSaldo(s.total)}`}>{fmtHoras(s.total)}</div>
              <div className="mt-1 text-xs text-soft">
                {s.total > 0 ? "a favor" : s.total < 0 ? "debe" : "al día"} · este mes {fmtHoras(s.mes)}
              </div>
            </Link>
          );
        })}
      </div>

      <Card className="mb-4">
        <details open={!!sp.error}>
          <summary className="cursor-pointer font-semibold text-rose-deep">+ Registrar falta, llegada tarde, horas a favor o recupero</summary>
          <form action={registrarFalta} className="mt-3 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="volver" value={volver} />
            <div>
              <label className={label}>Empleado *</label>
              <select name="empleado" required defaultValue={sp.empleado ?? ""} className={input}>
                <option value="">Elegir…</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Fecha *</label>
              <input type="date" name="fecha" required defaultValue={hoy} className={input} />
            </div>
            <div>
              <label className={label}>Tipo *</label>
              <select name="tipo" required className={input}>
                {Object.entries(TIPOS_REGISTRO).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Motivo</label>
              <input type="text" name="motivo" placeholder="ej. psicólogo, turno médico, partido" className={input} />
            </div>
            <div>
              <label className={label}>Horario</label>
              <input type="text" name="horario" placeholder="ej. ingresa 11 am, se retira 17:45" className={input} />
            </div>
            <div>
              <label className={label}>Certificado</label>
              <select name="certificado" defaultValue="" className={input}>
                <option value="">—</option>
                {Object.entries(CERTIFICADO).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="sm:col-span-2">
              <legend className={label}>¿Cómo afecta las horas? *</legend>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="efecto" value="DEBE" defaultChecked className="h-4 w-4 accent-rose-deep" /> Debe
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="efecto" value="A_FAVOR" className="h-4 w-4 accent-rose-deep" /> A favor / recuperó
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="efecto" value="NINGUNO" className="h-4 w-4 accent-rose-deep" /> No afecta (falta justificada)
                </label>
                <span className="flex items-center gap-1.5">
                  <input type="number" name="horas" min="0" max="999" defaultValue="0" aria-label="Horas" className="w-20 rounded-lg border border-line px-2 py-2 text-sm" />
                  <span className="text-sm text-soft">h</span>
                  <input type="number" name="minutos" min="0" max="59" defaultValue="0" aria-label="Minutos" className="w-20 rounded-lg border border-line px-2 py-2 text-sm" />
                  <span className="text-sm text-soft">min</span>
                </span>
              </div>
            </fieldset>
            <div>
              <label className={label}>Adjuntar certificado (PDF o foto, hasta 4 MB)</label>
              <input type="file" name="archivo" accept="application/pdf,image/*" className="block w-full text-sm" />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>Observaciones</label>
              <input type="text" name="notas" className={input} />
            </div>
            <div className="sm:col-span-3">
              <SubmitButton className="rounded-lg bg-rose-deep px-5 py-2.5 font-semibold text-white hover:bg-rose-deeper">Guardar</SubmitButton>
              <p className="mt-2 text-xs text-soft">
                Para arrancar, cargá a cada uno su <b>Saldo inicial</b> (tipo “Saldo inicial”) con lo que debe o tiene a favor hoy.
                Cuando recupera horas usá “Recuperó horas” → A favor: se descuenta de lo que debe.
              </p>
            </div>
          </form>
        </details>
      </Card>

      {meses.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-2 font-semibold">Mes a mes</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Mes</th>
                  {empleados.map((e) => (
                    <th key={e.id} className={th}>
                      {e.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meses.map((m) => (
                  <tr key={m} className="border-b border-blush-100">
                    <td className={`${td} capitalize`}>{nombreMes(`${m}-01`)}</td>
                    {empleados.map((e) => {
                      const n = netoMes(e.id, m);
                      const acum = acumuladoHasta(e.id, m);
                      return (
                        <td key={e.id} className={td}>
                          <span className={claseSaldo(n)}>{n ? fmtHoras(n) : "—"}</span>
                          <span className="block text-xs text-soft">acum. {fmtHoras(acum)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <form method="get" className="mb-3 flex flex-wrap gap-2">
        <select name="empleado" defaultValue={sp.empleado ?? ""} aria-label="Empleado" className={`${input} w-auto`}>
          <option value="">Todos</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select name="mes" defaultValue={sp.mes ?? ""} aria-label="Mes" className={`${input} w-auto`}>
          <option value="">Todos los meses</option>
          {mesesLista.map((m) => (
            <option key={m} value={m} className="capitalize">
              {nombreMes(`${m}-01`)}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
          Filtrar
        </button>
        {(sp.empleado || sp.mes) && (
          <Link href="/faltas" className="self-center text-sm font-medium text-rose-deep hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <SeleccionMasiva formId="borrar-varios" action={eliminarRegistros} volver={volver} total={lista.length} />
      <div className="space-y-2">
        {lista.map((r) => (
          <div key={r.id} className="rounded-xl border border-line bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="registros"
                  value={r.id}
                  form="borrar-varios"
                  aria-label={`Seleccionar registro de ${r.employee.name} del ${fmtDate(r.record_date)}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-rose-deep"
                />
                <div>
                <span className="font-semibold">{r.employee.name}</span>
                <span className="text-sm text-soft"> · {fmtDate(r.record_date)} · {TIPOS_REGISTRO[r.kind] ?? r.kind}</span>
                {r.imported && <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">del Excel</span>}
                </div>
              </div>
              <span className={`font-semibold ${claseSaldo(r.minutes)}`}>{r.minutes ? fmtHoras(r.minutes) : ""}</span>
            </div>
            <div className="mt-1 text-sm">
              {[r.reason, r.schedule].filter(Boolean).join(" · ")}
              {r.notes && <div className="whitespace-pre-line text-soft">{r.notes}</div>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              {r.certificate && <span className="text-soft">{CERTIFICADO[r.certificate]}</span>}
              {r.certificate_path ? (
                <a href={`/api/certificados/${r.id}`} target="_blank" className="font-medium text-rose-deep hover:underline">
                  📎 Ver certificado
                </a>
              ) : (
                <details>
                  <summary className="cursor-pointer font-medium text-rose-deep">📎 Adjuntar certificado</summary>
                  <form action={adjuntarCertificado} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="registro" value={r.id} />
                    <input type="hidden" name="volver" value={volver} />
                    <input type="file" name="archivo" required accept="application/pdf,image/*" className="text-xs" />
                    <SubmitButton className="rounded-lg bg-rose-deep px-3 py-1.5 text-xs font-semibold text-white">Subir</SubmitButton>
                  </form>
                </details>
              )}
              {r.created_by && <span className="text-soft">cargó {r.created_by}</span>}
              <form action={eliminarRegistro} className="ml-auto">
                <input type="hidden" name="registro" value={r.id} />
                <input type="hidden" name="volver" value={volver} />
                <SubmitButton className="text-soft hover:text-red-700">Eliminar</SubmitButton>
              </form>
            </div>
          </div>
        ))}
        {lista.length === 0 && (
          <Card>
            <p className="text-sm text-soft">No hay registros{sp.empleado || sp.mes ? " con estos filtros" : " todavía"}.</p>
          </Card>
        )}
      </div>

      <Card className="mt-6">
        <details>
          <summary className="cursor-pointer font-semibold text-rose-deep">Empleados ({empleados.length})</summary>
          <p className="mb-3 mt-2 text-sm text-soft">
            Son los mismos para Faltas y para Vacaciones. Si alguien se va, dalo de baja: deja de aparecer pero su
            historial queda guardado.
          </p>
          <ul className="mb-3 divide-y divide-blush-100">
            {empleados.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span>{e.name}</span>
                <form action={bajaEmpleado}>
                  <input type="hidden" name="empleado" value={e.id} />
                  <SubmitButton className="text-xs text-soft hover:text-red-700">Dar de baja</SubmitButton>
                </form>
              </li>
            ))}
            {inactivos.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-sm text-soft">
                <span>{e.name} (de baja)</span>
                <form action={reactivarEmpleado}>
                  <input type="hidden" name="empleado" value={e.id} />
                  <SubmitButton className="text-xs font-medium text-rose-deep hover:underline">Reactivar</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
          <form action={crearEmpleado} className="flex flex-wrap gap-2">
            <input type="text" name="nombre" required placeholder="Nombre del nuevo empleado" className={`${input} w-auto flex-1`} />
            <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
              + Agregar
            </SubmitButton>
          </form>
        </details>
      </Card>
    </div>
  );
}
