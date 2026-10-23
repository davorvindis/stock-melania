import Link from "next/link";
import { can, requireSection } from "@/lib/auth";
import { getCajaFuerte, type MovimientoCF } from "@/lib/caja-fuerte";
import { revisarMovimientoCF } from "@/lib/caja-fuerte-actions";
import { hoyAR } from "@/lib/backup";
import { dolares, pesos } from "@/lib/caja-calc";
import { fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { FormCajaFuerte } from "@/components/form-caja-fuerte";

export const dynamic = "force-dynamic";

const dmy = (f: string) => f.split("-").reverse().join("/");
const plata = (v: number, m: "ARS" | "USD") => (m === "USD" ? dolares(v) : pesos(v));
const ESTADO: Record<MovimientoCF["status"], string> = {
  PENDIENTE: "bg-amber-100 text-amber-800",
  APROBADO: "bg-emerald-100 text-emerald-800",
  RECHAZADO: "bg-stone-200 text-stone-700",
};
const titulo = (m: MovimientoCF) =>
  m.kind === "RETIRO" ? `Retiro ${m.scope === "TOTAL" ? "total" : "parcial"}` : "Ingreso manual";

export default async function CajaFuertePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireSection("caja");
  const sp = await searchParams;
  const aprueba = user.role === "ADMIN" && can(user, "caja");
  const cf = await getCajaFuerte();
  const historial = [
    ...cf.movimientos.map((m) => ({ fecha: m.movement_date, m })),
    ...cf.entradas.map((e) => ({ fecha: e.fecha, e })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  return (
    <div className="max-w-4xl">
      <Link href="/caja" className="text-sm text-rose-deep hover:underline">
        ← Cierre de caja
      </Link>
      <PageTitle>Caja fuerte</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />
      <p className="mb-4 text-sm text-soft">
        Solo efectivo, en pesos y en dólares. Suma lo que en los cierres enviados figura con &quot;¿Dónde ingresó el dinero?&quot; = Caja
        fuerte, y los ingresos manuales; resta los retiros. Todo retiro o ingreso cuenta recién cuando lo aprueban Joel o Mel.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-rose-deep/30 bg-blush-100 p-3">
          <div className="text-xs text-soft">Pendiente de retirar (pesos)</div>
          <div className="mt-1 font-display text-2xl">{pesos(cf.porRetirar.ARS)}</div>
        </div>
        <div className="rounded-xl border border-rose-deep/30 bg-blush-100 p-3">
          <div className="text-xs text-soft">Pendiente de retirar (USD)</div>
          <div className="mt-1 font-display text-2xl">{dolares(cf.porRetirar.USD)}</div>
        </div>
        <div className="rounded-xl border border-blush-100 bg-white p-3">
          <div className="text-xs text-soft">Saldo en caja fuerte</div>
          <div className="mt-1 font-semibold">{pesos(cf.saldo.ARS)}</div>
          <div className="text-sm">{dolares(cf.saldo.USD)}</div>
        </div>
        <div className={`rounded-xl border p-3 ${cf.pendientesAprobar.length ? "border-amber-300 bg-amber-50" : "border-blush-100 bg-white"}`}>
          <div className="text-xs text-soft">Esperando aprobación</div>
          <div className="mt-1 font-semibold">{cf.pendientesAprobar.length} movimiento(s)</div>
          {(cf.pendiente.ARS > 0 || cf.pendiente.USD > 0) && (
            <div className="text-xs text-amber-800">
              Retiros: {pesos(cf.pendiente.ARS)}
              {cf.pendiente.USD ? ` · ${dolares(cf.pendiente.USD)}` : ""}
            </div>
          )}
        </div>
      </div>

      {cf.pendientesAprobar.length > 0 && (
        <Card className="mb-4 border-amber-300">
          <h2 className="mb-2 font-semibold">{aprueba ? "Para aprobar" : "Esperando aprobación de Joel o Mel"}</h2>
          <ul className="space-y-3">
            {cf.pendientesAprobar.map((m) => (
              <li key={m.id} className="rounded-lg bg-amber-50 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <b>{titulo(m)}</b> · {dmy(m.movement_date)}
                    {m.person ? ` · ${m.kind === "RETIRO" ? "retiró" : "trajo"} ${m.person}` : ""}
                  </span>
                  <b className="text-lg">{plata(m.amount, m.currency)}</b>
                </div>
                <div className="text-xs text-soft">
                  Cargó {m.requested_by} · {fmtDateTime(m.requested_at)}
                  {m.notes ? ` · ${m.notes}` : ""}
                </div>
                {m.kind === "RETIRO" && m.amount > cf.saldo[m.currency] && (
                  <div className="mt-1 text-xs font-medium text-red-700">
                    ⚠ Es más de lo que figura en la caja fuerte ({plata(cf.saldo[m.currency], m.currency)}). Revisá si falta cargar algún ingreso.
                  </div>
                )}
                {aprueba && (
                  <form action={revisarMovimientoCF} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="nota" placeholder="Nota (obligatoria si rechazás)" className="min-w-[12rem] flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm" />
                    <SubmitButton name="decision" value="aprobar" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                      Aprobar
                    </SubmitButton>
                    <SubmitButton name="decision" value="rechazar" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-red-700 hover:border-red-300">
                      Rechazar
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <details className="mb-4 rounded-xl border border-blush-100 bg-white p-4" open={cf.pendientesAprobar.length === 0}>
        <summary className="cursor-pointer font-semibold text-rose-deep">+ Registrar retiro o ingreso</summary>
        <div className="mt-4">
          <FormCajaFuerte porRetirar={cf.porRetirar} hoy={hoyAR()} />
        </div>
      </details>

      <h2 className="mb-2 font-display text-2xl tracking-wide">Historial</h2>
      <div className="space-y-2">
        {historial.map((h, i) =>
          "m" in h && h.m ? (
            <div key={h.m.id} className={`rounded-lg border bg-white p-3 text-sm ${h.m.status === "RECHAZADO" ? "border-line opacity-60" : "border-blush-100"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <b>{dmy(h.fecha)}</b> · {titulo(h.m)}
                  {h.m.person ? ` · ${h.m.kind === "RETIRO" ? "retiró" : "trajo"} ${h.m.person}` : ""}{" "}
                  <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${ESTADO[h.m.status]}`}>{h.m.status.toLowerCase()}</span>
                </span>
                <b className={h.m.kind === "RETIRO" ? "text-red-700" : "text-emerald-700"}>
                  {h.m.kind === "RETIRO" ? "− " : "+ "}
                  {plata(h.m.amount, h.m.currency)}
                </b>
              </div>
              <div className="text-xs text-soft">
                Cargó {h.m.requested_by}
                {h.m.reviewed_by ? ` · ${h.m.status === "APROBADO" ? "aprobó" : "rechazó"} ${h.m.reviewed_by} el ${fmtDateTime(h.m.reviewed_at!)}` : ""}
                {h.m.notes ? ` · ${h.m.notes}` : ""}
                {h.m.review_note ? ` · nota: ${h.m.review_note}` : ""}
              </div>
            </div>
          ) : "e" in h && h.e ? (
            <div key={`e${i}`} className="rounded-lg border border-blush-100 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <Link href={`/caja/${h.fecha}`} className="font-semibold text-rose-deep hover:underline">{dmy(h.fecha)}</Link> · Ingreso por cierre de caja
                  {h.e.cliente ? ` · ${h.e.cliente}` : ""}
                </span>
                <b className="text-emerald-700">
                  + {[h.e.ars ? pesos(h.e.ars) : "", h.e.usd ? dolares(h.e.usd) : ""].filter(Boolean).join(" · ")}
                </b>
              </div>
            </div>
          ) : null
        )}
        {historial.length === 0 && (
          <Card>
            <p className="text-sm text-soft">Todavía no hay movimientos en la caja fuerte.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
