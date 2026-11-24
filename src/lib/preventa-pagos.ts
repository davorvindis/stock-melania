// pagos de preventa: tipos y cálculos sin acceso a la base (los usa también el PDF del comprobante)

export const MEDIOS_PAGO: Record<string, string> = {
  TRANSFERENCIA: "Transferencia",
  EFECTIVO: "Efectivo",
  MERCADO_PAGO: "Mercado Pago",
  OTRO: "Otro",
};

export type PagoPreventa = {
  id: string;
  paid_on: string;
  amount: number;
  method: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

// lo abonado (sin pagos anulados) y lo que falta, si se cargó el total
export function resumenPago(p: { total_amount: number | null; payments: PagoPreventa[] }) {
  const pagado = p.payments.filter((x) => !x.voided_at).reduce((s, x) => s + Number(x.amount), 0);
  const total = p.total_amount === null ? null : Number(p.total_amount);
  const saldo = total === null ? null : Math.max(0, Math.round((total - pagado) * 100) / 100);
  // sin total cargado no se sabe si está paga: solo se muestra lo abonado
  const estado: "PAGADA" | "SENADA" | "SIN_PAGO" | "ABONO" | null =
    total === null ? (pagado > 0 ? "ABONO" : null) : pagado <= 0 ? "SIN_PAGO" : saldo === 0 ? "PAGADA" : "SENADA";
  return { pagado, total, saldo, estado };
}

export const numeroComprobante = (n: number) => `PV-${String(n).padStart(5, "0")}`;
