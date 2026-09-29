import { requireSection } from "@/lib/auth";
import { getMovements, type MovementRow } from "@/lib/queries";
import { revertirMovimiento } from "@/lib/actions";
import { MOVEMENT_LABELS, fmtQty, fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, SortTh, cmp, th, td, input } from "@/components/ui";
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

type SP = { ok?: string; error?: string; q?: string; tipo?: string; sort?: string; dir?: string };

export default async function Movimientos({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireSection("movimientos");
  const puedeRevertir = user.role === "ADMIN" || user.role === "MANAGER";
  const sp = await searchParams;
  const { ok, error } = sp;
  const all = await getMovements(500);
  const revertidos = new Set(all.filter((m) => m.reversal_of).map((m) => m.reversal_of));

  let movements = all;
  if (sp.q) {
    const needle = sp.q.toLowerCase();
    movements = movements.filter(
      (m) =>
        m.product.name.toLowerCase().includes(needle) ||
        m.product.sku.toLowerCase().includes(needle) ||
        (m.lot?.code ?? "").toLowerCase().includes(needle) ||
        (m.actor ?? "").toLowerCase().includes(needle) ||
        (m.reason ?? "").toLowerCase().includes(needle)
    );
  }
  if (sp.tipo) movements = movements.filter((m) => m.type === sp.tipo);
  if (sp.sort) {
    const key = (m: MovementRow) =>
      sp.sort === "cantidad" ? Number(m.quantity) : sp.sort === "tipo" ? m.type : m.occurred_at;
    movements = [...movements].sort((a, b) => cmp(key(a), key(b), sp.dir));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Movimientos</PageTitle>
        <a
          href="/api/export/movimientos"
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
        >
          Descargar Excel
        </a>
      </div>
      <Flash ok={ok} error={error} />

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-3">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar producto, lote, motivo, persona…"
          className={input}
        />
        <select name="tipo" defaultValue={sp.tipo ?? ""} className={input}>
          <option value="">Todos los tipos</option>
          {Object.entries(MOVEMENT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper sm:w-28"
        >
          Filtrar
        </button>
      </form>

      <p className="mb-3 text-sm text-soft">
        {movements.length} movimiento(s). El historial es permanente: los errores se corrigen con
        una reversión, nunca borrando.
      </p>

      {/* mobile: tarjetas */}
      <div className="space-y-2 md:hidden">
        {movements.map((m) => {
          const yaRevertido = revertidos.has(m.id);
          return (
            <div key={m.id} className={yaRevertido ? "opacity-50" : ""}>
              <MovementCard movement={m}>
                {puedeRevertir && m.type !== "REVERSAL" && !yaRevertido && <RevertForm movement={m} compact />}
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
                <SortTh col="fecha" sp={sp} path="/movimientos">Fecha</SortTh>
                <SortTh col="tipo" sp={sp} path="/movimientos">Tipo</SortTh>
                <th className={th}>Producto</th>
                <th className={th}>Lote</th>
                <SortTh col="cantidad" sp={sp} path="/movimientos">Cant.</SortTh>
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
                      {puedeRevertir && m.type !== "REVERSAL" && !yaRevertido && <RevertForm movement={m} />}
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
