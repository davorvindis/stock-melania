import { getBalances, getLocations, isAvailable, type BalanceRow } from "@/lib/queries";
import { LOT_STATUS_LABELS, fmtQty, fmtDate } from "@/lib/types";
import { Card, PageTitle, SortTh, cmp, td, th, input } from "@/components/ui";

export const dynamic = "force-dynamic";

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

type SP = {
  q?: string;
  ubicacion?: string;
  disp?: string;
  sort?: string;
  dir?: string;
};

export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [balances, locations] = await Promise.all([getBalances(), getLocations()]);

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
  if (sp.ubicacion) rows = rows.filter((b) => b.location.id === sp.ubicacion);
  if (sp.disp === "si") rows = rows.filter(isAvailable);
  if (sp.disp === "no") rows = rows.filter((b) => !isAvailable(b));

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

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-4">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar SKU, producto o lote…"
          className={`${input} sm:col-span-2`}
        />
        <select name="ubicacion" defaultValue={sp.ubicacion ?? ""} className={input}>
          <option value="">Todas las ubicaciones</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="disp" defaultValue={sp.disp ?? ""} className={input}>
            <option value="">Disponible y no disp.</option>
            <option value="si">Solo disponible</option>
            <option value="no">Solo no disponible</option>
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
        {rows.length} renglón(es) · {fmtQty(total)} unidades
      </p>

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
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={td} colSpan={8}>
                    Nada coincide con la búsqueda o filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
