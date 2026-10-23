import "server-only";
import { db } from "./db";

// Caja fuerte: solo efectivo (pesos y USD).
// Entra: pagos de cierres ENVIADOS con "¿Dónde ingresó el dinero?" = Caja fuerte
//        (columna Efectivo en pesos, columna Pago USD en dólares) + ingresos manuales aprobados.
// Sale: retiros aprobados. Lo pendiente de aprobación se muestra aparte.

export type MovimientoCF = {
  id: string;
  kind: "RETIRO" | "INGRESO";
  scope: "TOTAL" | "PARCIAL" | null;
  movement_date: string;
  amount: number;
  currency: "ARS" | "USD";
  person: string | null;
  notes: string | null;
  status: "PENDIENTE" | "APROBADO" | "RECHAZADO";
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

export type EntradaCierre = { fecha: string; cliente: string | null; ars: number; usd: number };

const esCajaFuerte = (s: string | null) => (s ?? "").trim().toLowerCase() === "caja fuerte";

export async function getCajaFuerte() {
  const [movs, lineas] = await Promise.all([
    db().from("cash_vault_movements").select("*").order("movement_date", { ascending: false }).order("requested_at", { ascending: false }),
    db()
      .from("cash_closing_lines")
      .select("customer, cash, usd, account, closing:cash_closings!inner(closing_date, status)")
      .ilike("account", "%caja fuerte%")
      .eq("closing.status", "ENVIADO"),
  ]);
  if (movs.error) throw new Error(movs.error.message);
  if (lineas.error) throw new Error(lineas.error.message);
  const movimientos = (movs.data ?? []).map((m) => ({ ...m, amount: Number(m.amount) })) as MovimientoCF[];
  type L = { customer: string | null; cash: number | null; usd: number | null; account: string | null; closing: { closing_date: string } };
  const entradas: EntradaCierre[] = ((lineas.data ?? []) as unknown as L[])
    .filter((l) => esCajaFuerte(l.account) && (Number(l.cash) || Number(l.usd)))
    .map((l) => ({ fecha: l.closing.closing_date, cliente: l.customer, ars: Number(l.cash) || 0, usd: Number(l.usd) || 0 }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  const saldo = { ARS: 0, USD: 0 };
  const pendiente = { ARS: 0, USD: 0 }; // retiros esperando aprobación
  for (const e of entradas) {
    saldo.ARS += e.ars;
    saldo.USD += e.usd;
  }
  for (const m of movimientos) {
    if (m.status === "APROBADO") saldo[m.currency] += m.kind === "INGRESO" ? m.amount : -m.amount;
    if (m.status === "PENDIENTE" && m.kind === "RETIRO") pendiente[m.currency] += m.amount;
  }
  return {
    movimientos,
    entradas,
    saldo,
    pendiente,
    porRetirar: { ARS: saldo.ARS - pendiente.ARS, USD: saldo.USD - pendiente.USD },
    pendientesAprobar: movimientos.filter((m) => m.status === "PENDIENTE"),
  };
}

export async function contarPendientesCF() {
  const { count } = await db().from("cash_vault_movements").select("id", { count: "exact", head: true }).eq("status", "PENDIENTE");
  return count ?? 0;
}
