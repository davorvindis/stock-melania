import { requireSection } from "@/lib/auth";
import { getAuditLogs } from "@/lib/queries";
import { fmtDateTime, MOVEMENT_LABELS } from "@/lib/types";
import { Card, PageTitle, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACCIONES: Record<string, string> = {
  "stock_entry:create": "Ingreso de stock",
  "count:open": "Conteo abierto",
  "count:close": "Conteo cerrado",
  "count:approve": "Conteo aprobado",
  "count:reject": "Conteo rechazado",
  "lot:status": "Cambio estado de lote",
  "user:create": "Alta de usuario",
  "user:update": "Edición de usuario",
  "user:pin_reset": "Blanqueo de PIN",
  "user:pin_changed": "Cambio de PIN propio",
  "product:create": "Alta de producto",
  "product:update": "Edición de producto",
  "product:import": "Importación de productos",
};

function describir(action: string): string {
  if (ACCIONES[action]) return ACCIONES[action];
  if (action.startsWith("movement:")) {
    const tipo = action.slice(9);
    return `Movimiento: ${MOVEMENT_LABELS[tipo] ?? tipo}`;
  }
  return action;
}

const ESTADOS_LOTE: Record<string, string> = {
  ACTIVE: "Liberado", QUARANTINE: "Cuarentena", BLOCKED: "Bloqueado",
  EXPIRED: "Vencido", DEPLETED: "Agotado",
};

// resume el detalle en lenguaje humano; nunca muestra JSON crudo ni UUIDs
function detalleLegible(detail: Record<string, unknown> | null): string {
  if (!detail) return "—";
  const partes: string[] = [];
  if (typeof detail.before === "string" && typeof detail.after === "string") {
    partes.push(`${ESTADOS_LOTE[detail.before] ?? detail.before} → ${ESTADOS_LOTE[detail.after] ?? detail.after}`);
  }
  if (detail.quantity !== undefined) partes.push(`Cantidad: ${detail.quantity}`);
  if (detail.creados !== undefined) partes.push(`Creados: ${detail.creados}`);
  if (detail.salteados !== undefined && Number(detail.salteados) > 0) partes.push(`salteados: ${detail.salteados}`);
  if (typeof detail.lines === "number") partes.push(`Líneas: ${detail.lines}`);
  if (typeof detail.remito === "string" && detail.remito) partes.push(`Remito ${detail.remito}`);
  if (typeof detail.sku === "string") partes.push(detail.sku);
  if (typeof detail.alias === "string") partes.push(`Alias: ${detail.alias}`);
  if (typeof detail.role === "string") partes.push(`Rol: ${detail.role}`);
  if (detail.active !== undefined) partes.push(detail.active ? "activo" : "desactivado");
  if (typeof detail.reason === "string" && detail.reason) partes.push(`Motivo: ${detail.reason}`);
  return partes.length ? partes.join(" · ") : "—";
}

export default async function Auditoria({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSection("auditoria");
  const { q } = await searchParams;
  let logs = await getAuditLogs(300);
  if (q) {
    const needle = q.toLowerCase();
    logs = logs.filter(
      (l) =>
        describir(l.action).toLowerCase().includes(needle) ||
        (l.actor ?? "").toLowerCase().includes(needle)
    );
  }

  return (
    <div className="max-w-3xl">
      <PageTitle>Auditoría</PageTitle>
      <p className="mb-3 text-sm text-soft">
        Registro permanente de acciones sensibles. No se puede editar ni borrar.
      </p>
      <form method="get" className="mb-4">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Filtrar por acción o persona…"
          className="w-full max-w-sm rounded-lg border border-line bg-white px-3 py-2.5 focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
        />
      </form>

      <div className="space-y-2 md:hidden">
        {logs.map((l) => (
          <div key={l.id} className="rounded-lg border border-blush-100 bg-white p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{describir(l.action)}</span>
              <span className="text-xs text-soft">{fmtDateTime(l.at)}</span>
            </div>
            <div className="mt-1 text-xs text-soft">
              {l.actor ?? "—"}
              {detalleLegible(l.detail) !== "—" ? ` · ${detalleLegible(l.detail)}` : ""}
            </div>
          </div>
        ))}
      </div>

      <Card className="hidden md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Fecha</th>
              <th className={th}>Acción</th>
              <th className={th}>Quién</th>
              <th className={th}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-blush-100">
                <td className={`${td} whitespace-nowrap`}>{fmtDateTime(l.at)}</td>
                <td className={td}>{describir(l.action)}</td>
                <td className={td}>{l.actor ?? "—"}</td>
                <td className={`${td} text-xs text-soft`}>{detalleLegible(l.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
