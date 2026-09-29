import { getMovements, type MovementRow } from "@/lib/queries";
import { revertirMovimiento } from "@/lib/actions";
import { MOVEMENT_LABELS, fmtQty, fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, th, td } from "@/components/ui";
import { MovementCard, movementBadgeClass } from "@/components/movement-card";

export const dynamic = "force-dynamic";

function RevertForm({ movement, compact = false }: { movement: MovementRow; compact?: boolean }) {
  return (
    <details className={compact ? "" : "mt-2"}>
      <summary className="cursor-pointer py-1 text-xs font-medium text-rose-deep hover:underline">
        Revertir
      </summary>
      <form
        action={revertirMovimiento}
        className={compact ? "mt-2 space-y-2" : "mt-2 flex flex-wrap gap-2"}
      >
        <input type="hidden" name="movimiento" value={movement.id} />
        <input
          type="text"
          name="actor"
          placeholder="Tu nombre"
          required
          className={`rounded-lg border border-line px-3 py-2 text-sm ${compact ? "w-full" : "w-36"}`}
        />
        <input
          type="text"
          name="motivo"
          placeholder="Motivo"
          required
          className={`rounded-lg border border-line px-3 py-2 text-sm ${compact ? "w-full" : "w-40"}`}
        />
        <button
          type="submit"
          className={`rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white ${compact ? "w-full" : ""}`}
        >
          Confirmar reversión
        </button>
      </form>
    </details>
  );
}

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

      <p className="mb-3 text-sm text-soft">
        El historial es permanente: los errores se corrigen con una reversión, nunca borrando.
      </p>

      {/* mobile: tarjetas */}
      <div className="space-y-2 md:hidden">
        {movements.map((m) => {
          const yaRevertido = revertidos.has(m.id);
          return (
            <div key={m.id} className={yaRevertido ? "opacity-50" : ""}>
              <MovementCard movement={m}>
                {m.type !== "REVERSAL" && !yaRevertido && <RevertForm movement={m} compact />}
                {yaRevertido && <div className="mt-1 text-xs text-soft">Revertido</div>}
              </MovementCard>
            </div>
          );
        })}
      </div>

      {/* escritorio: tabla */}
      <Card className="hidden md:block">
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
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${movementBadgeClass(m.type)}`}
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
                      {m.type !== "REVERSAL" && !yaRevertido && <RevertForm movement={m} />}
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
