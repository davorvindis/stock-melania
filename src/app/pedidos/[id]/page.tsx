import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "crypto";
import { requireSection } from "@/lib/auth";
import { getDisponibles, getPedidoWix, getRevisionesPedido, pendientesItem, reembolsablesItem } from "@/lib/wix/queries";
import { getWixSettings } from "@/lib/wix/processor";
import { actualizarPedidoDesdeWix, guardarSeguimiento, marcarEntregaPedido, marcarPedidoRevisado, procesarPedido, reembolsarPedido, resolverReembolsoPos } from "@/lib/wix/actions";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { badgeEntrega, badgeEstado, demorado, metodoEntrega } from "@/components/pedido-badge";

export const dynamic = "force-dynamic";

export default async function PedidoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireSection("pedidos");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await getPedidoWix(id);
  if (!r) notFound();
  const { pedido: p, items, fulfillments, reembolsos } = r;
  const [settings, revisiones] = await Promise.all([getWixSettings(), getRevisionesPedido(id)]);
  const puedeRevisar = user.role === "ADMIN" || user.role === "MANAGER";
  const disp = p.location?.id ? await getDisponibles(p.location.id, items.flatMap((i) => i.reservations.map((x) => x.product.id))) : new Map();
  const pendientes = items.map((i) => ({ item: i, pend: pendientesItem(i) })).filter((x) => x.pend > 0);
  // editado en Wix después de armar: unidades que hay que sacar del paquete (vuelven al stock al rearmar)
  const aSacar = items.flatMap((i) => i.reservations.filter((rv) => Number(rv.to_return) > 0).map((rv) => ({ item: i, rv })));
  const puedeProcesar = (p.state === "RESERVED" || p.state === "PARTIAL") && (pendientes.length > 0 || aSacar.length > 0);
  // armado y listo: falta que salga (despacho o retiro por el local); el botón principal sigue el método de Wix
  const puedeEntregar = p.state === "PROCESSED" && p.channel_type !== "POS" && !p.delivery_status && aSacar.length === 0;
  const esRetiro = metodoEntrega(p).clave === "RETIRO";
  // reembolso en el POS de una venta ya descontada: lo resuelve quien está en el local
  const reembolsoPos =
    p.channel_type === "POS" && p.state === "PROCESSED" && !p.refund_resolution && (p.payment_status === "FULLY_REFUNDED" || p.wix_status === "CANCELED");
  // seguimiento de Correo Argentino: no aplica a moto, retiro ni ventas del local
  const llevaSeguimiento = p.channel_type !== "POS" && !["MOTO", "RETIRO"].includes(metodoEntrega(p).clave);
  const puedeSeguimiento = p.channel_type !== "POS" && (p.state === "PROCESSED" || p.state === "PARTIAL") && (llevaSeguimiento || !!p.tracking_number);
  const siteId = process.env.WIX_SITE_ID;
  const canal = p.channel_type === "POS" ? "Local (POS)" : p.channel_type === "BACKOFFICE_MERCHANT" ? "Manual en Wix" : "Tienda web";
  // reembolso de lo ya armado (pedidos web): total o parcial, por producto
  const aReembolsar = items.map((i) => ({ item: i, max: reembolsablesItem(i) })).filter((x) => x.max > 0);
  const puedeReembolsar =
    puedeRevisar && p.channel_type !== "POS" && (p.state === "PROCESSED" || p.state === "PARTIAL") && aSacar.length === 0 && aReembolsar.length > 0;
  const reembolsosPorItem = new Map<string, typeof reembolsos>();
  for (const x of reembolsos) reembolsosPorItem.set(x.item_id, [...(reembolsosPorItem.get(x.item_id) ?? []), x]);
  const panelReembolso = puedeReembolsar && (
    <details className="group open:basis-full">
      <summary className="cursor-pointer list-none rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-800 hover:bg-red-50 group-open:inline-block">
        Reembolso
      </summary>
      <form action={reembolsarPedido} className="mt-2 rounded-lg border border-red-200 bg-white p-3 text-sm">
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="batch" value={randomUUID()} />
        <p className="text-xs text-soft">
          Primero hacé el reembolso en Wix (la plata se devuelve ahí). Acá se registra qué pasa con el stock. Para un reembolso parcial, cambiá las cantidades.
        </p>
        <table className="mt-2 w-full">
          <tbody>
            {aReembolsar.map(({ item, max }) => (
              <tr key={item.id} className="border-b border-blush-100">
                <td className="py-1.5 pr-2">{item.name ?? item.external_sku}</td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  <input type="number" name={`reembolso_${item.id}`} min={0} max={max} step="1" defaultValue={max} className={`${input} w-20`} />
                  <span className="ml-1 text-xs text-soft">de {fmtQty(max)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <fieldset className="mt-3 space-y-1">
          <legend className="font-medium">¿El producto vuelve al stock?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="vuelve" value="si" defaultChecked /> Sí, vuelve al Depósito (se revierte la venta)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="vuelve" value="no" /> No vuelve (fallado, se lo quedó la clienta): el stock no se toca
          </label>
        </fieldset>
        <SubmitButton
          confirmar="¿Confirmás el reembolso? Se va a registrar con tu usuario."
          className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          Confirmar reembolso
        </SubmitButton>
      </form>
    </details>
  );
  const porItem = new Map<string, typeof fulfillments>();
  for (const f of fulfillments) porItem.set(f.item_id, [...(porItem.get(f.item_id) ?? []), f]);

  return (
    <div>
      <PageTitle>Pedido #{p.number ?? "—"}</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />
      <Link href="/pedidos" className="text-sm text-rose-deep hover:underline">← Pedidos</Link>

      {reembolsoPos && (
        <Card className="mt-3 border-amber-300 bg-amber-50">
          <p className="text-sm"><b className="text-amber-900">⚠ Reembolsado en el POS.</b> ¿El producto volvió al Store?</p>
          <p className="mt-1 text-xs text-amber-800">
            Si volvió, la venta se revierte y el producto vuelve al stock del Store. Si no volvió (ej. estaba fallado y se tiró), el stock no se toca.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={resolverReembolsoPos}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="volvio" value="si" />
              <SubmitButton className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                Volvió al Store
              </SubmitButton>
            </form>
            <form action={resolverReembolsoPos}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="volvio" value="no" />
              <SubmitButton className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100">
                No volvió
              </SubmitButton>
            </form>
          </div>
        </Card>
      )}
      {p.review_reason && !reembolsoPos && (
        <Card className="mt-3 border-amber-300 bg-amber-50">
          <p className="text-sm"><b className="text-amber-900">⚠ A revisar:</b> {p.review_reason}</p>
          {puedeRevisar ? (
            <form action={marcarPedidoRevisado} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="pedido" value={p.id} />
              <input
                name="nota"
                required
                placeholder="¿Qué se hizo? ej. devolvió la clienta, revertido en Movimientos"
                className="min-w-[14rem] flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm"
              />
              <SubmitButton className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700">
                Marcar como revisado
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-1 text-xs text-amber-800">Avisale a Yura, Mel o Joel para que lo resuelvan.</p>
          )}
        </Card>
      )}
      {revisiones.length > 0 && (
        <details className="mt-3 rounded-xl border border-blush-100 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium">Revisiones ({revisiones.length})</summary>
          <ul className="mt-2 space-y-2">
            {revisiones.map((r) => (
              <li key={r.id} className="rounded-lg bg-blush-50 p-2">
                <div className="text-xs text-soft">
                  ✓ {r.reviewed_by} · {fmtDateTime(r.reviewed_at)}
                </div>
                <div>
                  <span className="text-soft">Aviso:</span> {r.reason}
                </div>
                <div>
                  <span className="text-soft">Qué se hizo:</span> {r.note}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {demorado(p) && (
        <Card className="mt-3 border-red-300 bg-red-50">
          <p className="text-sm font-medium text-red-800">Pagado hace más de 3 días y todavía no se procesó.</p>
        </Card>
      )}
      {!settings.enabled && (
        <Card className="mt-3 border-amber-200">
          <p className="text-sm text-amber-800">La integración con Wix está <b>desconectada</b>: al procesar se descuenta el stock pero Wix no se entera.</p>
        </Card>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Card>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-soft">Estado</dt><dd>{badgeEstado(p)}</dd>
            <dt className="text-soft">Canal</dt><dd>{canal}{p.wholesale && <span className="ml-2 rounded-full bg-rose-deep px-2 py-0.5 text-xs font-semibold text-white">Mayorista</span>}</dd>
            <dt className="text-soft">Entrega</dt><dd>{badgeEntrega(p)}{p.envio_titulo && p.channel_type !== "POS" && <span className="ml-2 text-xs text-soft">{p.envio_titulo.trim()}</span>}</dd>
            <dt className="text-soft">Cliente</dt><dd>{p.customer ?? "—"}{p.email && <span className="text-soft"> · {p.email}</span>}</dd>
            <dt className="text-soft">Fecha</dt><dd>{p.ordered_at ? fmtDateTime(p.ordered_at) : "—"}</dd>
            <dt className="text-soft">Total</dt><dd>{fmtMoney(p.total)} {p.currency ?? ""}</dd>
            <dt className="text-soft">Sale de</dt><dd>{p.location?.name ?? "—"}</dd>
          </dl>
        </Card>
        <Card>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-soft">En Wix</dt><dd>{p.wix_status ?? "—"} · pago {p.payment_status ?? "—"} · {p.fulfillment_status ?? "—"}</dd>
            <dt className="text-soft">Pagado</dt><dd>{p.paid_at ? fmtDateTime(p.paid_at) : "—"}</dd>
            <dt className="text-soft">Procesado</dt><dd>{p.processed_at ? `${fmtDateTime(p.processed_at)} por ${p.processed_by}` : "—"}</dd>
            {p.refund_resolution && p.refund_resolved_at && (
              <>
                <dt className="text-soft">Reembolso</dt>
                <dd>
                  {p.refund_resolution === "RETURNED" ? "Volvió al Store" : "No volvió al Store"}
                  <span className="text-soft"> · {fmtDateTime(p.refund_resolved_at)} por {p.refund_resolved_by}</span>
                </dd>
              </>
            )}
            {(p.tracking_number || puedeSeguimiento) && (
              <>
                <dt className="text-soft">Seguimiento</dt>
                <dd>
                  {p.tracking_number ? (
                    <>
                      <span className="font-mono">{p.tracking_number}</span>
                      {p.tracking_synced ? (
                        <span className="ml-2 text-xs text-emerald-700">✓ en Wix</span>
                      ) : (
                        <span className="ml-2 text-xs text-amber-700" title={p.tracking_error ?? ""}>
                          pendiente de mandar a Wix{p.tracking_error ? `: ${p.tracking_error}` : ""}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-soft">—</span>
                  )}
                  {puedeSeguimiento && (
                    <form action={guardarSeguimiento} className="mt-1 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="seguimiento" required maxLength={100} placeholder="N° de Correo Argentino" defaultValue={p.tracking_number ?? ""} className="min-w-[12rem] flex-1 rounded-lg border border-line bg-white px-2 py-1 font-mono text-xs" />
                      <SubmitButton className="rounded-lg border border-line px-3 py-1 text-xs font-medium hover:bg-blush-50">
                        {p.tracking_number ? "Cambiar" : "Cargar"}
                      </SubmitButton>
                    </form>
                  )}
                </dd>
              </>
            )}
            {p.delivered_at && (
              <>
                <dt className="text-soft">{p.delivery_status === "PICKED_UP" ? "Retirado" : "Despachado"}</dt>
                <dd>{fmtDateTime(p.delivered_at)} por {p.delivered_by}</dd>
              </>
            )}
            <dt className="text-soft">Wix</dt>
            <dd>
              {siteId ? (
                <a href={`https://manage.wix.com/dashboard/${siteId}/ecom-platform/order-details/${p.external_id}`} target="_blank" rel="noreferrer" className="text-rose-deep hover:underline">
                  Ver en el panel de Wix ↗
                </a>
              ) : (
                <span className="font-mono text-xs">{p.external_id}</span>
              )}
            </dd>
          </dl>
          <form action={actualizarPedidoDesdeWix} className="mt-2">
            <input type="hidden" name="id" value={p.id} />
            <SubmitButton className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-blush-50">Actualizar desde Wix</SubmitButton>
          </form>
        </Card>
      </div>

      {puedeEntregar && (
        <Card className="mt-3 border-emerald-200 bg-emerald-50">
          <p className="text-sm">
            <b className="text-emerald-900">Armado y listo.</b> Cuando salga del local, marcalo:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(esRetiro ? (["PICKED_UP", "DISPATCHED"] as const) : (["DISPATCHED", "PICKED_UP"] as const)).map((e, i) => (
              <form key={e} action={marcarEntregaPedido}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="entrega" value={e} />
                <SubmitButton
                  confirmar={e === "DISPATCHED" ? "¿Confirmás que el pedido salió (despachado)?" : "¿Confirmás que la clienta lo retiró?"}
                  className={
                    i === 0
                      ? "rounded-lg bg-rose-deep px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper"
                      : "rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium hover:bg-blush-50"
                  }
                >
                  {e === "DISPATCHED" ? "🚚 Marcar como despachado" : "🏬 Marcar como retirado"}
                </SubmitButton>
              </form>
            ))}
            {panelReembolso}
          </div>
          <p className="mt-2 text-xs text-soft">
            Despachado: salió por Correo Argentino, moto o se llevó a algún lugar. Retirado: la clienta lo pasó a buscar por el local.
          </p>
        </Card>
      )}
      {!puedeEntregar && puedeReembolsar && <Card className="mt-3">{panelReembolso}</Card>}
      {p.delivery_status && puedeRevisar && p.channel_type !== "POS" && (
        <form action={marcarEntregaPedido} className="mt-2">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="entrega" value="deshacer" />
          <SubmitButton className="text-xs text-soft underline hover:text-ink">
            Deshacer {p.delivery_status === "PICKED_UP" ? "retirado" : "despachado"} (marcado por error)
          </SubmitButton>
        </form>
      )}

      <form action={procesarPedido}>
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="batch" value={randomUUID()} />
        <Card className="mt-3">
          <h2 className="mb-2 font-semibold">Productos</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>SKU Wix</th>
                  <th className={th}>Producto</th>
                  <th className={th}>Cant.</th>
                  <th className={th}>Descuenta</th>
                  <th className={th}>Disponible</th>
                  <th className={th}>Estado</th>
                  {puedeProcesar && <th className={th}>Armo ahora</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const pend = pendientesItem(it);
                  const hist = porItem.get(it.id) ?? [];
                  return (
                    <tr key={it.id} className="border-b border-blush-100 align-top">
                      <td className={`${td} font-mono text-xs`}>{it.external_sku ?? "—"}</td>
                      <td className={td}>{it.name ?? "—"}</td>
                      <td className={`${td} font-semibold`}>{fmtQty(it.quantity)}</td>
                      <td className={`${td} text-xs`}>
                        {it.resolved
                          ? it.reservations.map((rv) => (
                              <div key={rv.id}>
                                {fmtQty(rv.quantity)} × {rv.product.name} <span className="text-soft">({rv.product.sku}{rv.sale_type === "WHOLESALE_SALE" ? " · mayorista" : ""})</span>
                              </div>
                            ))
                          : <span className="font-medium text-amber-800">{it.note ?? "Sin equivalencia"} · <Link href="/equivalencias" className="text-rose-deep hover:underline">cargar</Link></span>}
                        {it.resolved && it.reservations.length === 0 && <span className="text-soft">(vendido directo)</span>}
                      </td>
                      <td className={`${td} text-xs`}>
                        {it.reservations.map((rv) => {
                          const d = disp.get(rv.product.id);
                          const falta = d && d.available < 0;
                          return (
                            <div key={rv.id} className={falta ? "font-medium text-red-700" : ""}>
                              {d ? `${fmtQty(d.sellable)} (reserv. ${fmtQty(d.reserved)})` : "0"}
                            </div>
                          );
                        })}
                      </td>
                      <td className={`${td} text-xs`}>
                        {it.reservations.length > 0 && (
                          <div>
                            {pend > 0 ? <span className="font-medium text-amber-800">{fmtQty(pend)} pendiente(s)</span> : <span className="text-emerald-800">completo</span>}
                          </div>
                        )}
                        {hist.map((f) => (
                          <div key={f.id} className="text-soft">
                            {fmtQty(f.quantity)} · {f.actor} · {fmtDateTime(f.created_at)} {f.wix_synced ? "✓ Wix" : <span className="text-amber-800">(Wix pendiente)</span>}
                          </div>
                        ))}
                        {it.reservations.filter((rv) => Number(rv.to_return) > 0).map((rv) => (
                          <div key={rv.id} className="font-medium text-red-700">
                            Sacar del paquete: {fmtQty(rv.to_return)} {rv.product.name}
                          </div>
                        ))}
                        {(reembolsosPorItem.get(it.id) ?? []).map((x) => (
                          <div key={x.id} className="font-medium text-red-700">
                            Reembolso {fmtQty(x.quantity)} · {x.returned ? "volvió al Depósito" : "no volvió"} · {x.actor} · {fmtDateTime(x.created_at)}
                          </div>
                        ))}
                        {it.note && it.resolved && <div className="text-amber-800">{it.note}</div>}
                      </td>
                      {puedeProcesar && (
                        <td className={td}>
                          {pend > 0 && (
                            <input type="number" name={`item_${it.id}`} min={0} max={pend} step="1" defaultValue={pend} className={`${input} w-24`} />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {puedeProcesar && aSacar.length > 0 && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
              <input type="hidden" name="devoluciones" value="1" />
              <b className="text-red-800">El pedido se editó en Wix: sacá del paquete</b>
              <ul className="mt-1 list-disc pl-5">
                {aSacar.map(({ rv }) => (
                  <li key={rv.id}>
                    {fmtQty(rv.to_return)} × {rv.product.name}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-red-800">Al marcar como procesado, esas unidades vuelven al stock del Depósito.</p>
            </div>
          )}
          {puedeProcesar && llevaSeguimiento && (
            <label className="mt-4 block max-w-md text-sm">
              <span className="font-medium">N° de seguimiento de Correo Argentino</span>
              <span className="ml-1 text-xs text-soft">(opcional, si ya lo tenés)</span>
              <input name="seguimiento" maxLength={100} defaultValue={p.tracking_number ?? ""} placeholder="ej. 00009056322A888LI42C901" className={`${input} mt-1 font-mono`} />
              <span className="mt-1 block text-xs text-soft">Se manda a Wix al procesar y a la clienta le llega el email con el número. Si no lo tenés, lo cargás después en este pedido.</span>
            </label>
          )}
          {puedeProcesar && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <SubmitButton className="rounded-lg bg-rose-deep px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
                Marcar como procesado (armado)
              </SubmitButton>
              <span className="text-xs text-soft">
                Sale del stock con tu usuario. Si armás solo una parte, bajá las cantidades: el resto sigue reservado. Después lo
                marcás como despachado o retirado.
              </span>
            </div>
          )}
        </Card>
      </form>
    </div>
  );
}
