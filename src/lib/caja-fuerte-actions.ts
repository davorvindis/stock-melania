"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { can, requireSection } from "./auth";
import { hoyAR } from "./backup";

const BACK = "/caja/fuerte";
function volverConError(msg: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(msg)}`);
}
function volverOk(msg: string): never {
  revalidatePath("/", "layout");
  redirect(`${BACK}?ok=${encodeURIComponent(msg)}`);
}

const schema = z.object({
  tipo: z.enum(["RETIRO", "INGRESO"]),
  alcance: z.enum(["TOTAL", "PARCIAL"]).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Falta la fecha"),
  monto: z.coerce.number().positive("El monto debe ser mayor a 0"),
  moneda: z.enum(["ARS", "USD"]),
  persona: z.string().trim().max(100).optional(),
  notas: z.string().trim().max(500).optional(),
});

// Yura (o un admin) registra un retiro o ingreso de la caja fuerte: queda pendiente de aprobación
export async function registrarMovimientoCF(formData: FormData) {
  const user = await requireSection("caja");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(parsed.error.issues[0].message);
  const d = parsed.data;
  if (d.fecha > hoyAR()) volverConError("La fecha no puede ser futura");
  if (d.tipo === "RETIRO" && !d.persona) volverConError("Indicá quién retiró el dinero");
  const { data, error } = await db()
    .from("cash_vault_movements")
    .insert({
      kind: d.tipo,
      scope: d.tipo === "RETIRO" ? (d.alcance ?? "PARCIAL") : null,
      movement_date: d.fecha,
      amount: d.monto,
      currency: d.moneda,
      person: d.persona || null,
      notes: d.notas || null,
      requested_by: user.alias,
    })
    .select("id")
    .single();
  if (error) volverConError(error.message);
  await db().from("audit_logs").insert({
    actor: user.alias,
    action: d.tipo === "RETIRO" ? "vault:withdrawal" : "vault:deposit",
    entity: "cash_vault_movements",
    entity_id: data.id,
    detail: { monto: d.monto, moneda: d.moneda, fecha: d.fecha, alcance: d.alcance, persona: d.persona },
  });
  volverOk(`${d.tipo === "RETIRO" ? "Retiro" : "Ingreso"} registrado: queda pendiente de aprobación de Joel o Mel`);
}

// Joel o Mel aprueban / rechazan
export async function revisarMovimientoCF(formData: FormData) {
  const user = await requireSection("caja");
  if (user.role !== "ADMIN" || !can(user, "caja")) volverConError("Solo Joel o Mel pueden aprobar");
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) volverConError("Movimiento inválido");
  const aprobar = formData.get("decision") === "aprobar";
  const { error } = await db().rpc("review_vault_movement", {
    p_id: id.data,
    p_approve: aprobar,
    p_actor: user.alias,
    p_note: String(formData.get("nota") ?? ""),
  });
  if (error) volverConError(error.message);
  volverOk(aprobar ? "Aprobado: el saldo de la caja fuerte se actualizó" : "Rechazado: no cambia el saldo");
}
