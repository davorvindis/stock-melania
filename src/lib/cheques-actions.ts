"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";
import { mismaFechaEnMeses } from "./cheques";

const BASE = "/cheques";

function volver(back: string, tipo: "ok" | "error", msg: string): never {
  const destino = back.startsWith(BASE) ? back : BASE;
  revalidatePath(BASE);
  redirect(`${destino}${destino.includes("?") ? "&" : "?"}${tipo}=${encodeURIComponent(msg)}`);
}

// importe en formato argentino: "14.487.330,50" o "14487330.5"
function leerImporte(v: FormDataEntryValue | null): number {
  let s = String(v ?? "").trim().replace(/\$|\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const datosSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Falta la fecha de vencimiento"),
  proveedor: z.string().trim(),
  beneficiario: z.string().trim().optional(),
  concepto: z.string().trim().min(2, "Falta el concepto"),
  estado: z.enum(["PENDIENTE", "PROPUESTO", "PAGADO", "ANULADO"]),
  banco: z.string().trim().optional(),
  numero: z.string().trim().optional(),
  notas: z.string().trim().optional(),
});

async function leerDatos(formData: FormData, back: string) {
  const p = datosSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) volver(back, "error", p.error.issues[0].message);
  const d = p.data;
  const importe = leerImporte(formData.get("importe"));
  if (!(importe > 0)) volver(back, "error", "El importe tiene que ser mayor a 0");
  let supplier_id: string | null = null;
  let payee: string | null = null;
  if (d.proveedor && d.proveedor !== "otro") {
    if (!z.string().uuid().safeParse(d.proveedor).success) volver(back, "error", "Proveedor inválido");
    const { data } = await db().from("suppliers").select("id").eq("id", d.proveedor).maybeSingle();
    if (!data) volver(back, "error", "Proveedor inexistente");
    supplier_id = d.proveedor;
  } else {
    payee = d.beneficiario || null;
    if (!payee) volver(back, "error", "Elegí el proveedor o escribí a quién es el cheque");
  }
  return {
    due_date: d.fecha,
    supplier_id,
    payee,
    concept: d.concepto,
    amount: importe,
    status: d.estado,
    bank: d.banco || null,
    number: d.numero || null,
    notes: d.notas || null,
  };
}

export async function crearCheque(formData: FormData) {
  const user = await requireSection("cheques");
  const back = String(formData.get("back") ?? BASE);
  const datos = await leerDatos(formData, back);
  if (datos.status === "ANULADO") volver(back, "error", "Un cheque nuevo no puede estar anulado");
  const cantidad = Math.trunc(Number(formData.get("cantidad") ?? 1));
  if (!(cantidad >= 1 && cantidad <= 24)) volver(back, "error", "La cantidad de cheques va de 1 a 24");

  const filas = Array.from({ length: cantidad }, (_, i) => ({
    ...datos,
    due_date: mismaFechaEnMeses(datos.due_date, i),
    // si son varios, cada uno lleva su cuota en el concepto
    concept: cantidad > 1 ? `${datos.concept} (${i + 1}/${cantidad})` : datos.concept,
    paid_at: datos.status === "PAGADO" ? new Date().toISOString() : null,
    created_by: user.alias,
  }));
  const { data, error } = await db().from("cheques").insert(filas).select("id");
  if (error) volver(back, "error", error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "cheque:create", entity: "cheques", entity_id: data?.[0]?.id ?? null,
    detail: { cantidad, desde: datos.due_date, concepto: datos.concept, importe: datos.amount, estado: datos.status },
  });
  volver(back, "ok", cantidad > 1 ? `${cantidad} cheques cargados, uno por mes.` : "Cheque cargado.");
}

export async function editarCheque(formData: FormData) {
  const user = await requireSection("cheques");
  const back = String(formData.get("back") ?? BASE);
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) volver(back, "error", "Cheque inválido");
  const antes = await db().from("cheques").select("*").eq("id", id).maybeSingle();
  if (!antes.data) volver(back, "error", "Cheque inexistente");
  const datos = await leerDatos(formData, back);
  const paid_at =
    datos.status === "PAGADO" ? (antes.data.paid_at ?? new Date().toISOString()) : null;
  const { error } = await db()
    .from("cheques")
    .update({ ...datos, paid_at, updated_by: user.alias, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) volver(back, "error", error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "cheque:update", entity: "cheques", entity_id: id,
    detail: {
      antes: { fecha: antes.data.due_date, importe: Number(antes.data.amount), estado: antes.data.status, concepto: antes.data.concept },
      despues: { fecha: datos.due_date, importe: datos.amount, estado: datos.status, concepto: datos.concept },
    },
  });
  volver(back.replace(/[?&]editar=[^&]*/, ""), "ok", "Cheque actualizado.");
}

// botones rápidos: Pagado (se debitó), Anular, Volver a pendiente
export async function cambiarEstadoCheque(formData: FormData) {
  const user = await requireSection("cheques");
  const back = String(formData.get("back") ?? BASE);
  const id = String(formData.get("id") ?? "");
  const estado = String(formData.get("estado") ?? "");
  if (!z.string().uuid().safeParse(id).success) volver(back, "error", "Cheque inválido");
  if (!["PENDIENTE", "PAGADO", "ANULADO"].includes(estado)) volver(back, "error", "Estado inválido");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (estado === "ANULADO" && motivo.length < 3) volver(back, "error", "Contá por qué se anula el cheque");
  const antes = await db().from("cheques").select("status, notes").eq("id", id).maybeSingle();
  if (!antes.data) volver(back, "error", "Cheque inexistente");
  const notes =
    estado === "ANULADO" ? [antes.data.notes, `Anulado: ${motivo}`].filter(Boolean).join(" · ") : antes.data.notes;
  const { error } = await db()
    .from("cheques")
    .update({
      status: estado,
      notes,
      paid_at: estado === "PAGADO" ? new Date().toISOString() : null,
      updated_by: user.alias,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) volver(back, "error", error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "cheque:status", entity: "cheques", entity_id: id,
    detail: { antes: antes.data.status, despues: estado, motivo: motivo || null },
  });
  const msg = { PAGADO: "Marcado como pagado.", ANULADO: "Cheque anulado (no cuenta en los totales).", PENDIENTE: "Volvió a pendiente." }[estado];
  volver(back, "ok", msg ?? "Listo.");
}
