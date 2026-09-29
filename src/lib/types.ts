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
  REVERSAL: "Reversión",
  OTHER: "Otro",
};

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
  return new Date(d).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}

export function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "short",
    timeStyle: "short",
  });
}
