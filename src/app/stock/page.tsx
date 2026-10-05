import { requireSection } from "@/lib/auth";
import Link from "next/link";
import { getBalances, getLocations, getProducts, isAvailable, type BalanceRow } from "@/lib/queries";
import { ajustarStock } from "@/lib/actions";
import { LOT_STATUS_LABELS, fmtQty, fmtDate } from "@/lib/types";
import { Card, Flash, PageTitle, SortTh, cmp, td, th, input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

// ajuste directo: fija la cantidad real; la diferencia queda como movimiento de ajuste
function AjusteForm({ b, compact = false }: { b: BalanceRow; compact?: boolean }) {
  return (
    <details className={compact ? "mt-2" : ""}>
      <summary className="cursor-pointer py-1 text-xs font-medium text-rose-deep hover:underline">
        Ajustar
      </summary>
      <form
        action={ajustarStock}
        className={compact ? "mt-2 space-y-2" : "mt-2 flex flex-wrap items-center gap-2"}
      >
        <input type="hidden" name="renglon" value={`${b.product.id}|${b.lot?.id ?? ""}|${b.location.id}`} />
        <input
          type="number"
          name="cantidad_nueva"
          min="0"
          step="any"
          defaultValue={Number(b.quantity)}
          required
          aria-label="Cantidad real"
          className={`rounded-lg border border-line px-3 py-2 text-sm ${compact ? "w-full" : "w-24"}`}
        />
        <input
          type="text"
          name="motivo"
          placeholder="Motivo del ajuste"
          required
          className={`rounded-lg border border-line px-3 py-2 text-sm ${compact ? "w-full" : "w-44"}`}
        />
        <SubmitButton
          className={`rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white ${compact ? "w-full" : ""}`}
        >
          Confirmar
        </SubmitButton>
      </form>
    </details>
  );
}

type Ubicacion = { id: string; name: string };

// producto en 0: no tiene renglón, así que el ajuste pide la ubicación
function AjusteSinStock({ productId, ubicaciones }: { productId: string; ubicaciones: Ubicacion[] }) {
  return (
    <details>
      <summary className="cursor-pointer py-1 text-xs font-medium text-rose-deep hover:underline">
        Cargar cantidad
      </summary>
      <form action={ajustarStock} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="renglon" value={`${productId}||`} />
        <input
          type="number"
          name="cantidad_nueva"
          min="0.001"
          step="any"
          required
          placeholder="Cantidad"
          aria-label="Cantidad real"
          className="w-28 rounded-lg border border-line px-3 py-2 text-sm"
        />
        <select
          name="ubicacion"
          required
          aria-label="Ubicación"
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
        >
          <option value="">Ubicación…</option>
          {ubicaciones.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="motivo"
          placeholder="Motivo del ajuste"
          required
          className="w-44 rounded-lg border border-line px-3 py-2 text-sm"
        />
        <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white">
          Confirmar
        </SubmitButton>
      </form>
    </details>
  );
}

function LotBadge({ b }: { b: BalanceRow }) {
  if (!b.lot) return <span>—</span>;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        b.lot.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {LOT_STATUS_LABELS[b.lot.status]}
    </span>
  );
}

function LotesChips({
  lotes,
  asignarHref,
}: {
  lotes: { code: string | null; qty: number; vence: string | null }[];
  asignarHref?: string;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {lotes.map((l) => (
        <span
          key={l.code ?? "sin"}
          className={`rounded-full px-2 py-0.5 text-xs ${l.code ? "bg-blush-100 text-rose-deeper" : "bg-amber-50 text-amber-800"}`}
          title={l.vence ? `Vence ${fmtDate(l.vence)}` : undefined}
        >
          {l.code ?? "Sin lote"}: <b>{fmtQty(l.qty)}</b>
          {l.vence ? ` · ${fmtDate(l.vence)}` : ""}
        </span>
      ))}
      {asignarHref && lotes.some((l) => !l.code) && (
        <Link href={asignarHref} className="text-xs font-medium text-rose-deep hover:underline">
          Asignar lote →
        </Link>
      )}
    </div>
  );
}

// desglose por lote y ubicación dentro de la vista por producto
function DetalleFilas({ filas, puedeAjustar }: { filas: BalanceRow[]; puedeAjustar: boolean }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs font-medium text-rose-deep hover:underline">
        Ver detalle ({filas.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {filas.map((b) => (
          <li key={b.id} className="rounded-lg bg-blush-50 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {b.lot ? `Lote ${b.lot.code}` : "Sin lote"} · {b.location.name}
                {b.location.is_quarantine ? " ⚠" : ""} <LotBadge b={b} />
              </span>
              <span className="font-semibold">{fmtQty(b.quantity)}</span>
            </div>
            {puedeAjustar && <AjusteForm b={b} compact />}
          </li>
        ))}
      </ul>
    </details>
  );
}

type SP = {
  ok?: string;
  error?: string;
  q?: string;
  ubicacion?: string;
  disp?: string;
  lote?: string;
  vista?: string;
  sort?: string;
  dir?: string;
};

export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireSection("stock");
  const puedeAjustar = user.role === "ADMIN" || user.role === "MANAGER";
  const sp = await searchParams;
  const [balances, locations, productos] = await Promise.all([getBalances(), getLocations(), getProducts()]);

  // productos activos sin stock en ninguna ubicación (no tienen renglón en balances)
  const conStock = new Set(balances.map((b) => b.product.id));
  let sinStock = productos.filter((p) => p.active && !conStock.has(p.id));
  if (sp.q) {
    const needle = sp.q.toLowerCase();
    sinStock = sinStock.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle)
    );
  }
  const mostrarSinStock = (!sp.disp || sp.disp === "cero") && !sp.lote;

  let rows = balances;
  if (sp.q) {
    const needle = sp.q.toLowerCase();
    rows = rows.filter(
      (b) =>
        b.product.name.toLowerCase().includes(needle) ||
        b.product.sku.toLowerCase().includes(needle) ||
        (b.lot?.code ?? "").toLowerCase().includes(needle)
    );
  }
  if (sp.lote) {
    const l = sp.lote.trim().toLowerCase();
    rows = rows.filter((b) => (l === "sin" ? !b.lot : (b.lot?.code ?? "").toLowerCase().includes(l)));
  }
  if (sp.ubicacion) rows = rows.filter((b) => b.location.id === sp.ubicacion);
  if (sp.disp === "si") rows = rows.filter(isAvailable);
  if (sp.disp === "no") rows = rows.filter((b) => !isAvailable(b));
  if (sp.disp === "cero") rows = [];

  const key = (b: BalanceRow, col: string): string | number => {
    switch (col) {
      case "sku":
        return b.product.sku;
      case "producto":
        return b.product.name;
      case "lote":
        return b.lot?.code ?? "";
      case "vence":
        return b.lot?.expires_on ?? "9999";
      case "ubicacion":
        return b.location.name;
      case "cantidad":
        return Number(b.quantity);
      default:
        return 0;
    }
  };
  if (sp.sort) rows = [...rows].sort((a, b) => cmp(key(a, sp.sort!), key(b, sp.sort!), sp.dir));

  const total = rows.reduce((s, b) => s + Number(b.quantity), 0);

  // vista por producto (default): total del producto + desglose por lote
  const porLote = sp.vista === "lote";
  type Grupo = {
    product: BalanceRow["product"];
    total: number;
    disponible: number;
    vence: string | null;
    lotes: Map<string, { code: string | null; qty: number; vence: string | null }>;
    filas: BalanceRow[];
  };
  const grupos = new Map<string, Grupo>();
  for (const b of rows) {
    let g = grupos.get(b.product.id);
    if (!g) {
      g = { product: b.product, total: 0, disponible: 0, vence: null, lotes: new Map(), filas: [] };
      grupos.set(b.product.id, g);
    }
    const q = Number(b.quantity);
    g.total += q;
    if (isAvailable(b)) g.disponible += q;
    const venc = b.lot?.expires_on ?? null;
    if (venc && (!g.vence || venc < g.vence)) g.vence = venc;
    const k = b.lot?.id ?? "";
    const l = g.lotes.get(k) ?? { code: b.lot?.code ?? null, qty: 0, vence: venc };
    l.qty += q;
    g.lotes.set(k, l);
    g.filas.push(b);
  }
  const keyGrupo = (g: Grupo, col: string): string | number => {
    switch (col) {
      case "sku":
        return g.product.sku;
      case "producto":
        return g.product.name;
      case "vence":
        return g.vence ?? "9999";
      case "cantidad":
        return g.total;
      default:
        return 0;
    }
  };
  let listaGrupos = [...grupos.values()];
  listaGrupos = sp.sort
    ? listaGrupos.sort((a, b) => cmp(keyGrupo(a, sp.sort!), keyGrupo(b, sp.sort!), sp.dir))
    : listaGrupos.sort((a, b) => b.total - a.total);
  const lotesOrdenados = (g: Grupo) =>
    [...g.lotes.values()].sort((a, b) => (a.vence ?? "9999").localeCompare(b.vence ?? "9999"));

  const linkVista = (v: string) => {
    const params = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) {
      if (val && !["ok", "error", "vista", "sort", "dir"].includes(k)) params.set(k, val);
    }
    if (v === "lote") params.set("vista", "lote");
    const qs = params.toString();
    return qs ? `/stock?${qs}` : "/stock";
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Stock</PageTitle>
        <a
          href="/api/export/stock"
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
        >
          Descargar Excel
        </a>
      </div>

      <div className="mb-3 inline-flex rounded-lg border border-line bg-white p-1 text-sm">
        <Link
          href={linkVista("producto")}
          className={`rounded-md px-3 py-1.5 font-medium ${!porLote ? "bg-rose-deep text-white" : "text-soft hover:text-ink"}`}
        >
          Por producto
        </Link>
        <Link
          href={linkVista("lote")}
          className={`rounded-md px-3 py-1.5 font-medium ${porLote ? "bg-rose-deep text-white" : "text-soft hover:text-ink"}`}
        >
          Por lote y ubicación
        </Link>
      </div>

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-6">
        {porLote && <input type="hidden" name="vista" value="lote" />}
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar SKU, producto o lote…"
          className={`${input} sm:col-span-2`}
        />
        <input
          type="search"
          name="lote"
          defaultValue={sp.lote ?? ""}
          placeholder="N° de lote (o &quot;sin&quot;)"
          aria-label="Filtrar por lote"
          className={input}
        />
        <select name="ubicacion" defaultValue={sp.ubicacion ?? ""} className={input}>
          <option value="">Todas las ubicaciones</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2 sm:col-span-2">
          <select name="disp" defaultValue={sp.disp ?? ""} className={input}>
            <option value="">Disponible y no disp.</option>
            <option value="si">Solo disponible</option>
            <option value="no">Solo no disponible</option>
            <option value="cero">Solo productos en 0</option>
          </select>
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
          >
            Filtrar
          </button>
        </div>
      </form>

      <Flash ok={sp.ok} error={sp.error} />
      <p className="mb-3 text-sm text-soft">
        {porLote ? `${rows.length} renglón(es)` : `${listaGrupos.length} producto(s)`} · {fmtQty(total)} unidades
        {sp.lote && ` · lote "${sp.lote}"`}
        {mostrarSinStock && sinStock.length > 0 && ` · ${sinStock.length} producto(s) en 0`}
      </p>

      {sp.disp !== "cero" && !porLote && (
        <>
          {/* mobile: tarjetas por producto */}
          <div className="space-y-2 md:hidden">
            {listaGrupos.map((g) => (
              <div key={g.product.id} className="rounded-lg border border-blush-100 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{g.product.name}</div>
                    <div className="font-mono text-xs text-soft">{g.product.sku}</div>
                  </div>
                  <span className="shrink-0 font-display text-3xl leading-none">
                    {fmtQty(g.total)} <span className="font-sans text-xs text-soft">{g.product.unit}</span>
                  </span>
                </div>
                <LotesChips lotes={lotesOrdenados(g)} asignarHref={puedeAjustar ? `/lotes?producto=${g.product.id}` : undefined} />
                {g.disponible !== g.total && (
                  <div className="mt-1 text-xs font-medium text-amber-700">Disponible: {fmtQty(g.disponible)}</div>
                )}
                <DetalleFilas filas={g.filas} puedeAjustar={puedeAjustar} />
              </div>
            ))}
            {listaGrupos.length === 0 && (
              <Card>
                <p className="text-sm text-soft">Nada coincide con la búsqueda o filtros.</p>
              </Card>
            )}
          </div>

          {/* escritorio: tabla por producto */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <SortTh col="sku" sp={sp} path="/stock">SKU</SortTh>
                    <SortTh col="producto" sp={sp} path="/stock">Producto</SortTh>
                    <th className={th}>Lotes</th>
                    <SortTh col="vence" sp={sp} path="/stock">Próx. venc.</SortTh>
                    <SortTh col="cantidad" sp={sp} path="/stock">Total</SortTh>
                    <th className={th}>Disponible</th>
                  </tr>
                </thead>
                <tbody>
                  {listaGrupos.map((g) => (
                    <tr key={g.product.id} className="border-b border-blush-100 align-top">
                      <td className={`${td} font-mono text-xs`}>{g.product.sku}</td>
                      <td className={td}>
                        {g.product.name}
                        <DetalleFilas filas={g.filas} puedeAjustar={puedeAjustar} />
                      </td>
                      <td className={td}>
                        <LotesChips lotes={lotesOrdenados(g)} asignarHref={puedeAjustar ? `/lotes?producto=${g.product.id}` : undefined} />
                      </td>
                      <td className={td}>{fmtDate(g.vence)}</td>
                      <td className={`${td} font-semibold`}>
                        {fmtQty(g.total)} <span className="text-xs text-soft">{g.product.unit}</span>
                      </td>
                      <td className={`${td} ${g.disponible !== g.total ? "font-medium text-amber-700" : ""}`}>
                        {fmtQty(g.disponible)}
                      </td>
                    </tr>
                  ))}
                  {listaGrupos.length === 0 && (
                    <tr>
                      <td className={td} colSpan={6}>
                        Nada coincide con la búsqueda o filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {sp.disp !== "cero" && porLote && (
      <>
      {/* mobile: tarjetas */}
      <div className="space-y-2 md:hidden">
        {rows.map((b) => (
          <div key={b.id} className="rounded-lg border border-blush-100 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{b.product.name}</span>
              <LotBadge b={b} />
            </div>
            <div className="mt-0.5 font-mono text-xs text-soft">{b.product.sku}</div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl leading-none">
                {fmtQty(b.quantity)}{" "}
                <span className="font-sans text-xs text-soft">{b.product.unit}</span>
              </span>
              <span className="text-sm text-soft">
                {b.location.name}
                {b.location.is_quarantine ? " ⚠" : ""}
              </span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-soft">
              <span>
                {b.lot ? `Lote ${b.lot.code}` : "Sin lote"}
                {b.lot?.expires_on ? ` · vence ${fmtDate(b.lot.expires_on)}` : ""}
              </span>
              <span className={isAvailable(b) ? "" : "font-medium text-amber-700"}>
                {isAvailable(b) ? "Disponible" : "No disponible"}
              </span>
            </div>
            {puedeAjustar && <AjusteForm b={b} compact />}
          </div>
        ))}
        {rows.length === 0 && (
          <Card>
            <p className="text-sm text-soft">Nada coincide con la búsqueda o filtros.</p>
          </Card>
        )}
      </div>

      {/* escritorio: tabla ordenable */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <SortTh col="sku" sp={sp} path="/stock">SKU</SortTh>
                <SortTh col="producto" sp={sp} path="/stock">Producto</SortTh>
                <SortTh col="lote" sp={sp} path="/stock">Lote</SortTh>
                <th className={th}>Estado lote</th>
                <SortTh col="vence" sp={sp} path="/stock">Vence</SortTh>
                <SortTh col="ubicacion" sp={sp} path="/stock">Ubicación</SortTh>
                <SortTh col="cantidad" sp={sp} path="/stock">Cantidad</SortTh>
                <th className={th}>Disponible</th>
                {puedeAjustar && <th className={th}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-blush-100">
                  <td className={`${td} font-mono text-xs`}>{b.product.sku}</td>
                  <td className={td}>{b.product.name}</td>
                  <td className={td}>{b.lot?.code ?? "—"}</td>
                  <td className={td}>
                    <LotBadge b={b} />
                  </td>
                  <td className={td}>{fmtDate(b.lot?.expires_on ?? null)}</td>
                  <td className={td}>
                    {b.location.name}
                    {b.location.is_quarantine && (
                      <span className="ml-1 text-xs text-amber-700">(cuarentena)</span>
                    )}
                  </td>
                  <td className={`${td} font-semibold`}>
                    {fmtQty(b.quantity)} <span className="text-xs text-soft">{b.product.unit}</span>
                  </td>
                  <td className={td}>{isAvailable(b) ? "Sí" : "No"}</td>
                  {puedeAjustar && (
                    <td className={td}>
                      <AjusteForm b={b} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={td} colSpan={puedeAjustar ? 9 : 8}>
                    Nada coincide con la búsqueda o filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      )}

      {mostrarSinStock && sinStock.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-1 font-semibold">Productos en 0 ({sinStock.length})</h2>
          <p className="mb-3 text-sm text-soft">
            Activos sin stock en ninguna ubicación.
            {puedeAjustar &&
              " Con \u201cCargar cantidad\u201d fijás lo que hay realmente (queda como ajuste). Si entró mercadería con lote, usá Nuevo ingreso."}
          </p>
          <ul className="divide-y divide-blush-100">
            {sinStock.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {p.name}
                    {p.type === "KIT" && (
                      <span className="ml-2 rounded-full bg-blush-100 px-2 py-0.5 text-xs font-medium text-rose-deeper">
                        Kit
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-soft">{p.sku}</div>
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  {p.type === "KIT" ? (
                    <Link
                      href={`/productos/${p.id}`}
                      className="py-1 text-xs font-medium text-rose-deep hover:underline"
                    >
                      Armar kits →
                    </Link>
                  ) : (
                    puedeAjustar && <AjusteSinStock productId={p.id} ubicaciones={locations} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {sp.disp === "cero" && sinStock.length === 0 && (
        <Card>
          <p className="text-sm text-soft">No hay productos en 0.</p>
        </Card>
      )}
    </div>
  );
}
