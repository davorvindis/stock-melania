import "server-only";
import { db } from "./db";

// ── Empleados y novedades de sueldo para la contadora ───────────────

export const EMPLEADORES: Record<string, string> = { MARRUDI: "Marrudi SRL", ECP: "Casas particulares (Joel)" };

export const ESQUEMAS: Record<string, { label: string; ayuda: string }> = {
  CONVENIO: { label: "Convenio de comercio", ayuda: "El sueldo lo calcula la contadora; se le pasan aumentos y novedades" },
  EN_MANO: { label: "Monto fijo en mano", ayuda: "Cobra un monto fijo por mes" },
  FIJO_COMISION: { label: "Básico + comisiones", ayuda: "Básico fijo más las comisiones del mes (lo facturado en Xubio)" },
  POR_HORA: { label: "Por hora", ayuda: "Horas trabajadas en el mes × valor hora" },
};

export type Persona = {
  id: string;
  name: string;
  full_name: string | null;
  employer: "MARRUDI" | "ECP";
  pay_scheme: "CONVENIO" | "EN_MANO" | "FIJO_COMISION" | "POR_HORA";
  base_amount: number | null;
  hourly_rate: number | null;
  start_date: string | null;
  end_date: string | null;
  sort_order: number;
  notes: string | null;
  active: boolean;
};

export type Novedad = {
  id: string;
  employee_id: string;
  period: string;
  base_amount: number | null;
  commissions: number | null;
  minutes_worked: number | null;
  hourly_rate: number | null;
  total: number | null;
  report_amount: boolean;
  raise_pct: number | null;
  bonus: number | null;
  aguinaldo: boolean;
  no_presentismo: boolean;
  pending: boolean;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
};

// lo que la app ya sabe de ese mes (vacaciones aprobadas, faltas)
export type Hecho = { texto: string; sugerencia?: string };

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const nombre = (p: Pick<Persona, "name" | "full_name">) => p.full_name || p.name;

// "2026-10" → { desde: "2026-10-01", hasta: "2026-10-31" }
export function rangoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export function mesVecino(mes: string, delta: number) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

// $ con puntos de miles y decimales solo si los hay: 1.000.000 · 861.814,70
export function pesos(n: number | null) {
  if (n === null) return "";
  const dec = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("es-AR", { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: 2 });
}

// porcentaje sin ceros de más: 3,3 · 10 · 1,25
export const porcentaje = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

export const diaMes = (f: string) => `${Number(f.slice(8, 10))}/${f.slice(5, 7)}`;

export function horasTexto(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}hs y ${m}min` : `${h}hs`;
}

// total a cobrar cuando se puede calcular
export function calcularTotal(esquema: Persona["pay_scheme"], n: Pick<Novedad, "base_amount" | "commissions" | "minutes_worked" | "hourly_rate">): number | null {
  if (esquema === "FIJO_COMISION" && n.base_amount !== null) return Math.round((n.base_amount + (n.commissions ?? 0)) * 100) / 100;
  if (esquema === "POR_HORA" && n.minutes_worked && n.hourly_rate !== null) return Math.round((n.minutes_worked / 60) * n.hourly_rate * 100) / 100;
  if (n.base_amount !== null) return n.base_amount;
  return null;
}

// las personas que corresponden a un mes: activas, o que entraron/salieron dentro del mes
export async function getPersonas(mes?: string): Promise<Persona[]> {
  const { data, error } = await db()
    .from("employees")
    .select("id, name, full_name, employer, pay_scheme, base_amount, hourly_rate, start_date, end_date, sort_order, notes, active")
    .order("employer", { ascending: false }) // MARRUDI antes que ECP
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  const todas = (data ?? []).map((p) => ({ ...p, base_amount: num(p.base_amount), hourly_rate: num(p.hourly_rate) })) as Persona[];
  if (!mes) return todas;
  const { desde, hasta } = rangoMes(mes);
  return todas.filter(
    (p) => (!p.start_date || p.start_date <= hasta) && (p.end_date ? p.end_date >= desde : p.active)
  );
}

const aNovedad = (r: Record<string, unknown>) =>
  ({
    ...r,
    base_amount: num(r.base_amount),
    commissions: num(r.commissions),
    hourly_rate: num(r.hourly_rate),
    total: num(r.total),
    raise_pct: num(r.raise_pct),
    bonus: num(r.bonus),
  }) as Novedad;

export async function getNovedades(desde: string, hasta: string): Promise<Novedad[]> {
  const { data, error } = await db().from("payroll_entries").select("*").gte("period", desde).lte("period", hasta).order("period");
  if (error) throw new Error(error.message);
  return (data ?? []).map(aNovedad);
}

// la última novedad guardada de cada persona antes del mes (para precargar el mes nuevo)
export async function getAnteriores(mes: string): Promise<Map<string, Novedad>> {
  const { data, error } = await db().from("payroll_entries").select("*").lt("period", `${mes}-01`).order("period", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const m = new Map<string, Novedad>();
  for (const r of data ?? []) if (!m.has(r.employee_id)) m.set(r.employee_id, aNovedad(r));
  return m;
}

// vacaciones aprobadas y faltas del mes, por persona (solo Marrudi las carga en la app)
export async function getHechos(mes: string): Promise<Map<string, Hecho[]>> {
  const { desde, hasta } = rangoMes(mes);
  const [vac, faltas] = await Promise.all([
    db().from("vacation_requests").select("employee_id, start_date, end_date, days").eq("status", "APROBADA").lte("start_date", hasta).gte("end_date", desde),
    db().from("time_records").select("employee_id, record_date, kind, certificate, reason").in("kind", ["FALTA"]).gte("record_date", desde).lte("record_date", hasta).order("record_date"),
  ]);
  if (vac.error) throw new Error(vac.error.message);
  if (faltas.error) throw new Error(faltas.error.message);
  const m = new Map<string, Hecho[]>();
  const add = (id: string, h: Hecho) => m.set(id, [...(m.get(id) ?? []), h]);
  for (const v of vac.data ?? []) {
    const r = `del ${diaMes(v.start_date)} al ${diaMes(v.end_date)}`;
    add(v.employee_id, { texto: `Vacaciones aprobadas ${r} (${v.days} días)`, sugerencia: `Se tomó vacaciones ${r}.` });
  }
  for (const f of faltas.data ?? []) {
    const cert = f.certificate === "SI" ? "presentó certificado" : f.certificate === "NO" ? "no presentó certificado" : null;
    add(f.employee_id, {
      texto: `Falta el ${diaMes(f.record_date)}${f.reason ? ` (${f.reason})` : ""}${cert ? `, ${cert}` : ""}`,
      sugerencia: `Faltó el ${diaMes(f.record_date)}${cert ? ` (${cert})` : ""}.`,
    });
  }
  return m;
}

// ── el mensaje para la contadora ────────────────────────────────────

export function lineaPersona(p: Persona, n: Novedad | undefined, mes: string): string {
  const { desde, hasta } = rangoMes(mes);
  const partes: string[] = [];
  if (p.start_date && p.start_date >= desde && p.start_date <= hasta) partes.push(`Ingresó el ${diaMes(p.start_date)}.`);
  if (p.end_date && p.end_date >= desde && p.end_date <= hasta) partes.push(`Trabajó hasta el ${diaMes(p.end_date)}, hay que darle la baja.`);
  if (n?.pending) {
    partes.push("Mañana te paso bien");
  } else if (n) {
    if (p.pay_scheme === "FIJO_COMISION" && n.base_amount !== null && n.commissions !== null) {
      partes.push(`Sueldo: ${pesos(n.base_amount)} (básico) + ${pesos(n.commissions)} (comisiones) = total a cobrar $${pesos(n.total)}`);
    } else if (p.pay_scheme === "POR_HORA" && n.minutes_worked && n.hourly_rate !== null) {
      partes.push(`Trabajó ${horasTexto(n.minutes_worked)} x $${pesos(n.hourly_rate)} = total a cobrar $${pesos(n.total)}`);
    } else if (n.report_amount && n.base_amount !== null) {
      partes.push(`A cobrar en mano $${pesos(n.base_amount)}`);
    }
    if (n.raise_pct) partes.push(`Hacer un aumento del ${porcentaje(n.raise_pct)}% en su básico.`);
    if (n.bonus) partes.push(`Le damos un bono de $${pesos(n.bonus)}.`);
    if (n.no_presentismo) partes.push("Hay que restarle el presentismo.");
    if (n.notes?.trim()) partes.push(n.notes.trim());
    if (n.aguinaldo) partes.push("Más aguinaldo.");
  }
  if (partes.length === 0) return `-${nombre(p)}: Sin novedades`;
  if (partes.length === 1) return `-${nombre(p)}: ${partes[0]}`;
  return `-${nombre(p)}:\n${partes.join("\n")}`;
}

export function mensajeContadora(personas: Persona[], novedades: Map<string, Novedad>, mes: string): string {
  const mesTxt = MESES[Number(mes.slice(5, 7)) - 1];
  const marrudi = personas.filter((p) => p.employer === "MARRUDI");
  const ecp = personas.filter((p) => p.employer === "ECP");
  let t = `Hola Flor buen día! Cómo estás?\n\nTe paso las novedades de ${mesTxt} de MARRUDI:\n\n`;
  t += marrudi.map((p) => lineaPersona(p, novedades.get(p.id), mes)).join("\n\n");
  if (ecp.length) {
    t += "\n\n——————————————\nLas ECP:\n\n";
    t += ecp.map((p) => lineaPersona(p, novedades.get(p.id), mes)).join("\n\n");
  }
  return t;
}
