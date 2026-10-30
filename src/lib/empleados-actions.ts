"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";
import { calcularTotal, getPersonas, type Persona } from "./empleados";

function volverConError(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}
function volverOk(path: string, msg: string): never {
  revalidatePath("/empleados", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}

const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

// montos como se escriben acá: "1.020.736,87" / "1020736.87" / "8500" / "3,3"
function monto(v: FormDataEntryValue | null): number | null | "error" {
  let s = String(v ?? "").replace(/\$|\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 1.000.000
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : "error";
}

// ── novedades del mes ───────────────────────────────────────────────

export async function guardarNovedades(formData: FormData) {
  const user = await requireSection("empleados");
  const mes = String(formData.get("mes") ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) volverConError("/empleados", "Mes inválido");
  const back = `/empleados?mes=${mes}`;
  const personas = new Map((await getPersonas()).map((p) => [p.id, p]));
  const ids = formData.getAll("persona").map(String);
  const filas = [];
  const fichas: { id: string; patch: Partial<Persona> }[] = [];
  for (const id of ids) {
    const p = personas.get(id);
    if (!uuid.safeParse(id).success || !p) volverConError(back, "Empleado inválido");
    const f = (k: string) => formData.get(`${id}:${k}`);
    const nums: Record<string, number | null> = {};
    for (const k of ["monto", "comisiones", "valor_hora", "aumento", "bono"]) {
      const n = monto(f(k));
      if (n === "error") volverConError(back, `${p.full_name || p.name}: revisá el número de "${k.replace("_", " ")}"`);
      nums[k] = n;
    }
    const horas = Number(f("horas") || 0);
    const minutos = Number(f("minutos") || 0);
    if (!Number.isInteger(horas) || horas < 0 || horas > 744 || !Number.isInteger(minutos) || minutos < 0 || minutos > 59)
      volverConError(back, `${p.full_name || p.name}: revisá las horas trabajadas`);
    const base = {
      base_amount: nums.monto,
      commissions: p.pay_scheme === "FIJO_COMISION" ? nums.comisiones : null,
      minutes_worked: p.pay_scheme === "POR_HORA" && horas * 60 + minutos > 0 ? horas * 60 + minutos : null,
      hourly_rate: p.pay_scheme === "POR_HORA" ? nums.valor_hora : null,
    };
    filas.push({
      employee_id: id,
      period: `${mes}-01`,
      ...base,
      total: calcularTotal(p.pay_scheme, base),
      report_amount: f("informar") === "si",
      raise_pct: nums.aumento || null,
      bonus: nums.bono || null,
      aguinaldo: f("aguinaldo") === "si",
      no_presentismo: f("presentismo") === "si",
      pending: f("pendiente") === "si",
      notes: String(f("notas") ?? "").trim() || null,
      updated_by: user.alias,
      updated_at: new Date().toISOString(),
    });
    // el mes actual (o uno futuro) deja el monto como el vigente de la ficha: el mes siguiente se precarga con eso
    if (`${mes}-01` >= hoyAR().slice(0, 8) + "01") {
      const patch: Partial<Persona> = {};
      if (nums.monto !== null && nums.monto !== p.base_amount) patch.base_amount = nums.monto;
      if (p.pay_scheme === "POR_HORA" && nums.valor_hora !== null && nums.valor_hora !== p.hourly_rate) patch.hourly_rate = nums.valor_hora;
      if (Object.keys(patch).length) fichas.push({ id, patch });
    }
  }
  if (filas.length === 0) volverConError(back, "No hay empleados para ese mes");
  const { error } = await db().from("payroll_entries").upsert(filas, { onConflict: "employee_id,period" });
  if (error) volverConError(back, error.message);
  for (const fi of fichas) await db().from("employees").update(fi.patch).eq("id", fi.id);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "payroll:save", entity: "payroll_entries", entity_id: null, detail: { mes, personas: filas.length },
  });
  volverOk(back, "Novedades guardadas. Abajo está el mensaje listo para copiar.");
}

// ── ficha de cada persona ───────────────────────────────────────────

const fichaSchema = z.object({
  nombre_completo: z.string().trim().min(3, "Escribí el nombre y apellido"),
  nombre: z.string().trim().optional(),
  empleador: z.enum(["MARRUDI", "ECP"]),
  esquema: z.enum(["CONVENIO", "EN_MANO", "FIJO_COMISION", "POR_HORA"]),
  ingreso: fecha.or(z.literal("")).optional(),
  egreso: fecha.or(z.literal("")).optional(),
  orden: z.coerce.number().int().min(0).max(999).default(100),
  notas: z.string().trim().optional(),
});

export async function guardarPersona(formData: FormData) {
  const user = await requireSection("empleados");
  const back = "/empleados/personal";
  const idRaw = String(formData.get("id") ?? "");
  const id = uuid.safeParse(idRaw).success ? idRaw : null;
  const parsed = fichaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const base = monto(formData.get("monto"));
  const hora = monto(formData.get("valor_hora"));
  if (base === "error" || hora === "error") volverConError(back, "Revisá los montos");
  if (d.ingreso && d.egreso && d.egreso < d.ingreso) volverConError(back, "La fecha de baja no puede ser anterior al ingreso");
  const fila = {
    name: d.nombre || d.nombre_completo.split(/\s+/)[0],
    full_name: d.nombre_completo,
    employer: d.empleador,
    pay_scheme: d.esquema,
    base_amount: base,
    hourly_rate: hora,
    start_date: d.ingreso || null,
    end_date: d.egreso || null,
    sort_order: d.orden,
    notes: d.notas || null,
    // con la baja ya pasada deja de aparecer en Faltas y Vacaciones (el historial queda)
    active: !(d.egreso && d.egreso < hoyAR()),
  };
  const r = id
    ? await db().from("employees").update(fila).eq("id", id).select("id").single()
    : await db().from("employees").insert(fila).select("id").single();
  if (r.error) volverConError(back, r.error.code === "23505" ? `Ya hay alguien con el nombre corto "${fila.name}": poné otro` : r.error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: id ? "employee:update" : "employee:create", entity: "employees", entity_id: r.data.id,
    detail: { nombre: fila.full_name, empleador: fila.employer, esquema: fila.pay_scheme, ingreso: fila.start_date, egreso: fila.end_date },
  });
  volverOk(back, id ? `${fila.full_name} actualizado` : `${fila.full_name} agregado`);
}
