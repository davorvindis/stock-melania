import Link from "next/link";
import { requireSection, can } from "@/lib/auth";
import { getLocations, getProducts, getSuppliers } from "@/lib/queries";
import { ESTADOS_ABIERTOS, ESTADOS_OC, estadoOcClass, getIngresosDeOrden, getOrden } from "@/lib/compras";
import { eliminarEnvio, eliminarOrden, marcarEnvioEntregado, registrarEnvio } from "@/lib/compras-actions";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { OrdenForm } from "@/components/orden-form";

export const dynamic = "force-dynamic";

export default async function DetalleOrden({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireSection("compras");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const orden = /^[0-9a-f-]{36}$/i.test(id) ? await getOrden(id) : null;
  if (!orden) {
    return (
      <div>
        <PageTitle>Orden inexistente</PageTitle>
        <Link href="/compras" className="text-rose-deep hover:underline">
          ← Volver a órdenes de compra
        </Link>
      </div>
    );
  }
  const [ingresos, proveedores, productos, ubicaciones] = await Promise.all([
    getIngresosDeOrden(id),
    getSuppliers(),
    getProducts(),
    getLocations(),
  ]);
  // lugares sugeridos para los envíos: ubicaciones propias + proveedores
  const lugares = [...new Set([...ubicaciones.map((u) => u.name), ...proveedores.filter((p) => p.active).map((p) => p.name)])];
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const ultimoDestino = orden.shipments[orden.shipments.length - 1]?.to_place;
  const totalFletes = orden.shipments.reduce((s, e) => s + (Number(e.freight_cost) || 0), 0);
  const opciones = productos
    .filter((p) => p.active && p.type !== "KIT")
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.sku}` }));
  const total = orden.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
  const abierta = ESTADOS_ABIERTOS.includes(orden.status);
  const sinProducto = orden.lines.filter((l) => !l.product_id).length;

  return (
    <div className="max-w-4xl">
      <div className="mb-1 text-sm">
        <Link href="/compras" className="text-soft hover:text-rose-deep">
          ← Órdenes de compra
        </Link>
      </div>
      <PageTitle>Orden a {orden.supplier.name}</PageTitle>
      <Flash ok={ok} error={error} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-3 py-1 font-medium ${estadoOcClass(orden.status)}`}>
          {ESTADOS_OC[orden.status]}
        </span>
        <span className="text-soft">
          Pedida el {fmtDate(orden.order_date)}
          {orden.expected_date ? ` · entrega estimada ${fmtDate(orden.expected_date)}` : ""}
          {" · "}
          {orden.paid_pct == null ? "pago sin dato" : orden.paid_pct >= 100 ? "pagada" : `pagado ${fmtQty(orden.paid_pct)}%`}
          {total > 0 ? ` · total ${fmtMoney(total)}` : ""}
          {orden.created_by ? ` · cargó ${orden.created_by}` : ""}
        </span>
      </div>

      {abierta && can(user, "ingresos") && (
        <Card className="mb-4 border-blush">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">¿Llegó la mercadería?</h2>
              <p className="text-sm text-soft">
                Registrá el ingreso: se precarga con lo que falta recibir y la orden se actualiza sola.
                {sinProducto > 0 &&
                  ` ${sinProducto} ítem(s) no tienen producto del sistema: vinculalos abajo (Editar orden) para poder sumarlos al stock.`}
              </p>
            </div>
            <Link
              href={`/ingresos/nuevo?oc=${orden.id}`}
              className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper"
            >
              Recibir mercadería →
            </Link>
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold">Ítems</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Descripción</th>
                <th className={th}>Producto del sistema</th>
                <th className={th}>Tipo</th>
                <th className={th}>Pedido</th>
                <th className={th}>Recibido</th>
                <th className={th}>Costo unit.</th>
              </tr>
            </thead>
            <tbody>
              {orden.lines.map((l) => {
                const completo = l.quantity != null && Number(l.received_qty) >= Number(l.quantity);
                return (
                  <tr key={l.id} className="border-b border-blush-100">
                    <td className={td}>{l.description}</td>
                    <td className={`${td} text-soft`}>{l.product?.name ?? "—"}</td>
                    <td className={td}>{l.kind ?? "—"}</td>
                    <td className={td}>{l.quantity != null ? `${fmtQty(l.quantity)} ${l.unit ?? ""}` : "—"}</td>
                    <td className={`${td} ${completo ? "font-medium text-emerald-700" : ""}`}>
                      {Number(l.received_qty) ? fmtQty(l.received_qty) : "—"}
                    </td>
                    <td className={td}>{fmtMoney(l.unit_cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {orden.notes && <p className="mt-3 text-sm text-soft">Notas: {orden.notes}</p>}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold">Seguimiento de envíos</h2>
        <p className="mb-3 text-sm text-soft">
          Cada tramo de la mercadería: del proveedor a quien lo envasa, y de ahí al depósito. Es solo
          seguimiento: el stock entra cuando registrás el ingreso.
        </p>
        {orden.shipments.length > 0 ? (
          <ol className="mb-4 space-y-3 border-l-2 border-blush pl-4">
            {orden.shipments.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white ${
                    e.status === "ENTREGADO" ? "bg-emerald-600" : "bg-amber-500"
                  }`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {e.from_place} → {e.to_place}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      e.status === "ENTREGADO" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {e.status === "ENTREGADO" ? `Entregado ${fmtDate(e.delivered_date)}` : "En camino"}
                  </span>
                </div>
                <div className="text-sm text-soft">
                  Salió el {fmtDate(e.ship_date)}
                  {e.description ? ` · ${e.description}` : ""}
                  {e.carrier ? ` · flete: ${e.carrier}` : ""}
                  {e.freight_cost != null ? ` · ${fmtMoney(e.freight_cost)}` : ""}
                  {e.created_by ? ` · cargó ${e.created_by}` : ""}
                </div>
                {e.notes && <div className="text-sm text-soft">{e.notes}</div>}
                <div className="mt-1 flex flex-wrap gap-3">
                  {e.status === "EN_CAMINO" && (
                    <form action={marcarEnvioEntregado} className="flex items-center gap-2">
                      <input type="hidden" name="envio" value={e.id} />
                      <input type="hidden" name="orden" value={orden.id} />
                      <input type="date" name="fecha_entrega" defaultValue={hoy} aria-label="Fecha de entrega" className="rounded-lg border border-line px-2 py-1 text-xs" />
                      <SubmitButton className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800">
                        Marcar entregado
                      </SubmitButton>
                    </form>
                  )}
                  <form action={eliminarEnvio}>
                    <input type="hidden" name="envio" value={e.id} />
                    <input type="hidden" name="orden" value={orden.id} />
                    <SubmitButton className="px-1 py-1 text-xs text-soft hover:text-red-700">Eliminar</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mb-4 text-sm text-soft">Todavía no se registró ningún envío.</p>
        )}
        {totalFletes > 0 && <p className="mb-3 text-sm">Fletes de esta orden: <b>{fmtMoney(totalFletes)}</b></p>}

        <details open={orden.shipments.length === 0 && abierta}>
          <summary className="cursor-pointer text-sm font-semibold text-rose-deep">+ Registrar envío</summary>
          <form action={registrarEnvio} className="mt-3 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="orden" value={orden.id} />
            <datalist id="lugares">
              {lugares.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            <div>
              <label className={label}>Fecha de salida *</label>
              <input type="date" name="fecha" required defaultValue={hoy} className={input} />
            </div>
            <div>
              <label className={label}>Desde *</label>
              <input type="text" name="desde" required list="lugares" defaultValue={ultimoDestino ?? orden.supplier.name} className={input} />
            </div>
            <div>
              <label className={label}>Hacia *</label>
              <input type="text" name="hacia" required list="lugares" placeholder="ej. One Pack, Depósito" className={input} />
            </div>
            <div>
              <label className={label}>Qué se envía</label>
              <input type="text" name="que" placeholder="ej. 120kg granel pro lash botox" className={input} />
            </div>
            <div>
              <label className={label}>Flete / transportista</label>
              <input type="text" name="flete" className={input} />
            </div>
            <div>
              <label className={label}>Costo del flete ($)</label>
              <input type="number" name="costo_flete" min="0" step="0.01" className={input} />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>Notas</label>
              <input type="text" name="notas" placeholder="ej. lo envasan en monodosis blister x 4" className={input} />
            </div>
            <div className="sm:col-span-3">
              <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
                Registrar envío
              </SubmitButton>
            </div>
          </form>
        </details>
      </Card>

      {ingresos.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-2 font-semibold">Ingresos de esta orden</h2>
          <ul className="space-y-1 text-sm">
            {ingresos.map((e) => (
              <li key={e.id}>
                {fmtDate(e.entry_date)}
                {e.remito ? ` · remito ${e.remito}` : ""}
                {e.invoice ? ` · factura ${e.invoice}` : ""}
                {e.actor ? ` · cargó ${e.actor}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-4">
        <details>
          <summary className="cursor-pointer font-semibold text-rose-deep">Editar orden</summary>
          <div className="mt-4">
            <OrdenForm orden={orden} proveedores={proveedores} productos={opciones} />
          </div>
        </details>
      </Card>

      {ingresos.length === 0 && (
        <Card className="border-red-200">
          <details>
            <summary className="cursor-pointer font-semibold text-red-800">Eliminar orden</summary>
            <p className="mb-3 mt-2 text-sm text-soft">
              Solo si se cargó por error. Si la orden se cayó, mejor cambiá el estado a Cancelada.
            </p>
            <form action={eliminarOrden}>
              <input type="hidden" name="orden" value={orden.id} />
              <SubmitButton className="rounded-lg bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-800">
                Eliminar definitivamente
              </SubmitButton>
            </form>
          </details>
        </Card>
      )}
    </div>
  );
}
