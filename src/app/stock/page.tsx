import { getBalances, isAvailable, type BalanceRow } from "@/lib/queries";
import { LOT_STATUS_LABELS, fmtQty, fmtDate } from "@/lib/types";
import { Card, PageTitle, th, td } from "@/components/ui";

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

export default async function StockPage() {
  const balances = await getBalances();

  return (
    <div>
      <PageTitle>Stock por producto, lote y ubicación</PageTitle>

      {/* mobile: tarjetas */}
      <div className="space-y-2 md:hidden">
        {balances.map((b) => (
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
        {balances.length === 0 && (
          <Card>
            <p className="text-sm text-soft">Sin stock registrado todavía.</p>
          </Card>
        )}
      </div>

      {/* escritorio: tabla */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>SKU</th>
                <th className={th}>Producto</th>
                <th className={th}>Lote</th>
                <th className={th}>Estado lote</th>
                <th className={th}>Vence</th>
                <th className={th}>Ubicación</th>
                <th className={th}>Cantidad</th>
                <th className={th}>Disponible</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
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
              {balances.length === 0 && (
                <tr>
                  <td className={td} colSpan={8}>
                    Sin stock registrado todavía.
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
