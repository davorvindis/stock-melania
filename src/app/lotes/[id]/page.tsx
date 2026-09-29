import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { getLotDetail } from "@/lib/queries";
import { cambiarEstadoLote } from "@/lib/actions";
import {
  LOT_STATUS_LABELS,
  MOVEMENT_LABELS,
  fmtQty,
  fmtMoney,
  fmtDate,
  fmtDateTime,
  lotBadgeClass,
} from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button, th, td } from "@/components/ui";
import { MovementCard } from "@/components/movement-card";

export const dynamic = "force-dynamic";

const CAMBIOS: { estado: string; label: string }[] = [
  { estado: "QUARANTINE", label: "Enviar a cuarentena" },
  { estado: "BLOCKED", label: "Bloquear" },
  { estado: "ACTIVE", label: "Liberar" },
  { estado: "EXPIRED", label: "Marcar vencido" },
];

export default async function LoteDetalle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireSection("lotes");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const { lot, movements, balances, entryLines } = await getLotDetail(id);

  const total = balances.reduce((s, b) => s + Number(b.quantity), 0);

  return (
    <div className="max-w-3xl">
      <PageTitle>
        Lote {lot.code} — {lot.product.name}
      </PageTitle>
      <Flash ok={ok} error={error} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${lotBadgeClass(lot.status)}`}>
          {LOT_STATUS_LABELS[lot.status]}
        </span>
        <span className="text-sm text-soft">
          {lot.product.sku}
          {lot.expires_on ? ` · vence ${fmtDate(lot.expires_on)}` : ""} · creado{" "}
          {fmtDate(lot.created_at)}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Saldo por ubicación</h2>
          {balances.length === 0 && <p className="text-sm text-soft">Sin saldo actual.</p>}
          <ul className="space-y-1">
            {balances.map((b, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span>
                  {b.location.name}
                  {b.location.is_quarantine ? " ⚠" : ""}
                </span>
                <span className="font-semibold">{fmtQty(b.quantity)}</span>
              </li>
            ))}
          </ul>
          {balances.length > 0 && (
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold">
              <span>Total físico</span>
              <span>{fmtQty(total)}</span>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Origen</h2>
          {entryLines.length === 0 && (
            <p className="text-sm text-soft">Sin ingreso registrado (lote histórico).</p>
          )}
          <ul className="space-y-2">
            {entryLines.map((e, i) => (
              <li key={i} className="text-sm">
                <div>
                  {fmtDate(e.entry.entry_date)} · {fmtQty(e.quantity)} {lot.product.unit} ·{" "}
                  {e.entry.supplier?.name ?? "sin proveedor"}
                </div>
                <div className="text-xs text-soft">
                  {e.entry.remito ? `Remito ${e.entry.remito} · ` : ""}
                  {e.entry.invoice ? `Factura ${e.entry.invoice} · ` : ""}
                  costo unit. {fmtMoney(e.unit_cost)} · total {fmtMoney(e.total_cost)}
                  {e.entry.actor ? ` · cargó ${e.entry.actor}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {(user.role === "ADMIN" || user.role === "MANAGER") && (
      <Card className="mt-4">
        <h2 className="mb-1 font-semibold">Cambiar estado</h2>
        <p className="mb-3 text-sm text-soft">
          Cuarentena o bloqueo sacan el lote del stock disponible sin mover unidades. Todo cambio
          queda auditado con motivo.
        </p>
        <form action={cambiarEstadoLote} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="lote" value={lot.id} />
          <input type="hidden" name="volver" value={`/lotes/${lot.id}`} />
          <div>
            <label className={label}>Nuevo estado *</label>
            <select name="estado" required className={input}>
              {CAMBIOS.filter((c) => c.estado !== lot.status).map((c) => (
                <option key={c.estado} value={c.estado}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Motivo *</label>
            <input type="text" name="motivo" required className={input} placeholder="ej. control de calidad" />
          </div>
          <div className="sm:col-span-3">
            <SubmitButton className={button}>
              Confirmar cambio de estado
            </SubmitButton>
          </div>
        </form>
      </Card>
      )}

      <h2 className="mb-2 mt-6 font-display text-2xl tracking-wide">Historial del lote</h2>
      <div className="space-y-2 md:hidden">
        {movements.map((m) => (
          <MovementCard key={m.id} movement={m} />
        ))}
      </div>
      <Card className="hidden md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Fecha</th>
              <th className={th}>Tipo</th>
              <th className={th}>Cant.</th>
              <th className={th}>Origen → Destino</th>
              <th className={th}>Motivo</th>
              <th className={th}>Quién</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-b border-blush-100">
                <td className={`${td} whitespace-nowrap`}>{fmtDateTime(m.occurred_at)}</td>
                <td className={td}>{MOVEMENT_LABELS[m.type] ?? m.type}</td>
                <td className={`${td} font-medium`}>{fmtQty(m.quantity)}</td>
                <td className={td}>
                  {m.from_location?.name ?? "—"} → {m.to_location?.name ?? "—"}
                </td>
                <td className={td}>{m.reason ?? "—"}</td>
                <td className={td}>{m.actor ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
