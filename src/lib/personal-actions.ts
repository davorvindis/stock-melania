"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";
import { BUCKET_CERTIFICADOS, diasCorridos } from "./personal";

function volverConError(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}
function volverOk(path: string, msg: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}

const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const MAX_ARCHIVO = 4 * 1024 * 1024;
const TIPOS_ARCHIVO: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

async function subirCertificado(archivo: FormDataEntryValue | null, back: string): Promise<string | null> {
  if (!(archivo instanceof File) || archivo.size === 0) return null;
  if (archivo.size > MAX_ARCHIVO) volverConError(back, "El certificado no puede superar 4 MB (sacá la foto con menos calidad o pasalo a PDF)");
  const ext = TIPOS_ARCHIVO[archivo.type];
  if (!ext) volverConError(back, "El certificado tiene que ser PDF o imagen (JPG, PNG, HEIC)");
  const { data: bucket } = await db().storage.getBucket(BUCKET_CERTIFICADOS);
  if (!bucket) await db().storage.createBucket(BUCKET_CERTIFICADOS, { public: false });
  const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  const { error } = await db()
    .storage.from(BUCKET_CERTIFICADOS)
    .upload(path, Buffer.from(await archivo.arrayBuffer()), { contentType: archivo.type });
  if (error) volverConError(back, `No se pudo subir el certificado: ${error.message}`);
  return path;
}

// ── Faltas y horas ──────────────────────────────────────────────────

const registroSchema = z.object({
  empleado: uuid,
  fecha,
  tipo: z.enum(["FALTA", "LLEGADA_TARDE", "SALIDA_ANTICIPADA", "TURNO_MEDICO", "HORAS_A_FAVOR", "RECUPERO", "SALDO_INICIAL", "OTRO"]),
  motivo: z.string().trim().optional(),
  horario: z.string().trim().optional(),
  certificado: z.enum(["SI", "NO", "NO_CORRESPONDE", ""]).optional(),
  efecto: z.enum(["DEBE", "A_FAVOR", "NINGUNO"]),
  horas: z.coerce.number().int().min(0).max(999).default(0),
  minutos: z.coerce.number().int().min(0).max(59).default(0),
  notas: z.string().trim().optional(),
});

export async function registrarFalta(formData: FormData) {
  const user = await requireSection("faltas");
  const back = "/faltas";
  const parsed = registroSchema.safeParse({
    ...Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")),
  });
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const total = d.horas * 60 + d.minutos;
  if (d.efecto !== "NINGUNO" && total === 0) volverConError(back, "Indicá cuántas horas o minutos debe o tiene a favor");
  const minutos = d.efecto === "DEBE" ? -total : d.efecto === "A_FAVOR" ? total : 0;
  const path = await subirCertificado(formData.get("archivo"), back);

  const { data, error } = await db()
    .from("time_records")
    .insert({
      employee_id: d.empleado,
      record_date: d.fecha,
      kind: d.tipo,
      reason: d.motivo || null,
      schedule: d.horario || null,
      certificate: d.certificado || (path ? "SI" : null),
      certificate_path: path,
      minutes: minutos,
      notes: d.notas || null,
      created_by: user.alias,
    })
    .select("id")
    .single();
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "time_record:create", entity: "time_records", entity_id: data?.id ?? null,
    detail: { fecha: d.fecha, tipo: d.tipo, minutos, certificado: !!path },
  });
  volverOk(back, "Registro guardado");
}

export async function adjuntarCertificado(formData: FormData) {
  const user = await requireSection("faltas");
  const back = "/faltas";
  const id = uuid.safeParse(String(formData.get("registro") ?? ""));
  if (!id.success) volverConError(back, "Registro inválido");
  const path = await subirCertificado(formData.get("archivo"), back);
  if (!path) volverConError(back, "Elegí el archivo del certificado");
  const { error } = await db()
    .from("time_records")
    .update({ certificate_path: path, certificate: "SI", updated_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "time_record:certificate", entity: "time_records", entity_id: id.data,
  });
  volverOk(back, "Certificado adjuntado");
}

export async function eliminarRegistro(formData: FormData) {
  const user = await requireSection("faltas");
  const back = "/faltas";
  const id = uuid.safeParse(String(formData.get("registro") ?? ""));
  if (!id.success) volverConError(back, "Registro inválido");
  const { data: r } = await db().from("time_records").select("record_date, kind, minutes, certificate_path").eq("id", id.data).maybeSingle();
  const { error } = await db().from("time_records").delete().eq("id", id.data);
  if (error) volverConError(back, error.message);
  if (r?.certificate_path) await db().storage.from(BUCKET_CERTIFICADOS).remove([r.certificate_path]);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "time_record:delete", entity: "time_records", entity_id: id.data,
    detail: { fecha: r?.record_date, tipo: r?.kind, minutos: r?.minutes },
  });
  volverOk(back, "Registro eliminado");
}

// ── Vacaciones ──────────────────────────────────────────────────────

const solicitudSchema = z.object({
  empleado: uuid,
  desde: fecha,
  hasta: fecha,
  anio: z.coerce.number().int().min(2020).max(2100),
  notas: z.string().trim().optional(),
});

export async function solicitarVacaciones(formData: FormData) {
  const user = await requireSection("vacaciones");
  const anioForm = String(formData.get("anio") ?? "");
  const back = `/vacaciones?anio=${anioForm}`;
  const parsed = solicitudSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  if (d.hasta < d.desde) volverConError(back, "La fecha de vuelta no puede ser anterior a la de salida");
  const dias = diasCorridos(d.desde, d.hasta);
  // si la carga el admin queda aprobada directamente
  const aprobada = user.role === "ADMIN";
  const { data, error } = await db()
    .from("vacation_requests")
    .insert({
      employee_id: d.empleado,
      year: d.anio,
      start_date: d.desde,
      end_date: d.hasta,
      days: dias,
      notes: d.notas || null,
      requested_by: user.alias,
      status: aprobada ? "APROBADA" : "PENDIENTE",
      decided_by: aprobada ? user.alias : null,
      decided_at: aprobada ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "vacation:request", entity: "vacation_requests", entity_id: data?.id ?? null,
    detail: { desde: d.desde, hasta: d.hasta, dias, anio: d.anio, aprobada },
  });
  volverOk(back, aprobada ? `Vacaciones cargadas y aprobadas (${dias} días)` : `Solicitud cargada (${dias} días): queda pendiente de aprobación`);
}

// aprobar / rechazar / modificar fechas y aprobar — solo ADMIN
export async function decidirVacaciones(formData: FormData) {
  const user = await requireSection("vacaciones");
  const anioForm = String(formData.get("anio") ?? "");
  const back = `/vacaciones?anio=${anioForm}`;
  if (user.role !== "ADMIN") volverConError(back, "Solo un administrador puede aprobar vacaciones");
  const id = uuid.safeParse(String(formData.get("solicitud") ?? ""));
  if (!id.success) volverConError(back, "Solicitud inválida");
  const decision = String(formData.get("decision") ?? "");
  const nota = String(formData.get("nota") ?? "").trim() || null;
  const cambios: Record<string, unknown> = {
    decided_by: user.alias,
    decided_at: new Date().toISOString(),
    decision_note: nota,
  };
  if (decision === "rechazar") {
    if (!nota) volverConError(back, "Contá el motivo del rechazo");
    cambios.status = "RECHAZADA";
  } else if (decision === "aprobar") {
    cambios.status = "APROBADA";
    const desde = String(formData.get("desde") ?? "");
    const hasta = String(formData.get("hasta") ?? "");
    if (desde || hasta) {
      if (!fecha.safeParse(desde).success || !fecha.safeParse(hasta).success || hasta < desde) {
        volverConError(back, "Fechas inválidas");
      }
      cambios.start_date = desde;
      cambios.end_date = hasta;
      cambios.days = diasCorridos(desde, hasta);
    }
  } else if (decision === "cancelar") {
    cambios.status = "CANCELADA";
  } else {
    volverConError(back, "Decisión inválida");
  }
  const { error } = await db().from("vacation_requests").update(cambios).eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: `vacation:${decision}`, entity: "vacation_requests", entity_id: id.data,
    detail: { nota, desde: cambios.start_date ?? null, hasta: cambios.end_date ?? null },
  });
  const msg = decision === "rechazar" ? "Solicitud rechazada" : decision === "cancelar" ? "Vacaciones canceladas" : "Vacaciones aprobadas";
  volverOk(back, msg);
}

// quien la cargó (o el admin) puede retirar una solicitud que todavía no se aprobó
export async function retirarSolicitud(formData: FormData) {
  const user = await requireSection("vacaciones");
  const anioForm = String(formData.get("anio") ?? "");
  const back = `/vacaciones?anio=${anioForm}`;
  const id = uuid.safeParse(String(formData.get("solicitud") ?? ""));
  if (!id.success) volverConError(back, "Solicitud inválida");
  const { data: s } = await db().from("vacation_requests").select("status").eq("id", id.data).maybeSingle();
  if (s?.status !== "PENDIENTE") volverConError(back, "Solo se puede retirar una solicitud pendiente");
  const { error } = await db().from("vacation_requests").update({ status: "CANCELADA" }).eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "vacation:withdraw", entity: "vacation_requests", entity_id: id.data,
  });
  volverOk(back, "Solicitud retirada");
}

// días que le corresponden a cada uno en el año — solo ADMIN
export async function guardarDiasVacaciones(formData: FormData) {
  const user = await requireSection("vacaciones");
  const anio = Number(formData.get("anio"));
  const back = `/vacaciones?anio=${anio}`;
  if (user.role !== "ADMIN") volverConError(back, "Solo un administrador define los días de vacaciones");
  if (!(anio >= 2020 && anio <= 2100)) volverConError("/vacaciones", "Año inválido");
  const filas = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("dias_")) continue;
    const emp = k.slice(5);
    const s = String(v).trim();
    if (!uuid.safeParse(emp).success) continue;
    if (!s) {
      await db().from("vacation_allowances").delete().eq("employee_id", emp).eq("year", anio);
      continue;
    }
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n > 60) volverConError(back, "Los días tienen que ser un número entero entre 0 y 60");
    filas.push({ employee_id: emp, year: anio, days: n, updated_by: user.alias, updated_at: new Date().toISOString() });
  }
  if (filas.length) {
    const { error } = await db().from("vacation_allowances").upsert(filas, { onConflict: "employee_id,year" });
    if (error) volverConError(back, error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "vacation:allowance", entity: "vacation_allowances", entity_id: null,
    detail: { anio, personas: filas.length },
  });
  volverOk(back, "Días de vacaciones guardados");
}

// ── Empleados ───────────────────────────────────────────────────────

export async function crearEmpleado(formData: FormData) {
  const user = await requireSection("faltas");
  const back = "/faltas";
  const nombre = String(formData.get("nombre") ?? "").trim();
  if (nombre.length < 2) volverConError(back, "Escribí el nombre del empleado");
  const { data, error } = await db().from("employees").insert({ name: nombre }).select("id").single();
  if (error) volverConError(back, error.code === "23505" ? `Ya existe un empleado llamado ${nombre}` : error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "employee:create", entity: "employees", entity_id: data?.id ?? null, detail: { nombre },
  });
  volverOk(back, `${nombre} agregado al equipo`);
}

// si tiene historial se da de baja (queda guardado); si no, se elimina
export async function bajaEmpleado(formData: FormData) {
  const user = await requireSection("faltas");
  const back = "/faltas";
  const id = uuid.safeParse(String(formData.get("empleado") ?? ""));
  if (!id.success) volverConError(back, "Empleado inválido");
  const { data: emp } = await db().from("employees").select("name").eq("id", id.data).maybeSingle();
  if (!emp) volverConError(back, "Empleado inexistente");
  const [{ count: r }, { count: v }, { count: a }] = await Promise.all([
    db().from("time_records").select("id", { count: "exact", head: true }).eq("employee_id", id.data),
    db().from("vacation_requests").select("id", { count: "exact", head: true }).eq("employee_id", id.data),
    db().from("vacation_allowances").select("employee_id", { count: "exact", head: true }).eq("employee_id", id.data),
  ]);
  const conHistorial = (r ?? 0) + (v ?? 0) + (a ?? 0) > 0;
  const { error } = conHistorial
    ? await db().from("employees").update({ active: false }).eq("id", id.data)
    : await db().from("employees").delete().eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: conHistorial ? "employee:deactivate" : "employee:delete", entity: "employees",
    entity_id: id.data, detail: { nombre: emp.name },
  });
  volverOk(back, conHistorial ? `${emp.name} dado de baja (su historial queda guardado)` : `${emp.name} eliminado`);
}

export async function reactivarEmpleado(formData: FormData) {
  const user = await requireSection("faltas");
  const back = "/faltas";
  const id = uuid.safeParse(String(formData.get("empleado") ?? ""));
  if (!id.success) volverConError(back, "Empleado inválido");
  const { error } = await db().from("employees").update({ active: true }).eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "employee:reactivate", entity: "employees", entity_id: id.data,
  });
  volverOk(back, "Empleado reactivado");
}
