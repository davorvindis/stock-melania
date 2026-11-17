import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { getSuppliers } from "@/lib/queries";
import {
  getCheques, resumenPorMes, beneficiario, aReservar, hoyAR, mesDe, sumarMeses, mesCorto, mesLargo, diasHasta,
  ESTADO_CHEQUE_LABEL, type Cheque, type EstadoCheque, type MesResumen,
} from "@/lib/cheques";
import { crearCheque, editarCheque, cambiarEstadoCheque } from "@/lib/cheques-actions";
import { fmtMoney, fmtDate } from "@/lib/types";
import { SubmitButton } from "@/components/submit-button";
import { Card, Flash, PageTitle, Stat, input, label, button, th, td } from "@/components/ui";
import { CHART } from "@/components/charts";

export const dynamic = "force-dynamic";

const COLOR: Record<"PAGADO" | "PENDIENTE" | "PROPUESTO", string> = {
  PAGADO: CHART.in,
  PENDIENTE: CHART.out,
  PROPUESTO: "#D9A19C",
};

const BADGE: Record<EstadoCheque, string> = {
  PENDIENTE: "bg-amber-50 text-amber-800 border-amber-200",
  PROPUESTO: "bg-blush-50 text-rose-deep border-blush-100",
  PAGADO: "bg-emerald-50 text-emerald-800 border-emerald-200",
  ANULADO: "bg-gray-100 text-gray-500 border-gray-200 line-through",
};

// "$ 14,5 M" para las etiquetas del gráfico
function corto(n: number): string {
  if (n >= 1_000_000) return `$ ${(n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (n >= 1_000) return `$ ${(n / 1_000).toLocaleString("es-AR", { maximumFractionDigits: 0 })} mil`;
  return fmtMoney(n);
}

function Badge({ e }: { e: EstadoCheque }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${BADGE[e]}`}>{ESTADO_CHEQUE_LABEL[e]}</span>;
}

export default async function Cheques({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; mes?: string; ver?: string; editar?: string }>;
}) {
  await requireSection("cheques");
  const sp = await searchParams;
  const [cheques, proveedores] = await Promise.all([getCheques(), getSuppliers()]);
  const hoy = hoyAR();
  const mesHoy = mesDe(hoy);
  const mesSel = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesHoy;
  const verTodos = sp.ver === "todos";
  const editando = sp.editar ? cheques.find((c) => c.id === sp.editar) : undefined;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base = { mes: mesSel !== mesHoy ? mesSel : undefined, ver: verTodos ? "todos" : undefined, ...extra };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/cheques?${s}` : "/cheques";
  };
  const back = qs({});

  const pendientes = cheques.filter(aReservar);
  const totalReservar = pendientes.reduce((s, c) => s + c.amount, 0);
  const vencidos = cheques.filter((c) => c.status === "PENDIENTE" && c.due_date < hoy);
  const delMesHoy = pendientes.filter((c) => mesDe(c.due_date) === mesHoy && c.due_date >= hoy);
  const proximo = pendientes.filter((c) => c.due_date >= hoy)[0];
  const proximoDia = proximo ? pendientes.filter((c) => c.due_date === proximo.due_date) : [];
  const resumen = resumenPorMes(cheques);
  const beneficiarios = [...new Set(resumen.flatMap((r) => [...r.porBeneficiario.keys()]))].sort();
  const lista = (verTodos ? cheques : cheques.filter((c) => aReservar(c) || mesDe(c.due_date) >= mesHoy))
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <div>
      <PageTitle>Cheques</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />

      {vencidos.length > 0 && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-800">
            <b>{vencidos.length} cheque(s) con fecha pasada siguen pendientes</b> (
            {vencidos.map((c) => `${fmtDate(c.due_date)} ${fmtMoney(c.amount)}`).join(" · ")}). Si ya se debitaron, tocá{" "}
            <b>Pagado</b> en la lista.
          </p>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fondos a reservar" value={corto(totalReservar)} hint={`${pendientes.length} cheque(s) pendientes o propuestos`} />
        <Stat
          label={`Resta debitar en ${mesLargo(mesHoy).split(" ")[0]}`}
          value={corto(delMesHoy.reduce((s, c) => s + c.amount, 0))}
          hint={delMesHoy.length ? `${delMesHoy.length} cheque(s)` : "Nada más este mes"}
        />
        <Stat
          label="Próximo débito"
          value={proximo ? fmtDate(proximo.due_date).slice(0, -5) : "—"}
          hint={
            proximo
              ? `${fmtMoney(proximoDia.reduce((s, c) => s + c.amount, 0))} · ${
                  diasHasta(proximo.due_date, hoy) === 0 ? "hoy" : `en ${diasHasta(proximo.due_date, hoy)} días`
                }`
              : "No hay cheques por debitar"
          }
        />
        <Stat
          label="Vencidos sin marcar"
          value={vencidos.length}
          alert={vencidos.length > 0}
          hint={vencidos.length ? "Revisar si se debitaron" : "Todo al día"}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-semibold">Fondos por mes</h2>
          <p className="mb-3 text-xs text-soft">Lo que se debita cada mes. Tocá un mes para ver su calendario.</p>
          <GraficoMeses resumen={resumen} mesSel={mesSel} href={(m) => qs({ mes: m === mesHoy ? undefined : m })} />
        </Card>
        <Card>
          <Calendario cheques={cheques} mes={mesSel} hoy={hoy} prev={qs({ mes: sumarMeses(mesSel, -1) })} next={qs({ mes: sumarMeses(mesSel, 1) })} />
        </Card>
      </div>

      {resumen.length > 0 && (
        <Card className="mb-4 overflow-x-auto">
          <h2 className="mb-2 font-semibold">Resumen por mes</h2>
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Mes</th>
                {beneficiarios.map((b) => (
                  <th key={b} className={`${th} text-right`}>{b}</th>
                ))}
                <th className={`${th} text-right`}>Total del mes</th>
                <th className={`${th} text-right`}>Pagado</th>
                <th className={`${th} text-right`}>Falta pagar</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.mes} className={`border-b border-blush-100 ${r.mes === mesSel ? "bg-blush-50" : ""}`}>
                  <td className={`${td} whitespace-nowrap`}>
                    <Link href={qs({ mes: r.mes === mesHoy ? undefined : r.mes })} className="font-medium hover:underline">
                      {mesLargo(r.mes)}
                    </Link>
                  </td>
                  {beneficiarios.map((b) => (
                    <td key={b} className={`${td} text-right`}>{r.porBeneficiario.get(b) ? fmtMoney(r.porBeneficiario.get(b)!) : "—"}</td>
                  ))}
                  <td className={`${td} text-right`}>{fmtMoney(r.total)}</td>
                  <td className={`${td} text-right text-emerald-800`}>{r.pagado > 0 ? fmtMoney(r.pagado) : <span className="text-soft">—</span>}</td>
                  <td className={`${td} text-right font-semibold text-rose-deep`}>
                    {r.pendiente + r.propuesto > 0 ? fmtMoney(r.pendiente + r.propuesto) : <span className="font-normal text-soft">—</span>}
                  </td>
                </tr>
              ))}
              <tr>
                <td className={`${td} font-semibold`}>Total</td>
                {beneficiarios.map((b) => (
                  <td key={b} className={`${td} text-right font-semibold`}>
                    {fmtMoney(resumen.reduce((s, r) => s + (r.porBeneficiario.get(b) ?? 0), 0))}
                  </td>
                ))}
                <td className={`${td} text-right font-semibold`}>{fmtMoney(resumen.reduce((s, r) => s + r.total, 0))}</td>
                <td className={`${td} text-right font-semibold text-emerald-800`}>{fmtMoney(resumen.reduce((s, r) => s + r.pagado, 0))}</td>
                <td className={`${td} text-right font-semibold text-rose-deep`}>{fmtMoney(totalReservar)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      <div id="form-cheque" className="scroll-mt-4" />
      <Card className={`mb-4 ${editando ? "ring-2 ring-blush" : ""}`}>
        <h2 className="mb-3 font-semibold">{editando ? "Editar cheque" : "Nuevo cheque"}</h2>
        <FormCheque c={editando} proveedores={proveedores.filter((p) => p.active || p.id === editando?.supplier_id)} back={back} />
        {editando && (
          <Link href={back} className="mt-2 inline-block text-sm text-soft hover:underline">Cancelar edición</Link>
        )}
      </Card>

      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{verTodos ? "Todos los cheques" : "Cheques pendientes y de este mes en adelante"}</h2>
        <Link href={qs({ ver: verTodos ? undefined : "todos" })} className="text-sm font-medium text-rose-deep hover:underline">
          {verTodos ? "Ver solo pendientes" : "Ver todos (incluye pagados y anulados) →"}
        </Link>
      </div>
      {lista.length === 0 ? (
        <Card><p className="text-sm text-soft">No hay cheques para mostrar.</p></Card>
      ) : (
        <>
          <div className="space-y-2 lg:hidden">
            {lista.map((c) => (
              <div key={c.id} className={`rounded-lg border bg-white p-3 ${c.status === "PENDIENTE" && c.due_date < hoy ? "border-red-300" : "border-blush-100"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{fmtDate(c.due_date)} · {fmtMoney(c.amount)}</div>
                    <div className="text-sm">{beneficiario(c)} — {c.concept}</div>
                    <div className="text-xs text-soft">{[c.bank, c.number && `N.º ${c.number}`, c.notes].filter(Boolean).join(" · ")}</div>
                  </div>
                  <Badge e={c.status} />
                </div>
                <Acciones c={c} back={back} editarHref={`${qs({ editar: c.id })}#form-cheque`} />
              </div>
            ))}
          </div>
          <Card className="hidden overflow-x-auto lg:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Vencimiento</th>
                  <th className={th}>Proveedor</th>
                  <th className={th}>Concepto</th>
                  <th className={`${th} text-right`}>Importe</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Banco / N.º</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id} className={`border-b border-blush-100 align-top ${c.status === "PENDIENTE" && c.due_date < hoy ? "bg-red-50" : ""}`}>
                    <td className={`${td} whitespace-nowrap font-medium`}>{fmtDate(c.due_date)}</td>
                    <td className={td}>{beneficiario(c)}</td>
                    <td className={td}>
                      {c.concept}
                      {c.notes && <div className="text-xs text-soft">{c.notes}</div>}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right font-medium`}>{fmtMoney(c.amount)}</td>
                    <td className={td}><Badge e={c.status} /></td>
                    <td className={`${td} text-soft`}>{[c.bank, c.number && `N.º ${c.number}`].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={td}><Acciones c={c} back={back} editarHref={`${qs({ editar: c.id })}#form-cheque`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

// ── gráfico de columnas apiladas por mes ────────────────────────────

function GraficoMeses({ resumen, mesSel, href }: { resumen: MesResumen[]; mesSel: string; href: (m: string) => string }) {
  if (resumen.length === 0) return <p className="text-sm text-soft">Todavía no hay cheques cargados.</p>;
  const max = Math.max(...resumen.map((r) => r.total), 1);
  const series = [
    ["PAGADO", "Pagado"],
    ["PENDIENTE", "Pendiente"],
    ["PROPUESTO", "Propuesto"],
  ] as const;
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 170 }}>
        {resumen.map((r) => (
          <Link
            key={r.mes}
            href={href(r.mes)}
            className={`group flex h-full flex-1 flex-col items-center justify-end rounded-md px-0.5 ${r.mes === mesSel ? "bg-blush-50" : "hover:bg-blush-50"}`}
            title={`${mesLargo(r.mes)}: total ${fmtMoney(r.total)} · pagado ${fmtMoney(r.pagado)} · pendiente ${fmtMoney(r.pendiente)}${r.propuesto ? ` · propuesto ${fmtMoney(r.propuesto)}` : ""}`}
          >
            <span className="mb-1 whitespace-nowrap text-[10px] font-medium text-soft">{r.total ? corto(r.total) : ""}</span>
            <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-[4px]" style={{ height: `${(r.total / max) * 125}px` }}>
              {series.map(([k]) => {
                const v = r[k.toLowerCase() as "pagado" | "pendiente" | "propuesto"];
                return v > 0 ? <div key={k} style={{ height: `${(v / r.total) * 100}%`, background: COLOR[k] }} /> : null;
              })}
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {resumen.map((r) => (
          <span key={r.mes} className={`flex-1 text-center text-[11px] ${r.mes === mesSel ? "font-semibold text-ink" : "text-soft"}`}>
            {mesCorto(r.mes)}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink">
        {series.map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: COLOR[k] }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── calendario del mes ──────────────────────────────────────────────

function Calendario({ cheques, mes, hoy, prev, next }: { cheques: Cheque[]; mes: string; hoy: string; prev: string; next: string }) {
  const vivos = cheques.filter((c) => c.status !== "ANULADO" && mesDe(c.due_date) === mes);
  const porDia = new Map<string, Cheque[]>();
  for (const c of vivos) porDia.set(c.due_date, [...(porDia.get(c.due_date) ?? []), c]);
  const [y, m] = mes.split("-").map(Number);
  const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const celdas: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: diasMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`),
  ];
  const faltaPagar = vivos.filter(aReservar).reduce((s, c) => s + c.amount, 0);
  const totalMes = vivos.reduce((s, c) => s + c.amount, 0);
  const fechas = [...porDia.keys()].sort();

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <Link href={prev} className="rounded-full border border-line px-3 py-1 text-sm hover:bg-blush-100" aria-label="Mes anterior">‹</Link>
        <h2 className="font-semibold capitalize">{mesLargo(mes)}</h2>
        <Link href={next} className="rounded-full border border-line px-3 py-1 text-sm hover:bg-blush-100" aria-label="Mes siguiente">›</Link>
      </div>
      <p className="mb-3 text-center text-xs text-soft">
        {totalMes ? (
          <>Total del mes {fmtMoney(totalMes)} · <b className={faltaPagar ? "text-rose-deep" : ""}>falta pagar {fmtMoney(faltaPagar)}</b></>
        ) : (
          "Sin cheques este mes"
        )}
      </p>

      {/* desktop: grilla de calendario */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-soft">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {celdas.map((f, i) => {
            if (!f) return <div key={`v${i}`} />;
            const del = porDia.get(f) ?? [];
            const suma = del.reduce((s, c) => s + c.amount, 0);
            const pendiente = del.some(aReservar);
            return (
              <div
                key={f}
                title={del.map((c) => `${beneficiario(c)} · ${c.concept} · ${fmtMoney(c.amount)} (${ESTADO_CHEQUE_LABEL[c.status]})`).join("\n")}
                className={`min-h-12 rounded-md border p-1 text-left ${
                  del.length === 0
                    ? "border-blush-100"
                    : pendiente
                      ? "border-rose-deep bg-blush-50"
                      : "border-emerald-200 bg-emerald-50"
                } ${f === hoy ? "ring-2 ring-blush" : ""}`}
              >
                <div className="text-[11px] text-soft">{Number(f.slice(8))}</div>
                {suma > 0 && <div className={`text-[11px] font-semibold leading-tight ${pendiente ? "text-rose-deep" : "text-emerald-800"}`}>{corto(suma)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* mobile y detalle: lista de vencimientos */}
      <ul className="mt-3 space-y-1.5">
        {fechas.map((f) =>
          porDia.get(f)!.map((c) => (
            <li key={c.id} className="flex items-baseline justify-between gap-2 border-b border-blush-100 pb-1 text-sm">
              <span>
                <b>{Number(f.slice(8))}/{Number(f.slice(5, 7))}</b> · {beneficiario(c)} — {c.concept}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                {fmtMoney(c.amount)} <Badge e={c.status} />
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ── acciones por cheque ─────────────────────────────────────────────

function Acciones({ c, back, editarHref }: { c: Cheque; back: string; editarHref: string }) {
  const chico = "rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-blush-100";
  return (
    <div className="mt-2 flex flex-wrap items-start gap-1.5 lg:mt-0 lg:flex-nowrap lg:justify-end">
      {(c.status === "PENDIENTE" || c.status === "PROPUESTO") && (
        <form action={cambiarEstadoCheque}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="estado" value="PAGADO" />
          <input type="hidden" name="back" value={back} />
          <SubmitButton className={`${chico} border-emerald-300 text-emerald-800`} confirmar={`¿Marcar como pagado el cheque de ${fmtMoney(c.amount)} del ${fmtDate(c.due_date)}?`}>
            Pagado
          </SubmitButton>
        </form>
      )}
      {(c.status === "PAGADO" || c.status === "ANULADO") && (
        <form action={cambiarEstadoCheque}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="estado" value="PENDIENTE" />
          <input type="hidden" name="back" value={back} />
          <SubmitButton className={chico} confirmar="¿Volver este cheque a pendiente?">Volver a pendiente</SubmitButton>
        </form>
      )}
      <Link href={editarHref} className={chico}>Editar</Link>
      {c.status !== "ANULADO" && (
        <details className="relative">
          <summary className={`${chico} cursor-pointer list-none text-red-700`}>Anular</summary>
          <form action={cambiarEstadoCheque} className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-lg border border-line bg-white p-3 shadow-lg">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="estado" value="ANULADO" />
            <input type="hidden" name="back" value={back} />
            <label className={label}>¿Por qué se anula?</label>
            <input type="text" name="motivo" required minLength={3} className={input} placeholder="Ej.: se reemplazó por otro cheque" />
            <SubmitButton className="w-full rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white">Anular cheque</SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}

// ── formulario nuevo / editar ───────────────────────────────────────

function FormCheque({ c, proveedores, back }: { c?: Cheque; proveedores: { id: string; name: string }[]; back: string }) {
  return (
    <form action={c ? editarCheque : crearCheque} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input type="hidden" name="back" value={back} />
      <div>
        <label className={label}>Vencimiento (débito) *</label>
        <input type="date" name="fecha" required defaultValue={c?.due_date} className={input} />
      </div>
      <div>
        <label className={label}>Proveedor *</label>
        <select name="proveedor" defaultValue={c ? (c.supplier_id ?? "otro") : ""} required className={input}>
          <option value="" disabled>Elegí…</option>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="otro">Otro (escribilo abajo)</option>
        </select>
      </div>
      <div>
        <label className={label}>Si es otro: a quién</label>
        <input type="text" name="beneficiario" defaultValue={c?.payee ?? ""} className={input} />
      </div>
      <div>
        <label className={label}>Importe (ARS) *</label>
        <input type="text" name="importe" inputMode="decimal" required defaultValue={c ? String(c.amount).replace(".", ",") : ""} placeholder="14.487.330" className={input} />
      </div>
      <div className="sm:col-span-2">
        <label className={label}>Concepto *</label>
        <input type="text" name="concepto" required defaultValue={c?.concept} placeholder="Ej.: Tintura negra" className={input} />
      </div>
      <div>
        <label className={label}>Estado</label>
        <select name="estado" defaultValue={c?.status ?? "PENDIENTE"} className={input}>
          <option value="PENDIENTE">Pendiente (emitido)</option>
          <option value="PROPUESTO">Propuesto (a confirmar)</option>
          <option value="PAGADO">Pagado (ya se debitó)</option>
          {c && <option value="ANULADO">Anulado</option>}
        </select>
      </div>
      {!c && (
        <div>
          <label className={label}>Cantidad de cheques</label>
          <input type="number" name="cantidad" min={1} max={24} defaultValue={1} className={input} />
          <p className="mt-1 text-xs text-soft">Si son varios, uno por mes desde la fecha, mismo importe.</p>
        </div>
      )}
      <div>
        <label className={label}>Banco / cuenta</label>
        <input type="text" name="banco" defaultValue={c?.bank ?? ""} className={input} />
      </div>
      <div>
        <label className={label}>N.º de cheque</label>
        <input type="text" name="numero" defaultValue={c?.number ?? ""} className={input} />
      </div>
      <div className="sm:col-span-2">
        <label className={label}>Observaciones</label>
        <input type="text" name="notas" defaultValue={c?.notes ?? ""} className={input} />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <SubmitButton className={button}>{c ? "Guardar cambios" : "Cargar cheque"}</SubmitButton>
      </div>
    </form>
  );
}
