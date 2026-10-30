import Link from "next/link";
import { requireSection } from "@/lib/auth";
import {
  ESQUEMAS,
  getAnteriores,
  getHechos,
  getNovedades,
  getPersonas,
  horasTexto,
  mensajeContadora,
  mesVecino,
  nombre,
  nombreMes,
  pesos,
  porcentaje,
  rangoMes,
  type Novedad,
  type Persona,
} from "@/lib/empleados";
import { guardarNovedades } from "@/lib/empleados-actions";
import { fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, input, label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CopiarMensaje } from "@/components/copiar-mensaje";
import { Pestanias } from "./pestanias";

export const dynamic = "force-dynamic";

const chk = "h-5 w-5 rounded border-line accent-rose-deep";

function Campo({ nombre: n, titulo, valor, ayuda, ancho = "" }: { nombre: string; titulo: string; valor?: string; ayuda?: string; ancho?: string }) {
  return (
    <div className={ancho}>
      <label className={label} htmlFor={n}>{titulo}</label>
      <input id={n} name={n} defaultValue={valor} inputMode="decimal" autoComplete="off" className={input} placeholder={ayuda} />
    </div>
  );
}

function Tilde({ nombre: n, titulo, marcado }: { nombre: string; titulo: string; marcado: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" name={n} value="si" defaultChecked={marcado} className={chk} />
      {titulo}
    </label>
  );
}

function FichaMes({
  p,
  n,
  anterior,
  hechos,
  mes,
}: {
  p: Persona;
  n?: Novedad;
  anterior?: Novedad;
  hechos: { texto: string; sugerencia?: string }[];
  mes: string;
}) {
  const k = (x: string) => `${p.id}:${x}`;
  const { desde, hasta } = rangoMes(mes);
  const mesNum = Number(mes.slice(5, 7));
  const min = n?.minutes_worked ?? 0;
  // mes sin cargar: se precarga con la ficha, el mes anterior y lo que ya está en la app
  const notas = n ? n.notes ?? "" : hechos.map((h) => h.sugerencia).filter(Boolean).join(" ");
  return (
    <Card>
      <input type="hidden" name="persona" value={p.id} />
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-ink">{nombre(p)}</h3>
          <div className="text-xs text-soft">{ESQUEMAS[p.pay_scheme].label}</div>
        </div>
        {n ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Cargado</span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Sin cargar</span>
        )}
      </div>

      {(p.start_date && p.start_date >= desde && p.start_date <= hasta) || (p.end_date && p.end_date >= desde && p.end_date <= hasta) ? (
        <div className="mb-3 rounded-lg bg-blush-100 px-3 py-2 text-sm text-ink">
          {p.start_date && p.start_date >= desde && p.start_date <= hasta && <div>Ingresa este mes (el {p.start_date.slice(8)}/{p.start_date.slice(5, 7)}): el mensaje avisa el alta.</div>}
          {p.end_date && p.end_date >= desde && p.end_date <= hasta && <div>Trabaja hasta el {p.end_date.slice(8)}/{p.end_date.slice(5, 7)}: el mensaje avisa la baja.</div>}
        </div>
      ) : null}

      {hechos.length > 0 && (
        <div className="mb-3 rounded-lg border border-line px-3 py-2 text-sm">
          <div className="mb-1 text-xs font-semibold text-soft">Cargado en la app este mes</div>
          <ul className="list-disc pl-5 text-ink">
            {hechos.map((h, i) => <li key={i}>{h.texto}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {p.pay_scheme === "FIJO_COMISION" && (
          <>
            <Campo nombre={k("monto")} titulo="Básico $" valor={pesos(n?.base_amount ?? p.base_amount)} />
            <Campo nombre={k("comisiones")} titulo="Comisiones $ (Xubio)" valor={pesos(n?.commissions ?? null)} />
          </>
        )}
        {p.pay_scheme === "EN_MANO" && <Campo nombre={k("monto")} titulo="En mano $" valor={pesos(n?.base_amount ?? p.base_amount)} />}
        {p.pay_scheme === "POR_HORA" && (
          <>
            <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-1">
              <Campo nombre={k("horas")} titulo="Horas" valor={min ? String(Math.floor(min / 60)) : ""} />
              <Campo nombre={k("minutos")} titulo="Min" valor={min % 60 ? String(min % 60) : ""} />
            </div>
            <Campo nombre={k("valor_hora")} titulo="Valor hora $" valor={pesos(n?.hourly_rate ?? p.hourly_rate)} />
            <Campo nombre={k("monto")} titulo="O monto fijo $" valor={pesos(n?.base_amount ?? null)} ayuda="si no es por hora" />
          </>
        )}
        {(p.pay_scheme === "CONVENIO" || p.pay_scheme === "FIJO_COMISION") && <Campo nombre={k("aumento")} titulo="Aumento al básico %" valor={n?.raise_pct != null ? porcentaje(n.raise_pct) : ""} />}
        <Campo nombre={k("bono")} titulo="Bono $" valor={pesos(n?.bonus ?? null)} />
      </div>

      {n?.total != null && p.pay_scheme !== "CONVENIO" && (
        <div className="mt-2 text-sm text-soft">
          Total a cobrar: <span className="font-semibold text-ink">${pesos(n.total)}</span>
          {n.minutes_worked ? ` (${horasTexto(n.minutes_worked)})` : ""}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {(p.pay_scheme === "EN_MANO" || p.pay_scheme === "POR_HORA") && (
          <Tilde nombre={k("informar")} titulo="Informar el monto" marcado={n?.report_amount ?? anterior?.report_amount ?? true} />
        )}
        <Tilde nombre={k("aguinaldo")} titulo="Más aguinaldo" marcado={n?.aguinaldo ?? (mesNum === 6 || mesNum === 12)} />
        {p.employer === "MARRUDI" && <Tilde nombre={k("presentismo")} titulo="Restar presentismo" marcado={n?.no_presentismo ?? false} />}
        <Tilde nombre={k("pendiente")} titulo={'"Mañana te paso bien"'} marcado={n?.pending ?? false} />
      </div>

      <div className="mt-3">
        <label className={label} htmlFor={k("notas")}>Otras novedades (va tal cual en el mensaje)</label>
        <textarea id={k("notas")} name={k("notas")} defaultValue={notas} rows={2} className={input} placeholder="Ej.: falta pasar las horas extra, cambió de horario…" />
      </div>
    </Card>
  );
}

export default async function Empleados({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; mes?: string }> }) {
  await requireSection("empleados");
  const sp = await searchParams;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : hoy.slice(0, 7);
  const [personas, novedades, anteriores, hechos] = await Promise.all([
    getPersonas(mes),
    getNovedades(`${mes}-01`, `${mes}-01`),
    getAnteriores(mes),
    getHechos(mes),
  ]);
  const porPersona = new Map(novedades.map((n) => [n.employee_id, n]));
  const sinCargar = personas.filter((p) => !porPersona.has(p.id)).length;
  const ultima = novedades.reduce<Novedad | null>((a, n) => (!a || n.updated_at > a.updated_at ? n : a), null);
  const grupos = [
    { titulo: "Marrudi SRL", lista: personas.filter((p) => p.employer === "MARRUDI") },
    { titulo: "Casas particulares (ECP)", lista: personas.filter((p) => p.employer === "ECP") },
  ].filter((g) => g.lista.length);

  return (
    <div>
      <PageTitle>Empleados</PageTitle>
      <Pestanias activa="/empleados" />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href={`/empleados?mes=${mesVecino(mes, -1)}`} className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-soft hover:text-ink">
          ← <span className="capitalize">{nombreMes(mesVecino(mes, -1)).split(" ")[0].slice(0, 3)}</span>
        </Link>
        <h2 className="text-center font-display text-3xl capitalize leading-none text-ink">{nombreMes(mes)}</h2>
        <Link href={`/empleados?mes=${mesVecino(mes, 1)}`} className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-soft hover:text-ink">
          <span className="capitalize">{nombreMes(mesVecino(mes, 1)).split(" ")[0].slice(0, 3)}</span> →
        </Link>
      </div>

      <p className="mb-4 text-sm text-soft">
        Cargá lo que te pasa Yura de cada persona y tocá <b>Guardar</b>: abajo aparece el mensaje para la contadora, listo para copiar y mandar por WhatsApp.
        Si alguien no tiene nada, dejalo vacío y sale como &quot;Sin novedades&quot;. Se puede corregir y volver a guardar las veces que haga falta.
      </p>

      <form action={guardarNovedades}>
        <input type="hidden" name="mes" value={mes} />
        {grupos.map((g) => (
          <section key={g.titulo} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-soft">{g.titulo}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {g.lista.map((p) => (
                <FichaMes key={p.id} p={p} n={porPersona.get(p.id)} anterior={anteriores.get(p.id)} hechos={hechos.get(p.id) ?? []} mes={mes} />
              ))}
            </div>
          </section>
        ))}
        {personas.length === 0 ? (
          <Card>No hay empleados para este mes. Agregalos en <Link className="text-rose-deep underline" href="/empleados/personal">Personal</Link>.</Card>
        ) : (
          <div className="sticky bottom-3 z-10 flex justify-end">
            <SubmitButton className="rounded-lg bg-rose-deep px-6 py-3 text-base font-semibold text-white shadow-lg hover:bg-rose-deeper">
              Guardar novedades
            </SubmitButton>
          </div>
        )}
      </form>

      <Card className="mt-6">
        <h2 className="mb-1 text-lg font-semibold text-ink">Mensaje para la contadora</h2>
        {novedades.length === 0 ? (
          <p className="text-sm text-soft">Todavía no se cargó nada de {nombreMes(mes)}. Guardá las novedades y el mensaje aparece acá.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-soft">
              Última modificación: {ultima ? `${fmtDateTime(ultima.updated_at)} (${ultima.updated_by ?? "—"})` : "—"}.
              {sinCargar > 0 && <span className="text-amber-800"> Falta cargar {sinCargar} persona(s): salen como &quot;Sin novedades&quot;.</span>}
            </p>
            <CopiarMensaje texto={mensajeContadora(personas, porPersona, mes)} />
          </>
        )}
      </Card>
    </div>
  );
}
