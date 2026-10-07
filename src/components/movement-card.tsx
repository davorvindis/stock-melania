import type { MovementRow } from "@/lib/queries";
import { MOVEMENT_LABELS, fmtQty, fmtDateTime, origenDestino } from "@/lib/types";

export function movementBadgeClass(type: string): string {
  if (type === "RECEIPT") return "bg-emerald-100 text-emerald-800";
  if (type === "REVERSAL") return "bg-stone-200 text-stone-700";
  if (type.includes("QUARANTINE")) return "bg-amber-100 text-amber-800";
  return "bg-blush-100 text-rose-deeper";
}

// "Depósito → Venta", "Ingreso → Depósito": el lado sin ubicación muestra el tipo
export function OrigenDestino({ m }: { m: Parameters<typeof origenDestino>[0] }) {
  const od = origenDestino(m);
  return (
    <>
      <span className={od.origenEsTipo ? "italic text-soft" : ""}>{od.origen}</span>
      {" → "}
      <span className={od.destinoEsTipo ? "italic text-soft" : ""}>{od.destino}</span>
    </>
  );
}

export function MovementCard({
  movement,
  children,
}: {
  movement: MovementRow;
  children?: React.ReactNode;
}) {
  const m = movement;
  return (
    <div className="rounded-lg border border-blush-100 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${movementBadgeClass(m.type)}`}
        >
          {MOVEMENT_LABELS[m.type] ?? m.type}
        </span>
        <span className="text-xs text-soft">{fmtDateTime(m.occurred_at)}</span>
      </div>
      <div className="mt-2 text-sm font-medium">
        {m.product.name}
        {m.lot ? <span className="font-normal text-soft"> · lote {m.lot.code}</span> : null}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-display text-2xl leading-none">
          {fmtQty(m.quantity)} <span className="font-sans text-xs text-soft">{m.product.unit}</span>
        </span>
        <span className="text-sm text-soft">
          <OrigenDestino m={m} />
        </span>
      </div>
      {(m.reason || m.actor) && (
        <div className="mt-1 text-xs text-soft">
          {m.reason ? `${m.reason} · ` : ""}
          {m.actor ?? ""}
        </div>
      )}
      {children}
    </div>
  );
}
