import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { getSuppliers } from "@/lib/queries";
import { ESTADOS_ABIERTOS, ESTADOS_OC, estadoOcClass, getOrdenes, nombreMes } from "@/lib/compras";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; q?: string; proveedor?: string; estado?: string; desde?: string; hasta?: string };

export default async function Compras({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSection("compras");
  const sp = await searchParams;
  const [ordenes, proveedores] = await Promise.all([getOrdenes(sp), getSuppliers()]);
  const hayFiltros = !!(sp.q || sp.proveedor || sp.estado || sp.desde || sp.hasta);

  const pendientes = ordenes.filter((o) => ESTADOS_ABIERTOS.includes(o.status));
  const enCamino = ordenes.flatMap((o) => o.shipments.filter((e) => e.status === "EN_CAMINO"));
  const conSaldo = ordenes.filter((o) => o.status !== "CANCELADA" && o.paid_pct != null && o.paid_pct < 100);

  // agrupadas por mes de la orden
  const porMes = new Map<string, typeof ordenes>();
  for (const o of ordenes) {
    const k = o.order_date.slice(0, 7) + "-01";
    if (!porMes.has(k)) porMes.set(k, []);
    porMes.get(k)!.push(o);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Órdenes de compra</PageTitle>
        <Link
          href="/compras/nueva"
          className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
        >
          + Nueva orden
        </Link>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-soft">Pendientes de recibir</div>
          <div className={`mt-1 font-display text-4xl leading-none ${pendientes.length ? "text-amber-700" : ""}`}>
            {pendientes.length}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-soft">Envíos en camino</div>
          <div className={`mt-1 font-display text-4xl leading-none ${enCamino.length ? "text-violet-700" : ""}`}>
            {enCamino.length}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-soft">Con pago pendiente (seña o sin pagar)</div>
          <div className={`mt-1 font-display text-4xl leading-none ${conSaldo.length ? "text-amber-700" : ""}`}>
            {conSaldo.length}
          </div>
        </Card>
      </div>

      <form method="get" className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar producto, proveedor, nota…"
          className={`${input} lg:col-span-2`}
        />
        <select name="proveedor" defaultValue={sp.proveedor ?? ""} aria-label="Proveedor" className={input}>
          <option value="">Todos los proveedores</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado" className={input}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS_OC).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input type="date" name="desde" defaultValue={sp.desde ?? ""} aria-label="Desde" className={input} />
        <div className="flex gap-2">
          <input type="date" name="hasta" defaultValue={sp.hasta ?? ""} aria-label="Hasta" className={input} />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
          >
            Filtrar
          </button>
        </div>
      </form>
      <p className="mb-4 text-sm text-soft">
        {ordenes.length} orden(es)
        {hayFiltros && (
          <>
            {" · "}
            <Link href="/compras" className="font-medium text-rose-deep hover:underline">
              Limpiar filtros
            </Link>
          </>
        )}
      </p>

      {[...porMes.entries()].map(([mes, lista]) => (
        <section key={mes} className="mb-6">
          <h2 className="mb-2 font-display text-2xl capitalize tracking-wide">{nombreMes(mes)}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {lista.map((o) => {
              const total = o.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
              return (
                <Link
                  key={o.id}
                  href={`/compras/${o.id}`}
                  className="block rounded-xl border border-line bg-white p-4 hover:border-blush"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{o.supplier.name}</div>
                      <div className="text-xs text-soft">
                        {fmtDate(o.order_date)}
                        {o.expected_date ? ` · entrega ${fmtDate(o.expected_date)}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estadoOcClass(o.status)}`}>
                        {ESTADOS_OC[o.status]}
                      </span>
                      <span
                        className={`text-xs ${
                          o.paid_pct != null && o.paid_pct < 100 && o.status !== "CANCELADA" ? "font-medium text-amber-700" : "text-soft"
                        }`}
                      >
                        {o.paid_pct == null ? "pago s/d" : o.paid_pct >= 100 ? "Pagada" : o.paid_pct === 0 ? "Sin pagar" : `Seña ${fmtQty(o.paid_pct)}%`}
                      </span>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {o.lines.slice(0, 4).map((l) => (
                      <li key={l.id} className="truncate">
                        {l.description}
                        {l.kind ? <span className="text-soft"> · {l.kind}</span> : null}
                      </li>
                    ))}
                    {o.lines.length > 4 && <li className="text-xs text-soft">+ {o.lines.length - 4} ítem(s) más</li>}
                  </ul>
                  {o.shipments.length > 0 && (() => {
                    const ult = o.shipments[o.shipments.length - 1];
                    return (
                      <div className={`mt-2 text-xs font-medium ${ult.status === "EN_CAMINO" ? "text-violet-700" : "text-soft"}`}>
                        🚚 {ult.from_place} → {ult.to_place} · {ult.status === "EN_CAMINO" ? "en camino" : "entregado"}
                      </div>
                    );
                  })()}
                  {total > 0 && <div className="mt-2 text-xs text-soft">Total {fmtMoney(total)}</div>}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      {ordenes.length === 0 && (
        <Card>
          <p className="text-sm text-soft">
            {hayFiltros ? "Ninguna orden coincide con los filtros." : "Todavía no hay órdenes de compra."}
          </p>
        </Card>
      )}
    </div>
  );
}
