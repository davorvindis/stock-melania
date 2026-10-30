import { requireSection } from "@/lib/auth";
import { EMPLEADORES, ESQUEMAS, getPersonas, nombre, pesos, type Persona } from "@/lib/empleados";
import { guardarPersona } from "@/lib/empleados-actions";
import { fmtDate } from "@/lib/types";
import { Card, Flash, PageTitle, input, label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { Pestanias } from "../pestanias";

export const dynamic = "force-dynamic";

const boton = "rounded-lg bg-rose-deep px-6 py-3 text-base font-semibold text-white hover:bg-rose-deeper";

function FormPersona({ p }: { p?: Persona }) {
  return (
    <form action={guardarPersona} className="grid gap-3 md:grid-cols-2">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div>
        <label className={label}>Nombre y apellido (como va en el mensaje)</label>
        <input name="nombre_completo" required defaultValue={p?.full_name ?? ""} className={input} />
      </div>
      <div>
        <label className={label}>Nombre corto (Faltas y Vacaciones)</label>
        <input name="nombre" defaultValue={p?.name ?? ""} className={input} placeholder="Si lo dejás vacío, el primer nombre" />
      </div>
      <div>
        <label className={label}>Empleador</label>
        <select name="empleador" defaultValue={p?.employer ?? "MARRUDI"} className={input}>
          {Object.entries(EMPLEADORES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Cómo cobra</label>
        <select name="esquema" defaultValue={p?.pay_scheme ?? "CONVENIO"} className={input}>
          {Object.entries(ESQUEMAS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Básico / en mano $ (vigente)</label>
        <input name="monto" inputMode="decimal" defaultValue={pesos(p?.base_amount ?? null)} className={input} placeholder="Vacío si lo calcula la contadora" />
      </div>
      <div>
        <label className={label}>Valor hora $</label>
        <input name="valor_hora" inputMode="decimal" defaultValue={pesos(p?.hourly_rate ?? null)} className={input} placeholder="Solo si cobra por hora" />
      </div>
      <div>
        <label className={label}>Fecha de ingreso</label>
        <input type="date" name="ingreso" defaultValue={p?.start_date ?? ""} className={input} />
      </div>
      <div>
        <label className={label}>Último día de trabajo (baja)</label>
        <input type="date" name="egreso" defaultValue={p?.end_date ?? ""} className={input} />
      </div>
      <div className="md:col-span-2">
        <label className={label}>Notas</label>
        <textarea name="notas" rows={2} defaultValue={p?.notes ?? ""} className={input} placeholder="Acuerdos, horario, lo que convenga recordar" />
      </div>
      <div>
        <label className={label}>Orden en el mensaje</label>
        <input name="orden" type="number" min={0} max={999} defaultValue={p?.sort_order ?? 100} className={input} />
      </div>
      <div className="flex items-end">
        <SubmitButton className={boton}>{p ? "Guardar cambios" : "Agregar persona"}</SubmitButton>
      </div>
    </form>
  );
}

export default async function Personal({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireSection("empleados");
  const sp = await searchParams;
  const personas = await getPersonas();
  const activos = personas.filter((p) => p.active);
  const bajas = personas.filter((p) => !p.active);

  const Tarjeta = ({ p }: { p: Persona }) => (
    <Card>
      <details>
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-ink">{nombre(p)}</h3>
            <span className="text-sm text-rose-deep">Editar</span>
          </div>
          <div className="mt-1 text-sm text-soft">
            {EMPLEADORES[p.employer]} · {ESQUEMAS[p.pay_scheme].label}
            {p.base_amount !== null && ` · $${pesos(p.base_amount)}`}
            {p.hourly_rate !== null && ` · $${pesos(p.hourly_rate)}/hora`}
          </div>
          <div className="text-xs text-soft">
            {p.start_date && `Ingresó ${fmtDate(p.start_date)}`}
            {p.start_date && p.end_date && " · "}
            {p.end_date && `Último día ${fmtDate(p.end_date)}`}
          </div>
        </summary>
        <div className="mt-4 border-t border-line pt-4">
          <FormPersona p={p} />
        </div>
      </details>
    </Card>
  );

  return (
    <div>
      <PageTitle>Empleados</PageTitle>
      <Pestanias activa="/empleados/personal" />
      <Flash ok={sp.ok} error={sp.error} />
      <p className="mb-4 text-sm text-soft">
        La ficha de cada persona: quién la emplea, cómo cobra y el monto vigente (con eso se precarga cada mes).
        Para una baja, poné el último día de trabajo: ese mes el mensaje avisa la baja y después deja de aparecer.
      </p>

      <Card className="mb-4">
        <details>
          <summary className="cursor-pointer font-semibold text-rose-deep">+ Agregar persona</summary>
          <div className="mt-4"><FormPersona /></div>
        </details>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {activos.map((p) => <Tarjeta key={p.id} p={p} />)}
      </div>

      {bajas.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-soft">Dados de baja</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {bajas.map((p) => <Tarjeta key={p.id} p={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
