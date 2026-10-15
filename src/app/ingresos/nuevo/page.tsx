import { SubmitButton } from "@/components/submit-button";
import { requireSection, ubicacionFija, can } from "@/lib/auth";
import Link from "next/link";
import { getOrden } from "@/lib/compras";
import { randomUUID } from "crypto";
import { getProducts, getLocations, getSuppliers } from "@/lib/queries";
import { registrarIngreso } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";
import { LineasIngreso, type LineaInicial } from "@/components/lineas-ingreso";
import { ArchivoComprobante } from "@/components/archivo-comprobante";
import { getHistorialIngresos } from "@/lib/comprobantes";
import { adjuntarComprobante } from "@/lib/actions";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NuevoIngreso({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; oc?: string; q?: string; n?: string }>;
}) {
  const user = await requireSection("ingresos");
  const { ok, error, oc, q, n } = await searchParams;
  const limite = Math.min(Math.max(parseInt(n ?? "20", 10) || 20, 20), 500);
  const { ingresos, total: totalIngresos } = await getHistorialIngresos(q, limite);
  // recibir una orden de compra: precarga proveedor y lo que falta recibir
  const orden =
    oc && can(user, "compras") && /^[0-9a-f-]{36}$/i.test(oc) ? await getOrden(oc) : null;
  const inicial: LineaInicial[] = (orden?.lines ?? [])
    .map((l) => ({ l, falta: l.quantity ? Number(l.quantity) - Number(l.received_qty) : 0 }))
    .filter(({ l, falta }) => !l.quantity || falta > 0)
    .map(({ l, falta }) => ({
      producto: l.product_id ?? "",
      cantidad: falta > 0 ? String(falta) : "",
      costo: l.unit_cost != null ? String(l.unit_cost) : "",
      ocLinea: l.id,
      detalle: `${l.description}${l.kind ? ` (${l.kind})` : ""}${l.quantity ? ` · pedidas ${l.quantity}, recibidas ${l.received_qty}` : ""}`,
    }));
  const [products, locations, suppliers] = await Promise.all([
    getProducts(),
    getLocations(),
    getSuppliers(),
  ]);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const opcionesProductos = products
    .filter((p) => p.active && p.type !== "KIT")
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.sku} · ${p.unit}` }));

  return (
    <div className="max-w-3xl">
      <PageTitle>Nuevo ingreso de stock</PageTitle>
      <Flash ok={ok} error={error} />
      {orden && (
        <p className="mb-3 rounded-lg border border-blush-100 bg-white px-3 py-2 text-sm">
          Recibiendo la orden de compra a <b>{orden.supplier.name}</b> del {orden.order_date.split("-").reverse().join("/")}.
          Ajustá las cantidades a lo que llegó realmente y quitá lo que no vino.{" "}
          <Link href={`/compras/${orden.id}`} className="font-medium text-rose-deep hover:underline">
            Ver orden
          </Link>
        </p>
      )}
      <Card>
        <form action={registrarIngreso} className="space-y-4">
          <input type="hidden" name="idem" value={randomUUID()} />
          {orden && <input type="hidden" name="oc" value={orden.id} />}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Fecha de ingreso *</label>
              <input type="date" name="fecha" defaultValue={hoy} required className={input} />
            </div>

            <div>
              <label className={label}>N° remito</label>
              <input type="text" name="remito" className={input} />
            </div>
            <div>
              <label className={label}>N° factura</label>
              <input type="text" name="factura" className={input} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Proveedor</label>
              <select name="proveedor" defaultValue={orden?.supplier.id ?? ""} className={input}>
                <option value="">Sin proveedor</option>
                {suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className={label}>Ubicación destino *</label>
              <select name="ubicacion" required defaultValue={user.location_id ?? ""} className={input}>
                <option value="">Elegir ubicación…</option>
                {locations
                  .filter((l) => !ubicacionFija(user) || l.id === ubicacionFija(user))
                  .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>Productos *</label>
            <LineasIngreso productos={opcionesProductos} inicial={inicial} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ArchivoComprobante name="remito_foto" label="Foto del remito" />
            <ArchivoComprobante name="factura_foto" label="Foto de la factura" />
          </div>

          <div>
            <label className={label}>Observaciones</label>
            <textarea name="notas" rows={2} className={input} />
          </div>

          <SubmitButton className={`${button} w-full sm:w-auto`}>
            Confirmar ingreso
          </SubmitButton>
        </form>
      </Card>

      <h2 id="historial" className="mb-2 mt-8 font-display text-2xl tracking-wide">Historial de ingresos</h2>
      <form method="get" action="/ingresos/nuevo#historial" className="mb-3 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar producto, proveedor, N° de remito o factura, lote…"
          className={input}
        />
        <button type="submit" className="shrink-0 rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
          Buscar
        </button>
      </form>
      <p className="mb-3 text-sm text-soft">
        {q ? `${totalIngresos} ingreso(s) con “${q}”` : `${totalIngresos} ingreso(s) en total`}
        {q && (
          <>
            {" · "}
            <a href="/ingresos/nuevo#historial" className="font-medium text-rose-deep hover:underline">
              Limpiar
            </a>
          </>
        )}
      </p>
      <div className="space-y-2">
        {ingresos.map((e) => (
          <details key={e.id} className="rounded-xl border border-line bg-white p-3">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <b>{fmtDate(e.entry_date)}</b>
                  <span className="text-sm text-soft">
                    {" · "}
                    {e.supplier?.name ?? "sin proveedor"}
                    {e.remito ? ` · remito ${e.remito}` : ""}
                    {e.invoice ? ` · factura ${e.invoice}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {e.remito_path && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">remito ✓</span>}
                  {e.invoice_path && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">factura ✓</span>}
                  <span className="text-soft">{e.lines.length} producto(s) ▾</span>
                </span>
              </div>
              <div className="mt-0.5 truncate text-sm">
                {e.lines.slice(0, 3).map((l) => `${fmtQty(l.quantity)} × ${l.product.name}`).join(" · ")}
                {e.lines.length > 3 ? ` · y ${e.lines.length - 3} más` : ""}
              </div>
            </summary>
            <div className="mt-3 border-t border-blush-100 pt-2">
              <ul className="divide-y divide-blush-100 text-sm">
                {e.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span>
                      {l.product.name}
                      <span className="text-soft">
                        {l.lot ? ` · lote ${l.lot.code}` : ""}
                        {l.lot?.expires_on ? ` · vence ${fmtDate(l.lot.expires_on)}` : ""}
                        {` · ${l.location.name}`}
                      </span>
                    </span>
                    <span className="font-medium">
                      {fmtQty(l.quantity)} {l.product.unit}
                      {l.unit_cost != null && <span className="font-normal text-soft"> · {fmtMoney(l.unit_cost)} c/u</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {e.notes && <p className="mt-2 text-sm text-soft">📝 {e.notes}</p>}
              <p className="mt-1 text-xs text-soft">
                Cargó {e.actor ?? "—"} · {fmtDateTime(e.created_at)}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(["remito", "factura"] as const).map((tipo) => {
                  const path = tipo === "remito" ? e.remito_path : e.invoice_path;
                  return (
                    <div key={tipo} className="rounded-lg bg-blush-50 p-2 text-sm">
                      {path ? (
                        <a href={`/api/comprobantes/${e.id}?tipo=${tipo}`} target="_blank" className="font-medium text-rose-deep hover:underline">
                          Ver {tipo} →
                        </a>
                      ) : (
                        <span className="text-soft">Sin foto del {tipo}</span>
                      )}
                      <form action={adjuntarComprobante} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="ingreso" value={e.id} />
                        <input type="hidden" name="tipo" value={tipo} />
                        <div className="min-w-0 flex-1">
                          <ArchivoComprobante name="archivo" required />
                        </div>
                        <SubmitButton className="rounded-lg bg-rose-deep px-3 py-1 text-xs font-semibold text-white">
                          {path ? "Reemplazar" : "Adjuntar"}
                        </SubmitButton>
                      </form>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
        ))}
        {ingresos.length === 0 && (
          <Card>
            <p className="text-sm text-soft">{q ? "Ningún ingreso coincide con la búsqueda." : "Todavía no hay ingresos."}</p>
          </Card>
        )}
      </div>
      {totalIngresos > ingresos.length && (
        <a
          href={`/ingresos/nuevo?${new URLSearchParams({ ...(q ? { q } : {}), n: String(limite + 20) }).toString()}#historial`}
          className="mt-3 inline-block rounded-lg border border-line bg-white px-4 py-2 text-sm text-rose-deep hover:border-blush"
        >
          Ver más ingresos
        </a>
      )}
    </div>
  );
}
