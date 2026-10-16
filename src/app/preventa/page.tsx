import Link from "next/link";
import { randomUUID } from "crypto";
import { requireSection } from "@/lib/auth";
import { getBalances, getProducts, isAvailable } from "@/lib/queries";
import { ESTADOS_PREVENTA, estadoPreventaClass, getPreventas, pendiente } from "@/lib/preventa";
import { cancelarPreventa, crearPreventa, entregarPreventas } from "@/lib/preventa-actions";
import { fmtDate, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LineasPreventa } from "@/components/lineas-preventa";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; estado?: string; q?: string };

export default async function PreventaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSection("preventa");
  const sp = await searchParams;
  const [preventas, productos, balances] = await Promise.all([getPreventas(), getProducts(), getBalances()]);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

  const abiertas = preventas.filter((p) => p.status === "PENDIENTE" || p.status === "PARCIAL");
  // stock disponible por producto (para "entregar desde stock")
  const disponibles = balances.filter(isAvailable);
  const stockDe = (pid: string) => disponibles.filter((b) => b.product.id === pid);
  const totalStock = (pid: string) => stockDe(pid).reduce((s, b) => s + Number(b.quantity), 0);

  // resumen: prevendido pendiente por producto
  const resumen = new Map<string, { nombre: string; unidad: string; pendiente: number; clientes: Set<string> }>();
  for (const p of abiertas) {
    for (const l of p.lines) {
      const falta = pendiente(l);
      if (falta <= 0) continue;
      const r = resumen.get(l.product.id) ?? { nombre: l.product.name, unidad: l.product.unit, pendiente: 0, clientes: new Set() };
      r.pendiente += falta;
      r.clientes.add(p.customer);
      resumen.set(l.product.id, r);
    }
  }
  const filasResumen = [...resumen.entries()].sort((a, b) => b[1].pendiente - a[1].pendiente);

  const estado = sp.estado ?? "abiertas";
  let lista = estado === "abiertas" ? abiertas : estado === "todas" ? preventas : preventas.filter((p) => p.status === estado);
  if (sp.q) {
    const t = sp.q.toLowerCase();
    lista = lista.filter(
      (p) =>
        p.customer.toLowerCase().includes(t) ||
        (p.order_ref ?? "").toLowerCase().includes(t) ||
        p.lines.some((l) => l.product.name.toLowerCase().includes(t) || l.product.sku.toLowerCase().includes(t))
    );
  }
  const opciones = productos
    .filter((p) => p.active && p.type !== "KIT")
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.sku}` }));

  return (
    <div>
      <PageTitle>Preventa</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />

      {filasResumen.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-2 font-semibold">Prevendido pendiente de entregar</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Producto</th>
                  <th className={th}>Pendiente</th>
                  <th className={th}>Clientes</th>
                  <th className={th}>Stock disponible hoy</th>
                </tr>
              </thead>
              <tbody>
                {filasResumen.map(([pid, r]) => {
                  const stock = totalStock(pid);
                  return (
                    <tr key={pid} className="border-b border-blush-100">
                      <td className={`${td} font-medium`}>{r.nombre}</td>
                      <td className={`${td} font-semibold`}>
                        {fmtQty(r.pendiente)} {r.unidad}
                      </td>
                      <td className={td}>{r.clientes.size}</td>
                      <td className={`${td} ${stock > 0 ? "font-medium text-emerald-700" : "text-soft"}`}>
                        {stock > 0 ? `${fmtQty(stock)} · se puede entregar` : "sin stock (en producción)"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <details open={!!sp.error || preventas.length === 0}>
          <summary className="cursor-pointer font-semibold text-rose-deep">+ Nueva preventa</summary>
          <form action={crearPreventa} className="mt-3 grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className={label}>Cliente *</label>
              <input type="text" name="cliente" required placeholder="ej. Gabriela Messynger" className={input} />
            </div>
            <div>
              <label className={label}>N° de pedido</label>
              <input type="text" name="pedido" placeholder="ej. Pedido n.º 90012" className={input} />
            </div>
            <div>
              <label className={label}>Canal</label>
              <select name="canal" defaultValue="MAYORISTA" className={input}>
                <option value="MAYORISTA">Mayorista</option>
                <option value="MINORISTA">Minorista</option>
              </select>
            </div>
            <div>
              <label className={label}>Fecha *</label>
              <input type="date" name="fecha" required defaultValue={hoy} className={input} />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>Notas</label>
              <input type="text" name="notas" placeholder="ej. pagó seña, envío por Andreani" className={input} />
            </div>
            <div className="sm:col-span-4">
              <label className={label}>Productos *</label>
              <LineasPreventa productos={opciones} />
            </div>
            <div className="sm:col-span-4">
              <SubmitButton className="rounded-lg bg-rose-deep px-5 py-2.5 font-semibold text-white hover:bg-rose-deeper">
                Guardar preventa
              </SubmitButton>
              <p className="mt-2 text-xs text-soft">
                No mueve stock: queda reservada hasta que entre la mercadería. Al cargar el ingreso te va a aparecer para entregarla.
              </p>
            </div>
          </form>
        </details>
      </Card>

      <form method="get" className="mb-3 flex flex-wrap gap-2">
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar cliente, pedido o producto…" className={`${input} w-auto flex-1`} />
        <select name="estado" defaultValue={estado} aria-label="Estado" className={`${input} w-auto`}>
          <option value="abiertas">Pendientes y parciales</option>
          <option value="ENTREGADA">Entregadas</option>
          <option value="CANCELADA">Canceladas</option>
          <option value="todas">Todas</option>
        </select>
        <button type="submit" className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
          Filtrar
        </button>
      </form>
      <p className="mb-3 text-sm text-soft">
        {lista.length} preventa(s)
        {(sp.q || sp.estado) && (
          <>
            {" · "}
            <Link href="/preventa" className="font-medium text-rose-deep hover:underline">
              Limpiar
            </Link>
          </>
        )}
      </p>

      <div className="space-y-2">
        {lista.map((p) => {
          const abierta = p.status === "PENDIENTE" || p.status === "PARCIAL";
          const conStock = p.lines.filter((l) => pendiente(l) > 0 && totalStock(l.product.id) > 0);
          return (
            <details key={p.id} className="rounded-xl border border-line bg-white p-3">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <b>{p.customer}</b>
                    <span className="text-sm text-soft">
                      {p.order_ref ? ` · ${p.order_ref}` : ""} · {fmtDate(p.order_date)} · {p.channel === "MAYORISTA" ? "mayorista" : "minorista"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {abierta && conStock.length > 0 && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">hay stock</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estadoPreventaClass(p.status)}`}>{ESTADOS_PREVENTA[p.status]}</span>
                  </span>
                </div>
                <div className="mt-0.5 truncate text-sm">
                  {p.lines.map((l) => `${fmtQty(l.quantity)} × ${l.product.name}`).join(" · ")}
                </div>
              </summary>
              <div className="mt-3 border-t border-blush-100 pt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-soft">
                      <th className="py-1">Producto</th>
                      <th className="py-1">Pedido</th>
                      <th className="py-1">Entregado</th>
                      <th className="py-1">Pendiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l) => (
                      <tr key={l.id} className="border-t border-blush-100">
                        <td className="py-1.5">{l.product.name}</td>
                        <td className="py-1.5">{fmtQty(l.quantity)}</td>
                        <td className="py-1.5">{Number(l.delivered) ? fmtQty(l.delivered) : "—"}</td>
                        <td className={`py-1.5 font-semibold ${pendiente(l) > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                          {pendiente(l) > 0 ? fmtQty(pendiente(l)) : "✓"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {p.notes && <p className="mt-2 text-sm text-soft">📝 {p.notes}</p>}
                <p className="mt-1 text-xs text-soft">Cargó {p.created_by ?? "—"}</p>

                {abierta && conStock.length > 0 && (
                  <form action={entregarPreventas} className="mt-3 rounded-lg bg-emerald-50/60 p-3">
                    <input type="hidden" name="idem" value={randomUUID()} />
                    <input type="hidden" name="volver" value="/preventa" />
                    <input type="hidden" name="back" value="/preventa" />
                    <h3 className="mb-2 text-sm font-semibold">Entregar desde el stock</h3>
                    <div className="space-y-2">
                      {conStock.map((l) => {
                        const origenes = stockDe(l.product.id);
                        return (
                          <div key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="min-w-40 flex-1">{l.product.name}</span>
                            <input type="hidden" name="al_line" value={l.id} />
                            <select
                              name="al_loc_lot"
                              aria-label="Desde dónde sale"
                              className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm"
                              defaultValue={`${origenes[0].location.id}|${origenes[0].lot?.id ?? ""}`}
                            >
                              {origenes.map((b) => (
                                <option key={b.id} value={`${b.location.id}|${b.lot?.id ?? ""}`}>
                                  {b.location.name}
                                  {b.lot ? ` · lote ${b.lot.code}` : ""} ({fmtQty(b.quantity)})
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              name="al_qty"
                              min="0"
                              max={pendiente(l)}
                              step="any"
                              defaultValue={Math.min(pendiente(l), Number(origenes[0].quantity))}
                              aria-label="Cantidad a entregar"
                              className="w-24 rounded-lg border border-line px-2 py-1.5 text-center"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <SubmitButton className="mt-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
                      Entregar (registra la venta)
                    </SubmitButton>
                  </form>
                )}

                {abierta && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-soft hover:text-red-700">Cancelar preventa</summary>
                    <form action={cancelarPreventa} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="preventa" value={p.id} />
                      <input type="text" name="motivo" required placeholder="Motivo" className="rounded-lg border border-line px-2 py-1.5 text-sm" />
                      <SubmitButton className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700">Cancelar</SubmitButton>
                    </form>
                  </details>
                )}
              </div>
            </details>
          );
        })}
        {lista.length === 0 && (
          <Card>
            <p className="text-sm text-soft">No hay preventas {estado === "abiertas" ? "pendientes" : "con este filtro"}.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
