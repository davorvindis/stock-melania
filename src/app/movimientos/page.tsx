import { getMovements } from "@/lib/queries";
import { revertirMovimiento } from "@/lib/actions";
import { MOVEMENT_LABELS, fmtQty, fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Movimientos({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const movements = await getMovements(200);
  const revertidos = new Set(movements.filter((m) => m.reversal_of).map((m) => m.reversal_of));

  return (
    <div>
      <PageTitle>Movimientos</PageTitle>
      <Flash ok={ok} error={error} />
      <Card>
        <p className="mb-3 text-sm text-soft">
          El historial es permanente: los errores se corrigen con una reversión, nunca borrando.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Fecha</th>
                <th className={th}>Tipo</th>
                <th className={th}>Producto</th>
                <th className={th}>Lote</th>
                <th className={th}>Cant.</th>
                <th className={th}>Origen → Destino</th>
                <th className={th}>Motivo</th>
                <th className={th}>Quién</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const yaRevertido = revertidos.has(m.id);
                return (
                  <tr key={m.id} className={`border-b border-blush-100 ${yaRevertido ? "opacity-50" : ""}`}>
                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(m.occurred_at)}</td>
                    <td className={td}>
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                          m.type === "RECEIPT"
                            ? "bg-emerald-100 text-emerald-800"
                            : m.type === "REVERSAL"
                              ? "bg-stone-200 text-stone-700"
                              : m.type.includes("QUARANTINE")
                                ? "bg-amber-100 text-amber-800"
                                : "bg-blush-100 text-rose-deeper"
                        }`}
                      >
                        {MOVEMENT_LABELS[m.type] ?? m.type}
                      </span>
                    </td>
                    <td className={td}>{m.product.name}</td>
                    <td className={td}>{m.lot?.code ?? "—"}</td>
                    <td className={`${td} font-medium`}>{fmtQty(m.quantity)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {m.from_location?.name ?? "—"} → {m.to_location?.name ?? "—"}
                    </td>
                    <td className={td}>{m.reason ?? "—"}</td>
                    <td className={td}>{m.actor ?? "—"}</td>
                    <td className={td}>
                      {m.type !== "REVERSAL" && !yaRevertido && (
                        <details>
                          <summary className="cursor-pointer text-xs text-rose-deep hover:underline">
                            Revertir
                          </summary>
                          <form action={revertirMovimiento} className="mt-2 space-y-2">
                            <input type="hidden" name="movimiento" value={m.id} />
                            <input
                              type="text"
                              name="actor"
                              placeholder="Tu nombre"
                              required
                              className="w-36 rounded border border-line px-2 py-1 text-xs"
                            />
                            <input
                              type="text"
                              name="motivo"
                              placeholder="Motivo"
                              required
                              className="w-36 rounded border border-line px-2 py-1 text-xs"
                            />
                            <button
                              type="submit"
                              className="rounded bg-rose-deep px-3 py-1 text-xs font-medium text-white"
                            >
                              Confirmar reversión
                            </button>
                          </form>
                        </details>
                      )}
                      {yaRevertido && <span className="text-xs text-soft">Revertido</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
