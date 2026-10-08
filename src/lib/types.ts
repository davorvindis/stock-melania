export type LotStatus = "ACTIVE" | "QUARANTINE" | "BLOCKED" | "EXPIRED" | "DEPLETED";

export const MOVEMENT_LABELS: Record<string, string> = {
  RECEIPT: "Ingreso",
  TRANSFER: "Transferencia",
  SALE: "Venta",
  WHOLESALE_SALE: "Venta mayorista",
  RETURN_IN: "Devolución recibida",
  RETURN_OUT: "Devolución enviada",
  SAMPLE: "Muestra",
  GIFT: "Regalo",
  BREAKAGE: "Rotura",
  EXPIRED: "Vencimiento",
  INTERNAL_USE: "Uso interno",
  REPLACEMENT: "Reposición por reclamo",
  QUARANTINE_IN: "A cuarentena",
  QUARANTINE_RELEASE: "Liberación de cuarentena",
  SUPPLIER_SEND: "Envío a proveedor",
  SUPPLIER_RETURN: "Vuelta de proveedor",
  COUNT_ADJUSTMENT: "Ajuste por conteo",
  KIT_ASSEMBLY: "Armado de kit",
  KIT_DISASSEMBLY: "Desarmado de kit",
  LOT_ASSIGNMENT: "Asignación de lote",
  REVERSAL: "Reversión",
  OTHER: "Otro",
};

// lado sin ubicación de un movimiento: egresos van a "Venta", "Uso interno"…;
// ingresos vienen de "Ingreso", "Reversión"…
export function origenDestino(m: {
  type: string;
  from_location: { name: string } | null;
  to_location: { name: string } | null;
}): { origen: string; destino: string; origenEsTipo: boolean; destinoEsTipo: boolean } {
  const tipo = MOVEMENT_LABELS[m.type] ?? m.type;
  return {
    origen: m.from_location?.name ?? tipo,
    destino: m.to_location?.name ?? tipo,
    origenEsTipo: !m.from_location,
    destinoEsTipo: !m.to_location,
  };
}

// tipos que exigen ubicación destino (además del origen)
export const NEEDS_DESTINATION = ["TRANSFER", "QUARANTINE_IN", "QUARANTINE_RELEASE", "SUPPLIER_SEND"];

// tipos operables desde la pantalla "Nuevo movimiento" (egresos y transferencias)
export const OPERABLE_TYPES = [
  "TRANSFER",
  "SALE",
  "WHOLESALE_SALE",
  "GIFT",
  "SAMPLE",
  "BREAKAGE",
  "EXPIRED",
  "INTERNAL_USE",
  "QUARANTINE_IN",
  "QUARANTINE_RELEASE",
  "SUPPLIER_SEND",
  "OTHER",
] as const;

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  ACTIVE: "Liberado",
  QUARANTINE: "Cuarentena",
  BLOCKED: "Bloqueado",
  EXPIRED: "Vencido",
  DEPLETED: "Agotado",
};

export function lotBadgeClass(status: LotStatus): string {
  if (status === "ACTIVE") return "bg-emerald-100 text-emerald-800";
  if (status === "DEPLETED") return "bg-stone-200 text-stone-700";
  return "bg-amber-100 text-amber-800";
}

export function fmtQty(n: number | string): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

export function fmtMoney(n: number | string | null): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
}

export function fmtDate(d: string | null): string {
  if (!d) return "—";
  // fecha sin hora (vencimiento, fecha de ingreso/orden): es un día calendario, no
  // convertir de zona horaria (si no, "2026-09-23" se ve como 22/9 en Argentina)
  const solo = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (solo) return `${Number(solo[3])}/${Number(solo[2])}/${solo[1]}`;
  return new Date(d).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}

export function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "short",
    timeStyle: "short",
  });
}
