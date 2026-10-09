import "server-only";
import { db } from "./db";

// ── Faltas y horas ──────────────────────────────────────────────────

export const TIPOS_REGISTRO: Record<string, string> = {
  FALTA: "Falta",
  LLEGADA_TARDE: "Llegada tarde",
  SALIDA_ANTICIPADA: "Salida anticipada",
  TURNO_MEDICO: "Turno médico",
  HORAS_A_FAVOR: "Horas a favor (se quedó más)",
  RECUPERO: "Recuperó horas",
  SALDO_INICIAL: "Saldo inicial",
  OTRO: "Otro",
};

export const CERTIFICADO: Record<string, string> = {
  SI: "Presentó certificado",
  NO: "No presentó certificado",
  NO_CORRESPONDE: "No corresponde",
};

export type Empleado = { id: string; name: string; active: boolean };

export type RegistroHoras = {
  id: string;
  record_date: string;
  kind: string;
  reason: string | null;
  schedule: string | null;
  certificate: string | null;
  certificate_path: string | null;
  minutes: number;
  notes: string | null;
  imported: boolean;
  created_by: string | null;
  employee: { id: string; name: string };
};

export async function getEmpleados(soloActivos = true): Promise<Empleado[]> {
  let q = db().from("employees").select("id, name, active").order("name");
  if (soloActivos) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRegistros(): Promise<RegistroHoras[]> {
  const { data, error } = await db()
    .from("time_records")
    .select(
      "id, record_date, kind, reason, schedule, certificate, certificate_path, minutes, notes, imported, created_by, employee:employees(id, name)"
    )
    .order("record_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RegistroHoras[];
}

// "+2 h 30 min" / "−1 h 55 min" / "0"
export function fmtHoras(min: number, signo = true): string {
  if (!min) return "0";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const txt = [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
  return signo ? `${min > 0 ? "+" : "−"}${txt}` : txt;
}

// ── Vacaciones ──────────────────────────────────────────────────────

export const ESTADOS_VACACIONES: Record<string, string> = {
  PENDIENTE: "Pendiente de aprobación",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
  CANCELADA: "Cancelada",
};

export function estadoVacClass(s: string): string {
  if (s === "PENDIENTE") return "bg-amber-100 text-amber-800";
  if (s === "APROBADA") return "bg-emerald-100 text-emerald-800";
  if (s === "RECHAZADA") return "bg-red-100 text-red-800";
  return "bg-stone-200 text-stone-700";
}

export type SolicitudVacaciones = {
  id: string;
  year: number;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  notes: string | null;
  decision_note: string | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  employee: { id: string; name: string };
};

export async function getSolicitudes(anio?: number): Promise<SolicitudVacaciones[]> {
  let q = db()
    .from("vacation_requests")
    .select("id, year, start_date, end_date, days, status, notes, decision_note, requested_by, decided_by, decided_at, employee:employees(id, name)")
    .order("start_date");
  if (anio) q = q.eq("year", anio);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SolicitudVacaciones[];
}

export async function getDiasCorresponden(anio: number) {
  const { data } = await db().from("vacation_allowances").select("employee_id, days, notes").eq("year", anio);
  return new Map((data ?? []).map((r) => [r.employee_id as string, { days: r.days as number, notes: r.notes as string | null }]));
}

export async function contarPendientesVacaciones(): Promise<number> {
  const { count } = await db().from("vacation_requests").select("id", { count: "exact", head: true }).eq("status", "PENDIENTE");
  return count ?? 0;
}

// días corridos, ambos extremos incluidos
export function diasCorridos(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10));
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10));
  return Math.round((b - a) / 86400000) + 1;
}

export function seSuperponen(a: { start_date: string; end_date: string }, b: { start_date: string; end_date: string }) {
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}

export const BUCKET_CERTIFICADOS = "certificados";
