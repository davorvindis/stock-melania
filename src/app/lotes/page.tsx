import Link from "next/link";
import { randomUUID } from "crypto";
import { requireSection } from "@/lib/auth";
import { getBalances, getLocations, getLots, getProducts } from "@/lib/queries";
import { crearLote } from "@/lib/actions";
import { LOT_STATUS_LABELS, fmtDate, fmtQty, lotBadgeClass } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { AsignarLoteForm, type ProductoConStock } from "@/components/asignar-lote-form";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; q?: string; estado?: string; stock?: string; producto?: string };

export default async function Lotes({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireSection("lotes");
  const puedeAsignar = user.role === "ADMIN" || user.role === "MANAGER";
  const sp = await searchParams;
  const [todosLotes, balances, productos, ubicaciones] = await Promise.all([
    getLots(),
    getBalances(),
    getProducts(),
    getLocations(),
  ]);

  // stock restante por lote
  const stockPorLote = new Map<string, number>();
  for (const b of balances) {
    if (b.lot) stockPorLote.set(b.lot.id, (stockPorLote.get(b.lot.id) ?? 0) + Number(b.quantity));
  }

  // productos con stock, con sus renglones y lotes conocidos (para asignar)
  const tipoPorId = new Map(productos.map((p) => [p.id, p.type]));
  const porProducto = new Map<string, ProductoConStock>();
  for (const b of balances) {
    if (tipoPorId.get(b.product.id) === "KIT") continue;
    let p = porProducto.get(b.product.id);
    if (!p) {
      p = { id: b.product.id, sku: b.product.sku, name: b.product.name, unit: b.product.unit, filas: [], lotes: [] };
      porProducto.set(b.product.id, p);
    }
    p.filas.push({
      lotId: b.lot?.id ?? null,
      lotCode: b.lot?.code ?? null,
      locationId: b.location.id,
      locationName: b.location.name,
      qty: Number(b.quantity),
    });
  }
  for (const l of todosLotes) {
    porProducto.get(l.product.id)?.lotes.push({ code: l.code, expires_on: l.expires_on });
  }
  const conStock = [...porProducto.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  for (const p of conStock) {
    p.filas.sort((a, b) => Number(!!a.lotId) - Number(!!b.lotId) || a.locationName.localeCompare(b.locationName, "es"));
  }
  const pendientes = conStock.filter((p) => p.filas.some((f) => !f.lotId));
  const unidadesSinLote = pendientes.reduce(
    (s, p) => s + p.filas.filter((f) => !f.lotId).reduce((t, f) => t + f.qty, 0),
    0
  );

  let lots = todosLotes;
  if (sp.q) {
    const needle = sp.q.toLowerCase();
    lots = lots.filter(
      (l) =>
        l.code.toLowerCase().includes(needle) ||
        l.product.name.toLowerCase().includes(needle) ||
        l.product.sku.toLowerCase().includes(needle)
    );
  }
  if (sp.estado) lots = lots.filter((l) => l.status === sp.estado);
  if (sp.stock === "con") lots = lots.filter((l) => (stockPorLote.get(l.id) ?? 0) > 0);
  if (sp.stock === "sin") lots = lots.filter((l) => !(stockPorLote.get(l.id) ?? 0));

  const vendibles = productos.filter((p) => p.active && p.type !== "KIT");

  return (
    <div className="max-w-5xl">
      <PageTitle>Lotes</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />

      {pendientes.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>{pendientes.length} producto(s)</b> tienen stock sin lote ({fmtQty(unidadesSinLote)} unidades).
          {puedeAsignar && " Asignales su lote y vencimiento acá abajo."}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {puedeAsignar && (
          <Card>
            <h2 className="mb-1 font-semibold">Asignar lote a stock existente</h2>
            <p className="mb-3 text-sm text-soft">
              Para productos que ya tenés: elegí el producto y ponele número de lote y vencimiento a
              todo su stock sin lote, o a una parte.
            </p>
            <AsignarLoteForm productos={conStock} idem={randomUUID()} inicial={sp.producto} />
          </Card>
        )}

        <Card>
          <h2 className="mb-1 font-semibold">Nuevo lote</h2>
          <p className="mb-3 text-sm text-soft">
            Entró un lote nuevo: con cantidad se registra como ingreso y se suma al stock del
            producto. Sin cantidad, solo se da de alta el lote.
          </p>
          <form action={crearLote} className="space-y-3">
            <input type="hidden" name="idem" value={randomUUID()} />
            <div>
              <label className={label}>Producto *</label>
              <select name="producto" required defaultValue={sp.producto ?? ""} className={input}>
                <option value="">Elegir producto…</option>
                {vendibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>N° de lote *</label>
                <input type="text" name="lote" required className={input} />
              </div>
              <div>
                <label className={label}>Vencimiento</label>
                <input type="date" name="vencimiento" className={input} />
              </div>
              <div>
                <label className={label}>Cantidad</label>
                <input type="number" name="cantidad" min="0" step="any" placeholder="0" className={input} />
              </div>
              <div>
                <label className={label}>Ubicación</label>
                <select name="ubicacion" className={input}>
                  <option value="">Elegir…</option>
                  {ubicaciones.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <SubmitButton className={button}>Crear lote</SubmitButton>
          </form>
        </Card>
      </div>

      <form method="get" className="mb-3 grid gap-2 sm:grid-cols-4">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar por lote, producto o SKU…"
          className={`${input} sm:col-span-2`}
        />
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado" className={input}>
          <option value="">Todos los estados</option>
          {Object.entries(LOT_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="stock" defaultValue={sp.stock ?? ""} aria-label="Stock" className={input}>
            <option value="">Con y sin stock</option>
            <option value="con">Con stock</option>
            <option value="sin">Agotados</option>
          </select>
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
          >
            Filtrar
          </button>
        </div>
      </form>
      <p className="mb-3 text-sm text-soft">
        {lots.length} lote(s)
        {(sp.q || sp.estado || sp.stock) && (
          <>
            {" · "}
            <Link href="/lotes" className="font-medium text-rose-deep hover:underline">
              Limpiar filtros
            </Link>
          </>
        )}
      </p>

      <div className="grid gap-2 md:grid-cols-2">
        {lots.map((l) => {
          const restante = stockPorLote.get(l.id) ?? 0;
          return (
            <Link
              key={l.id}
              href={`/lotes/${l.id}`}
              className="block rounded-lg border border-blush-100 bg-white p-3 hover:border-blush"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">
                  {l.code} <span className="font-normal text-soft">· {l.product.name}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${lotBadgeClass(l.status)}`}>
                  {LOT_STATUS_LABELS[l.status]}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2 text-xs text-soft">
                <span>
                  {l.product.sku}
                  {l.expires_on ? ` · vence ${fmtDate(l.expires_on)}` : " · sin vencimiento"}
                </span>
                <span className={restante > 0 ? "font-semibold text-ink" : ""}>
                  {restante > 0 ? `${fmtQty(restante)} ${l.product.unit}` : "Agotado"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      {lots.length === 0 && (
        <Card>
          <p className="text-sm text-soft">
            {sp.q || sp.estado || sp.stock ? "Ningún lote coincide con la búsqueda." : "Todavía no hay lotes registrados."}
          </p>
        </Card>
      )}
    </div>
  );
}
