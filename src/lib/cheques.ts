import "server-only";
import { db } from "./db";

export type EstadoCheque = "PENDIENTE" | "PROPUESTO" | "PAGADO" | "ANULADO";

export const ESTADO_CHEQUE_LABEL: Record<EstadoCheque, string> = {
  PENDIENTE: "Pendiente",
  PROPUESTO: "Propuesto",
  PAGADO: "Pagado",
  ANULADO: "Anulado",
};

export type Cheque = {
  id: string;
  due_date: string; // YYYY-MM-DD
  supplier_id: string | null;
  payee: string | null;
  concept: string;
  amount: number;
  status: EstadoCheque;
  bank: string | null;
  number: string | null;
  notes: string | null;
  paid_at: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  supplier: { id: string; name: string } | null;
};

export function beneficiario(c: Pick<Cheque, "supplier" | "payee">): string {
  return c.supplier?.name ?? c.payee ?? "—";
}

// cuenta para los fondos que hay que tener: emitidos sin debitar y compras propuestas
export function aReservar(c: Pick<Cheque, "status">): boolean {
  return c.status === "PENDIENTE" || c.status === "PROPUESTO";
}

export async function getCheques(): Promise<Cheque[]> {
  const { data, error } = await db()
    .from("cheques")
    .select("*, supplier:suppliers(id, name)")
    .order("due_date")
    .order("created_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Cheque[]).map((c) => ({ ...c, amount: Number(c.amount) }));
}

// ── fechas (días calendario, sin zona horaria) ──────────────────────

const diaAR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
export function hoyAR(): string {
  return diaAR.format(new Date());
}

export const mesDe = (fecha: string) => fecha.slice(0, 7); // YYYY-MM

export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

// misma fecha N meses después; si el día no existe (31 en un mes de 30) queda el último del mes
export function mismaFechaEnMeses(fecha: string, n: number): string {
  const mes = sumarMeses(mesDe(fecha), n);
  const dia = Number(fecha.slice(8, 10));
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function mesCorto(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`;
}
export function mesLargo(mes: string): string {
  return `${MESES_LARGO[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
}

export function diasHasta(fecha: string, hoy: string): number {
  return Math.round((Date.parse(fecha) - Date.parse(hoy)) / 86_400_000);
}

// ── resumen por mes (como la hoja Resumen del Excel) ────────────────

export type MesResumen = {
  mes: string;
  pagado: number;
  pendiente: number;
  propuesto: number;
  total: number; // sin anulados
  porBeneficiario: Map<string, number>; // sin anulados
};

export function resumenPorMes(cheques: Cheque[]): MesResumen[] {
  const vivos = cheques.filter((c) => c.status !== "ANULADO");
  if (vivos.length === 0) return [];
  const meses = vivos.map((c) => mesDe(c.due_date)).sort();
  const out: MesResumen[] = [];
  for (let m = meses[0]; m <= meses[meses.length - 1]; m = sumarMeses(m, 1)) {
    const del = vivos.filter((c) => mesDe(c.due_date) === m);
    const suma = (e: EstadoCheque) => del.filter((c) => c.status === e).reduce((s, c) => s + c.amount, 0);
    const porBeneficiario = new Map<string, number>();
    for (const c of del) porBeneficiario.set(beneficiario(c), (porBeneficiario.get(beneficiario(c)) ?? 0) + c.amount);
    const r = { mes: m, pagado: suma("PAGADO"), pendiente: suma("PENDIENTE"), propuesto: suma("PROPUESTO"), total: 0, porBeneficiario };
    r.total = r.pagado + r.pendiente + r.propuesto;
    out.push(r);
  }
  return out;
}
