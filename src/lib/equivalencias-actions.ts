"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";

function volverConError(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}
function volverOk(path: string, msg: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}

const uuid = z.string().uuid();
const schema = z.object({
  id: z.string().optional(),
  sku: z
    .string()
    .trim()
    .min(1, "Falta el SKU de Wix")
    .max(40, "Wix admite SKU de hasta 40 caracteres")
    .regex(/^\S+$/, "El SKU no puede tener espacios"),
  nombre: z.string().trim().optional(),
  opcion: z.string().trim().optional(),
  notas: z.string().trim().optional(),
});

// crea o edita una equivalencia (SKU de Wix + productos y cantidades que descuenta)
export async function guardarEquivalencia(formData: FormData) {
  const user = await requireSection("wix");
  const idRaw = String(formData.get("id") ?? "");
  const id = uuid.safeParse(idRaw).success ? idRaw : null;
  const back = id ? `/equivalencias/${id}` : "/equivalencias";
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;

  const productos = formData.getAll("eq_producto").map(String);
  const cantidades = formData.getAll("eq_cantidad").map(Number);
  const lineas: { product_id: string; quantity: number }[] = [];
  for (let i = 0; i < productos.length; i++) {
    if (!productos[i]) continue;
    if (!uuid.safeParse(productos[i]).success) volverConError(back, `Producto ${i + 1}: inválido`);
    if (!(cantidades[i] > 0)) volverConError(back, `Producto ${i + 1}: la cantidad debe ser mayor a 0`);
    lineas.push({ product_id: productos[i], quantity: cantidades[i] });
  }
  if (lineas.length === 0) volverConError(back, "Agregá al menos un producto a descontar");

  const { data, error } = await db().rpc("save_channel_sku", {
    p_id: id,
    p_channel: "WIX",
    p_sku: d.sku,
    p_label: d.nombre || null,
    p_option: d.opcion || null,
    p_active: formData.get("activa") !== "no",
    p_notes: d.notas || null,
    p_lines: lineas,
    p_actor: user.alias,
  });
  if (error) volverConError(back, error.message);
  // los MAYORISTA (marcadores internos de Wix) no reciben stock
  await db().from("channel_skus").update({ publish_stock: formData.get("publicar") === "si" }).eq("id", data as string);
  volverOk(id ? `/equivalencias/${id}` : `/equivalencias?q=${encodeURIComponent(d.sku)}`, id ? "Equivalencia actualizada" : `Equivalencia ${d.sku} creada`);
  return data;
}

// activar / desactivar sin borrar (si se desactiva, las ventas de ese SKU no descuentan)
export async function cambiarEstadoEquivalencia(formData: FormData) {
  const user = await requireSection("wix");
  const id = uuid.safeParse(String(formData.get("id") ?? ""));
  if (!id.success) volverConError("/equivalencias", "Equivalencia inválida");
  const activa = formData.get("activa") === "si";
  const { error } = await db()
    .from("channel_skus")
    .update({ active: activa, updated_by: user.alias, updated_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) volverConError(`/equivalencias/${id.data}`, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias,
    action: activa ? "channel_sku:activate" : "channel_sku:deactivate",
    entity: "channel_skus",
    entity_id: id.data,
  });
  volverOk(`/equivalencias/${id.data}`, activa ? "Equivalencia activada" : "Equivalencia desactivada: las ventas de ese SKU no van a descontar");
}
