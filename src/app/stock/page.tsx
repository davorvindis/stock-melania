import { getBalances, isAvailable } from "@/lib/queries";
import { LOT_STATUS_LABELS, fmtQty, fmtDate } from "@/lib/types";
import { Card, PageTitle, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const balances = await getBalances();

  return (
    <div>
      <PageTitle>Stock por producto, lote y ubicación</PageTitle>
      <Card>
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
                    {b.lot ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          b.lot.status === "ACTIVE"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {LOT_STATUS_LABELS[b.lot.status]}
                      </span>
                    ) : (
                      "—"
                    )}
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
