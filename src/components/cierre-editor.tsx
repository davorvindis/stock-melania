"use client";

import { useEffect, useMemo, useState } from "react";
import { guardarCierre } from "@/lib/caja-actions";
import { CONTADORES, CUENTAS, dolares, pesos, totalesCierre, type GastoCaja, type LineaCaja } from "@/lib/caja-calc";

type Linea = { key: number } & Record<"order_ref" | "customer" | "description" | "cash" | "money_in" | "posnet" | "mp_link" | "transfer" | "account" | "usd" | "invoice", string> & { kind: "MINORISTA" | "MAYORISTA" };
type Gasto = { key: number; amount: string; currency: "ARS" | "USD"; description: string; from_petty_cash: boolean };
export type CierreInicial = {
  opening_cash: number;
  surplus: number;
  counters: Record<string, string>;
  tasks: string;
  notes: string;
  lines: LineaCaja[];
  expenses: GastoCaja[];
};

const MONTOS = [
  { k: "cash", label: "Efectivo" },
  { k: "money_in", label: "Ingresos de dinero" },
  { k: "posnet", label: "Posnet" },
  { k: "mp_link", label: "Link de pago MP" },
  { k: "transfer", label: "Transferencia" },
] as const;

const campo = "w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const txt = (v: unknown) => (v == null ? "" : String(v));

function Fila({ label, valor, fuerte = false }: { label: string; valor: string; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 py-0.5 ${fuerte ? "font-semibold" : ""}`}>
      <span className={fuerte ? "" : "text-soft"}>{label}</span>
      <span>{valor}</span>
    </div>
  );
}

let semilla = 1;
const nuevaLinea = (kind: Linea["kind"]): Linea => ({
  key: semilla++, kind, order_ref: "", customer: "", description: "", cash: "", money_in: "", posnet: "", mp_link: "", transfer: "", account: "", usd: "", invoice: "",
});
const nuevoGasto = (): Gasto => ({ key: semilla++, amount: "", currency: "ARS", description: "", from_petty_cash: true });

export function CierreEditor({
  fecha,
  inicial,
  sugerida,
  enviado,
}: {
  fecha: string;
  inicial: CierreInicial;
  sugerida: { monto: number; desde: string | null };
  enviado: boolean;
}) {
  const [lineas, setLineas] = useState<Linea[]>(() => {
    const l = inicial.lines.map((x) => ({
      key: semilla++, kind: x.kind, order_ref: txt(x.order_ref), customer: txt(x.customer), description: txt(x.description),
      cash: txt(x.cash), money_in: txt(x.money_in), posnet: txt(x.posnet), mp_link: txt(x.mp_link), transfer: txt(x.transfer),
      account: txt(x.account), usd: txt(x.usd), invoice: txt(x.invoice),
    }));
    if (!l.some((x) => x.kind === "MINORISTA")) l.unshift(nuevaLinea("MINORISTA"));
    if (!l.some((x) => x.kind === "MAYORISTA")) l.push(nuevaLinea("MAYORISTA"));
    return l;
  });
  const [gastos, setGastos] = useState<Gasto[]>(() =>
    inicial.expenses.length
      ? inicial.expenses.map((g) => ({ key: semilla++, amount: txt(g.amount), currency: g.currency, description: txt(g.description), from_petty_cash: g.from_petty_cash }))
      : [nuevoGasto()]
  );
  const [apertura, setApertura] = useState(txt(inicial.opening_cash || (enviado ? 0 : sugerida.monto) || ""));
  const [sobrante, setSobrante] = useState(inicial.surplus ? txt(inicial.surplus) : "");
  const [contadores, setContadores] = useState<Record<string, string>>(inicial.counters ?? {});
  const [tareas, setTareas] = useState(inicial.tasks ?? "");
  const [notas, setNotas] = useState(inicial.notes ?? "");
  const [cambios, setCambios] = useState(false);

  // avisar si se va de la página sin guardar
  useEffect(() => {
    if (!cambios) return;
    const f = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [cambios]);

  const datos = useMemo(() => {
    const lines: LineaCaja[] = lineas.map((l) => ({
      kind: l.kind, order_ref: l.order_ref, customer: l.customer, description: l.description,
      cash: num(l.cash), money_in: num(l.money_in), posnet: num(l.posnet), mp_link: num(l.mp_link), transfer: num(l.transfer),
      account: l.account, usd: num(l.usd), invoice: l.invoice,
    }));
    const expenses: GastoCaja[] = gastos.map((g) => ({ amount: num(g.amount), currency: g.currency, description: g.description, from_petty_cash: g.from_petty_cash }));
    return { opening_cash: num(apertura) ?? 0, surplus: num(sobrante) ?? 0, counters: contadores, tasks: tareas, notes: notas, lines, expenses };
  }, [lineas, gastos, apertura, sobrante, contadores, tareas, notas]);
  const t = totalesCierre(datos.lines, datos.expenses, datos.opening_cash, datos.surplus);

  const setLinea = (key: number, c: Partial<Linea>) => {
    setCambios(true);
    setLineas((x) => x.map((l) => (l.key === key ? { ...l, ...c } : l)));
  };
  const setGasto = (key: number, c: Partial<Gasto>) => {
    setCambios(true);
    setGastos((x) => x.map((g) => (g.key === key ? { ...g, ...c } : g)));
  };

  const seccion = (kind: Linea["kind"], titulo: string) => {
    const filas = lineas.filter((l) => l.kind === kind);
    const sub = totalesCierre(datos.lines.filter((l) => l.kind === kind), []);
    return (
      <section className="rounded-xl border border-blush-100 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl tracking-wide">{titulo}</h2>
          <span className="text-sm text-soft">
            Total: <b className="text-ink">{pesos(sub.ventas)}</b>
            {sub.usd ? ` · ${dolares(sub.usd)}` : ""}
          </span>
        </div>
        {/* escritorio: mismas columnas que la planilla */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-soft">
                <th className="px-1 py-1 w-20">Pedido</th>
                <th className="px-1 py-1">Cliente</th>
                <th className="px-1 py-1">Descripción</th>
                {MONTOS.map((m) => (
                  <th key={m.k} className="px-1 py-1 w-28">{m.label}</th>
                ))}
                <th className="px-1 py-1 w-28">Extras (cuenta)</th>
                <th className="px-1 py-1 w-20">Pago USD</th>
                <th className="px-1 py-1 w-20">Factura</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((l) => (
                <tr key={l.key}>
                  <td className="p-1"><input value={l.order_ref} onChange={(e) => setLinea(l.key, { order_ref: e.target.value })} className={campo} /></td>
                  <td className="p-1"><input value={l.customer} onChange={(e) => setLinea(l.key, { customer: e.target.value })} className={campo} /></td>
                  <td className="p-1"><input value={l.description} onChange={(e) => setLinea(l.key, { description: e.target.value })} className={campo} /></td>
                  {MONTOS.map((m) => (
                    <td key={m.k} className="p-1">
                      <input type="number" step="any" inputMode="decimal" value={l[m.k]} onChange={(e) => setLinea(l.key, { [m.k]: e.target.value })} className={`${campo} text-right`} />
                    </td>
                  ))}
                  <td className="p-1"><input list="cuentas-caja" value={l.account} onChange={(e) => setLinea(l.key, { account: e.target.value })} className={campo} /></td>
                  <td className="p-1"><input type="number" step="any" inputMode="decimal" value={l.usd} onChange={(e) => setLinea(l.key, { usd: e.target.value })} className={`${campo} text-right`} /></td>
                  <td className="p-1"><input value={l.invoice} onChange={(e) => setLinea(l.key, { invoice: e.target.value })} className={campo} /></td>
                  <td className="p-1">
                    <button type="button" aria-label="Quitar pago" onClick={() => { setCambios(true); setLineas((x) => x.filter((y) => y.key !== l.key)); }} className="rounded px-2 py-1 text-soft hover:bg-red-50 hover:text-red-700">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-right text-xs font-semibold">
                <td colSpan={3} className="px-1 pt-1 text-left text-soft">Subtotales</td>
                {[sub.efectivo, sub.ingresosDinero, sub.posnet, sub.link, sub.transferencia].map((v, i) => (
                  <td key={i} className="px-2 pt-1">{v ? pesos(v) : "—"}</td>
                ))}
                <td></td>
                <td className="px-2 pt-1">{sub.usd ? dolares(sub.usd) : "—"}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
        {/* celular / tablet: una tarjeta por pago */}
        <div className="space-y-2 lg:hidden">
          {filas.map((l, i) => (
            <div key={l.key} className="rounded-lg border border-line p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-soft">Pago {i + 1}</span>
                <button type="button" onClick={() => { setCambios(true); setLineas((x) => x.filter((y) => y.key !== l.key)); }} className="rounded px-2 py-0.5 text-xs text-soft hover:bg-red-50 hover:text-red-700">✕ Quitar</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-soft">Pedido<input value={l.order_ref} onChange={(e) => setLinea(l.key, { order_ref: e.target.value })} className={campo} /></label>
                <label className="text-xs text-soft">Cliente<input value={l.customer} onChange={(e) => setLinea(l.key, { customer: e.target.value })} className={campo} /></label>
                <label className="col-span-2 text-xs text-soft">Descripción<input value={l.description} onChange={(e) => setLinea(l.key, { description: e.target.value })} className={campo} /></label>
                {MONTOS.map((m) => (
                  <label key={m.k} className="text-xs text-soft">{m.label}
                    <input type="number" step="any" inputMode="decimal" value={l[m.k]} onChange={(e) => setLinea(l.key, { [m.k]: e.target.value })} className={`${campo} text-right`} />
                  </label>
                ))}
                <label className="text-xs text-soft">Extras (cuenta)<input list="cuentas-caja" value={l.account} onChange={(e) => setLinea(l.key, { account: e.target.value })} className={campo} /></label>
                <label className="text-xs text-soft">Pago USD<input type="number" step="any" inputMode="decimal" value={l.usd} onChange={(e) => setLinea(l.key, { usd: e.target.value })} className={`${campo} text-right`} /></label>
                <label className="text-xs text-soft">Factura<input value={l.invoice} onChange={(e) => setLinea(l.key, { invoice: e.target.value })} className={campo} /></label>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { setCambios(true); setLineas((x) => [...x, nuevaLinea(kind)]); }}
          className="mt-2 rounded-lg border border-dashed border-blush px-4 py-2 text-sm font-medium text-rose-deep hover:bg-blush-50"
        >
          + Agregar pago {kind === "MAYORISTA" ? "mayorista" : "minorista"}
        </button>
      </section>
    );
  };

  return (
    <form action={guardarCierre} onSubmit={() => setCambios(false)} className="space-y-4">
      <input type="hidden" name="fecha" value={fecha} />
      <input type="hidden" name="datos" value={JSON.stringify(datos)} />
      <datalist id="cuentas-caja">
        {CUENTAS.map((c) => <option key={c} value={c} />)}
      </datalist>

      {seccion("MINORISTA", "Pagos")}
      {seccion("MAYORISTA", "Mayorista")}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-blush-100 bg-white p-3">
          <h2 className="mb-2 font-display text-xl tracking-wide">Gastos</h2>
          <div className="space-y-2">
            {gastos.map((g) => (
              <div key={g.key} className="flex flex-wrap items-center gap-2">
                <input type="number" step="any" min="0" inputMode="decimal" placeholder="Monto" value={g.amount} onChange={(e) => setGasto(g.key, { amount: e.target.value })} className={`${campo} w-28 text-right`} />
                <select value={g.currency} onChange={(e) => setGasto(g.key, { currency: e.target.value as Gasto["currency"] })} className={`${campo} w-20`}>
                  <option value="ARS">$</option>
                  <option value="USD">USD</option>
                </select>
                <input placeholder="Descripción" value={g.description} onChange={(e) => setGasto(g.key, { description: e.target.value })} className={`${campo} min-w-[10rem] flex-1`} />
                <label className="flex items-center gap-1 text-xs text-soft">
                  <input type="checkbox" checked={g.from_petty_cash} onChange={(e) => setGasto(g.key, { from_petty_cash: e.target.checked })} className="h-4 w-4 accent-rose-deep" />
                  sale de caja chica
                </label>
                <button type="button" aria-label="Quitar gasto" onClick={() => { setCambios(true); setGastos((x) => x.filter((y) => y.key !== g.key)); }} className="rounded px-2 py-1 text-soft hover:bg-red-50 hover:text-red-700">✕</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => { setCambios(true); setGastos((x) => [...x, nuevoGasto()]); }} className="mt-2 rounded-lg border border-dashed border-blush px-4 py-2 text-sm font-medium text-rose-deep hover:bg-blush-50">
            + Agregar gasto
          </button>
          <p className="mt-2 text-sm">Total gastos: <b>{pesos(t.gastos)}</b>{t.gastosUsd ? ` · ${dolares(t.gastosUsd)}` : ""}</p>
        </section>

        <section className="rounded-xl border border-blush-100 bg-white p-3">
          <h2 className="mb-2 font-display text-xl tracking-wide">Caja chica</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-soft">Caja inicial
              <input type="number" step="any" inputMode="decimal" value={apertura} onChange={(e) => { setCambios(true); setApertura(e.target.value); }} className={`${campo} text-right`} />
            </label>
            <label className="text-xs text-soft">Sobran (+) / faltan (−)
              <input type="number" step="any" inputMode="decimal" value={sobrante} onChange={(e) => { setCambios(true); setSobrante(e.target.value); }} className={`${campo} text-right`} />
            </label>
          </div>
          {sugerida.desde && (
            <p className="mt-1 text-xs text-soft">
              Sugerida: {pesos(sugerida.monto)} (caja chica del cierre del {sugerida.desde.split("-").reverse().join("/")}).
            </p>
          )}
          <div className="mt-2 text-sm">
            <Fila label="+ Ingresos de dinero" valor={pesos(t.ingresosDinero)} />
            <Fila label="− Gastos pagados con la caja" valor={pesos(t.gastosCaja)} />
            <Fila label="= Efectivo total en caja" valor={pesos(t.cajaChica)} fuerte />
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-rose-deep/30 bg-blush-50 p-3">
        <h2 className="mb-2 font-display text-xl tracking-wide">Resumen del día</h2>
        <div className="grid gap-x-8 text-sm sm:grid-cols-2">
          <div>
            <Fila label="CIERRE TOTAL (ingresos)" valor={pesos(t.ventas)} fuerte />
            <Fila label="Mayorista" valor={pesos(t.mayorista)} />
            <Fila label="Minorista" valor={pesos(t.minorista)} />
            <Fila label="Gastos" valor={`− ${pesos(t.gastos)}`} />
            <Fila label="Neto (ingresos − gastos)" valor={pesos(t.neto)} fuerte />
            {t.usd ? <Fila label="Pagos en USD" valor={dolares(t.usd)} /> : null}
          </div>
          <div>
            <Fila label="Efectivo" valor={pesos(t.efectivo)} />
            <Fila label="Posnet" valor={pesos(t.posnet)} />
            <Fila label="Transferencia" valor={pesos(t.transferencia)} />
            <Fila label="Link de pago MP" valor={pesos(t.link)} />
            {t.porCuenta.map(([c, v]) => (
              <Fila key={c} label={`→ Entró a ${c}`} valor={pesos(v)} />
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-blush-100 bg-white p-3">
          <h2 className="mb-2 font-display text-xl tracking-wide">Operativo del día</h2>
          <div className="grid grid-cols-2 gap-2">
            {CONTADORES.map((c) => (
              <label key={c.key} className="text-xs text-soft">{c.label}
                <input value={contadores[c.key] ?? ""} onChange={(e) => { setCambios(true); setContadores((x) => ({ ...x, [c.key]: e.target.value })); }} placeholder="—" className={campo} />
              </label>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-blush-100 bg-white p-3">
          <h2 className="mb-2 font-display text-xl tracking-wide">Tareas operativas (observaciones)</h2>
          <textarea
            rows={8}
            value={tareas}
            onChange={(e) => { setCambios(true); setTareas(e.target.value); }}
            placeholder={"Una tarea por renglón, ej.:\nse pegaron stickers a 1150 monodosis paso 1y2\nse contó el stock de la línea"}
            className={`${campo} text-base`}
          />
          <label className="mt-2 block text-xs text-soft">Notas para Joel y Mel
            <input value={notas} onChange={(e) => { setCambios(true); setNotas(e.target.value); }} className={campo} />
          </label>
        </section>
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-blush-100 bg-blush-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <button type="submit" name="accion" value="borrador" className="rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-semibold text-rose-deep hover:border-blush">
          Guardar borrador
        </button>
        <button
          type="submit"
          name="accion"
          value="enviar"
          onClick={(e) => {
            if (!confirm(`¿Enviar el cierre? Total ingresos ${pesos(t.ventas)} · gastos ${pesos(t.gastos)}. Joel y Mel van a ver el aviso.`)) e.preventDefault();
          }}
          className="rounded-lg bg-rose-deep px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper"
        >
          {enviado ? "Reenviar cierre" : "Enviar cierre"}
        </button>
        <span className="text-sm text-soft">
          Total <b className="text-ink">{pesos(t.ventas)}</b> · neto <b className="text-ink">{pesos(t.neto)}</b>
          {cambios ? " · hay cambios sin guardar" : ""}
        </span>
      </div>
    </form>
  );
}
