import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { cierresSinVer, getCierres, totalesDe } from "@/lib/caja";
import { CONTADORES, dolares, pesos } from "@/lib/caja-calc";
import { hoyAR } from "@/lib/backup";
import { Card, Flash, PageTitle, th, td } from "@/components/ui";
import { RangoFechas } from "@/components/rango-fechas";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; desde?: string; hasta?: string; mes?: string };
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const dmy = (f: string) => f.split("-").reverse().join("/");
const esFecha = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function CajaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireSection("caja");
  const sp = await searchParams;
  const hoy = hoyAR();
  // por defecto: el mes en curso. "mes" (AAAA-MM o AAAA) gana sobre desde/hasta
  let desde = esFecha(sp.desde) ? sp.desde! : `${hoy.slice(0, 7)}-01`;
  let hasta = esFecha(sp.hasta) ? sp.hasta! : hoy;
  if (sp.mes && /^\d{4}(-\d{2})?$/.test(sp.mes)) {
    if (sp.mes.length === 4) {
      desde = `${sp.mes}-01-01`;
      hasta = `${sp.mes}-12-31`;
    } else {
      const [y, m] = sp.mes.split("-").map(Number);
      desde = `${sp.mes}-01`;
      hasta = `${sp.mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    }
  }
  const [cierres, todos, sinVer] = await Promise.all([
    getCierres(desde, hasta),
    getCierres(),
    user.role === "ADMIN" ? cierresSinVer(user.id) : Promise.resolve([]),
  ]);
  const vistos = new Set(sinVer.map((c) => c.id));
  const filas = cierres.map((c) => ({ c, t: totalesDe(c) }));
  const sum = (f: (t: (typeof filas)[number]["t"]) => number) => filas.reduce((s, x) => s + f(x.t), 0);
  const total = {
    ventas: sum((t) => t.ventas), mayorista: sum((t) => t.mayorista), minorista: sum((t) => t.minorista),
    efectivo: sum((t) => t.efectivo), transferencia: sum((t) => t.transferencia), link: sum((t) => t.link),
    posnet: sum((t) => t.posnet), usd: sum((t) => t.usd), gastos: sum((t) => t.gastos), gastosUsd: sum((t) => t.gastosUsd),
    neto: sum((t) => t.neto), ingresosDinero: sum((t) => t.ingresosDinero),
  };
  const cuentas = new Map<string, number>();
  for (const { t } of filas) for (const [k, v] of t.porCuenta) cuentas.set(k, (cuentas.get(k) ?? 0) + v);
  const contadores = CONTADORES.map((k) => ({
    ...k,
    total: cierres.reduce((s, c) => s + (parseFloat(c.counters?.[k.key] ?? "") || 0), 0),
  })).filter((k) => k.total > 0);
  const cajaActual = todos.length ? totalesDe(todos[0]).cajaChica : 0;
  const meses = [...new Set(todos.map((c) => c.closing_date.slice(0, 7)))].sort().reverse();
  const anios = [...new Set(todos.map((c) => c.closing_date.slice(0, 4)))].sort().reverse();
  const hoyCargado = todos.find((c) => c.closing_date === hoy);
  const excel = `/api/caja/excel?desde=${desde}&hasta=${hasta}`;
  const periodo = desde === hasta ? dmy(desde) : `${dmy(desde)} al ${dmy(hasta)}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Cierre de caja</PageTitle>
        <div className="flex flex-wrap gap-2">
          <a href={excel} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush">
            Descargar Excel
          </a>
          <Link href={`/caja/${hoy}`} className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
            {hoyCargado ? (hoyCargado.status === "ENVIADO" ? "Ver cierre de hoy" : "Seguir cierre de hoy") : "Cargar cierre de hoy"}
          </Link>
        </div>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      {sinVer.length > 0 && (
        <div className="mb-4 rounded-lg border border-rose-deep/30 bg-blush-100 px-3 py-2 text-sm">
          📋 Cierres nuevos sin ver:{" "}
          {sinVer.map((c, i) => (
            <span key={c.id}>
              {i > 0 && " · "}
              <Link href={`/caja/${c.closing_date}`} className="font-semibold text-rose-deep hover:underline">
                {dmy(c.closing_date)}
              </Link>
            </span>
          ))}
        </div>
      )}

      <form method="get" className="mb-2">
        <RangoFechas desde={desde} hasta={hasta} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="submit" className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
            Filtrar
          </button>
          <span className="text-sm text-soft">Ir a:</span>
          {meses.slice(0, 12).map((m) => (
            <Link key={m} href={`/caja?mes=${m}`} className={`rounded-full border px-3 py-1 text-xs ${sp.mes === m ? "border-rose-deep bg-rose-deep text-white" : "border-line bg-white text-soft hover:border-blush"}`}>
              {MESES[Number(m.slice(5)) - 1]} {m.slice(0, 4)}
            </Link>
          ))}
          {anios.map((a) => (
            <Link key={a} href={`/caja?mes=${a}`} className={`rounded-full border px-3 py-1 text-xs ${sp.mes === a ? "border-rose-deep bg-rose-deep text-white" : "border-line bg-white text-soft hover:border-blush"}`}>
              Año {a}
            </Link>
          ))}
        </div>
      </form>
      <p className="mb-3 text-sm text-soft">
        {periodo} · {cierres.length} cierre(s) · caja chica actual: <b className="text-ink">{pesos(cajaActual)}</b>
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          ["Total ingresos", pesos(total.ventas), true],
          ["Mayorista", pesos(total.mayorista), false],
          ["Minorista", pesos(total.minorista), false],
          ["Gastos", `− ${pesos(total.gastos)}${total.gastosUsd ? ` · ${dolares(total.gastosUsd)}` : ""}`, false],
          ["Neto (ingresos − gastos)", pesos(total.neto), true],
          ["Efectivo", pesos(total.efectivo), false],
          ["Transferencia", pesos(total.transferencia), false],
          ["Link MP / Posnet", `${pesos(total.link)} / ${pesos(total.posnet)}`, false],
        ].map(([k, v, fuerte]) => (
          <div key={k as string} className={`rounded-xl border p-3 ${fuerte ? "border-rose-deep/30 bg-blush-100" : "border-blush-100 bg-white"}`}>
            <div className="text-xs text-soft">{k}</div>
            <div className={`mt-1 ${fuerte ? "font-display text-2xl" : "font-semibold"}`}>{v}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 font-semibold">¿Dónde entró la plata?</h2>
          {cuentas.size === 0 && <p className="text-sm text-soft">Sin pagos en el período.</p>}
          <ul className="space-y-1 text-sm">
            {[...cuentas.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="flex justify-between"><span>{k}</span><b>{pesos(v)}</b></li>
            ))}
            {total.usd > 0 && <li className="flex justify-between"><span>Pagos en USD</span><b>{dolares(total.usd)}</b></li>}
            {total.ingresosDinero > 0 && <li className="flex justify-between text-soft"><span>Ingresos de dinero (no venta)</span><span>{pesos(total.ingresosDinero)}</span></li>}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Gastos del período</h2>
          {filas.every(({ c }) => c.expenses.length === 0) && <p className="text-sm text-soft">Sin gastos.</p>}
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {filas.flatMap(({ c }) =>
              c.expenses.map((g) => (
                <li key={g.id} className="flex justify-between gap-2">
                  <span><span className="text-soft">{dmy(c.closing_date).slice(0, 5)}</span> {g.description ?? "—"}</span>
                  <b className="shrink-0">{g.currency === "USD" ? dolares(Number(g.amount)) : pesos(Number(g.amount))}</b>
                </li>
              ))
            )}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Operativo del período</h2>
          {contadores.length === 0 && <p className="text-sm text-soft">Sin datos.</p>}
          <ul className="space-y-1 text-sm">
            {contadores.map((k) => (
              <li key={k.key} className="flex justify-between"><span>{k.label}</span><b>{k.total}</b></li>
            ))}
          </ul>
        </Card>
      </div>

      <h2 className="mb-2 font-display text-2xl tracking-wide">Cierres</h2>
      <div className="space-y-2 md:hidden">
        {filas.map(({ c, t }) => (
          <Link key={c.id} href={`/caja/${c.closing_date}`} className="block rounded-lg border border-blush-100 bg-white p-3 hover:border-blush">
            <div className="flex items-baseline justify-between gap-2">
              <b>{dmy(c.closing_date)}</b>
              <span className="font-display text-2xl">{pesos(t.ventas)}</span>
            </div>
            <div className="mt-1 text-xs text-soft">
              Mayorista {pesos(t.mayorista)} · gastos {pesos(t.gastos)} · neto {pesos(t.neto)}
            </div>
            <div className="mt-1 flex gap-2 text-xs">
              {c.status === "BORRADOR" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Borrador</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Enviado</span>}
              {vistos.has(c.id) && <span className="rounded-full bg-rose-deep px-2 py-0.5 text-white">Nuevo</span>}
            </div>
          </Link>
        ))}
      </div>
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {["Fecha", "Estado", "Total ingresos", "Mayorista", "Efectivo", "Transferencia", "Gastos", "Neto", "Caja chica", ""].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map(({ c, t }) => (
                <tr key={c.id} className="border-b border-blush-100">
                  <td className={`${td} font-medium`}>{dmy(c.closing_date)}</td>
                  <td className={td}>
                    {c.status === "BORRADOR" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Borrador</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Enviado</span>}
                    {vistos.has(c.id) && <span className="ml-1 rounded-full bg-rose-deep px-2 py-0.5 text-xs text-white">Nuevo</span>}
                  </td>
                  <td className={`${td} font-semibold`}>{pesos(t.ventas)}</td>
                  <td className={td}>{pesos(t.mayorista)}</td>
                  <td className={td}>{pesos(t.efectivo)}</td>
                  <td className={td}>{pesos(t.transferencia)}</td>
                  <td className={td}>{t.gastos ? `− ${pesos(t.gastos)}` : "—"}</td>
                  <td className={`${td} font-semibold`}>{pesos(t.neto)}</td>
                  <td className={td}>{pesos(t.cajaChica)}</td>
                  <td className={td}>
                    <Link href={`/caja/${c.closing_date}`} className="text-sm font-medium text-rose-deep hover:underline">Ver</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {filas.length === 0 && (
        <Card>
          <p className="text-sm text-soft">No hay cierres en el período.</p>
        </Card>
      )}

      {filas.some(({ c }) => c.tasks) && (
        <>
          <h2 className="mb-2 mt-6 font-display text-2xl tracking-wide">Tareas operativas</h2>
          <div className="space-y-2">
            {filas.filter(({ c }) => c.tasks).map(({ c }) => (
              <Card key={c.id}>
                <div className="mb-1 text-sm font-semibold">{dmy(c.closing_date)}</div>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {c.tasks!.split("\n").map((s) => s.trim()).filter(Boolean).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}

      <form method="get" action="/caja/ir" className="mt-6 flex flex-wrap items-end gap-2 text-sm">
        <label className="text-soft">Cargar o ver otro día
          <input type="date" name="fecha" max={hoy} required className="mt-1 block rounded-lg border border-line bg-white px-3 py-2" />
        </label>
        <button type="submit" className="rounded-lg border border-line bg-white px-4 py-2 font-medium text-rose-deep hover:border-blush">Abrir</button>
      </form>
    </div>
  );
}
