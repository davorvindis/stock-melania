"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";
import { getCambios, vigenteEn } from "./precios";

function volverConError(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}
function volverOk(path: string, msg: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}

const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const num = (v: FormDataEntryValue | null | undefined) => {
  // "19.300,50" (formato argentino) o "19300.5" (input numérico)
  const raw = String(v ?? "").trim();
  const s = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

// actualización de precios: solo guarda los que cambiaron, todos con la misma fecha y "tanda"
export async function actualizarPrecios(formData: FormData) {
  const user = await requireSection("precios");
  const back = "/precios?vista=actualizar";
  const f = fecha.safeParse(String(formData.get("fecha") ?? ""));
  if (!f.success) volverConError(back, "Elegí desde qué fecha rigen los precios nuevos");
  const nota = String(formData.get("nota") ?? "").trim() || null;
  const ids = formData.getAll("item").map(String);
  const listas = formData.getAll("lista");
  const ofertas = formData.getAll("oferta");
  const sinOferta = new Set(formData.getAll("sin_oferta").map(String));

  const cambios = await getCambios();
  const batch = randomUUID();
  const filas: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!uuid.safeParse(ids[i]).success) continue;
    const delItem = cambios.filter((c) => c.item_id === ids[i]);
    const lista = num(listas[i]);
    if (lista !== null) {
      if (!(lista >= 0)) volverConError(back, "Hay un precio inválido");
      if (lista !== vigenteEn(delItem, "LISTA", f.data)) {
        filas.push({ item_id: ids[i], channel: "LISTA", price: lista, effective_date: f.data, batch_id: batch, note: nota, created_by: user.alias });
      }
    }
    const ofertaActual = vigenteEn(delItem, "OFERTA", f.data);
    if (sinOferta.has(ids[i])) {
      if (ofertaActual != null) {
        filas.push({ item_id: ids[i], channel: "OFERTA", price: null, effective_date: f.data, batch_id: batch, note: nota, created_by: user.alias });
      }
    } else {
      const oferta = num(ofertas[i]);
      if (oferta !== null) {
        if (!(oferta >= 0)) volverConError(back, "Hay un precio de oferta inválido");
        if (oferta !== ofertaActual) {
          filas.push({ item_id: ids[i], channel: "OFERTA", price: oferta, effective_date: f.data, batch_id: batch, note: nota, created_by: user.alias });
        }
      }
    }
  }
  if (filas.length === 0) volverConError(back, "No cambiaste ningún precio");
  const { error } = await db().from("price_changes").insert(filas);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "price:update", entity: "price_changes", entity_id: batch,
    detail: { fecha: f.data, cambios: filas.length, nota },
  });
  volverOk("/precios?vista=historial", `${filas.length} precio(s) actualizado(s) desde el ${f.data.split("-").reverse().join("/")}`);
}

// alta / edición de un producto de la lista de precios
const itemSchema = z.object({
  item: z.string().optional(),
  nombre: z.string().trim().min(2, "Falta el nombre"),
  categoria: z.string().trim().min(1),
  producto: z.string().optional(),
  slug: z.string().trim().optional(),
  max_desc: z.string().optional(),
  notas: z.string().trim().optional(),
});

export async function guardarItemPrecio(formData: FormData) {
  const user = await requireSection("precios");
  const back = "/precios";
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const maxDesc = num(d.max_desc);
  if (maxDesc !== null && !(maxDesc >= 0 && maxDesc <= 100)) volverConError(back, "El tope de descuento va de 0 a 100");
  const fila = {
    name: d.nombre,
    category: d.categoria,
    product_id: d.producto && uuid.safeParse(d.producto).success ? d.producto : null,
    web_slug: d.slug || null,
    wholesale: formData.get("mayorista") === "on",
    wholesale_max_discount: maxDesc,
    active: formData.get("activo") !== "off",
    notes: d.notas || null,
  };
  const id = d.item && uuid.safeParse(d.item).success ? d.item : null;
  let itemId = id;
  if (id) {
    const { error } = await db().from("price_items").update(fila).eq("id", id);
    if (error) volverConError(back, error.code === "23505" ? "Ya hay otro producto con ese nombre" : error.message);
  } else {
    const { data, error } = await db().from("price_items").insert(fila).select("id").single();
    if (error || !data) volverConError(back, error?.code === "23505" ? "Ya hay un producto con ese nombre" : (error?.message ?? "Error"));
    itemId = data.id;
    const precio = num(formData.get("precio_inicial"));
    const desde = fecha.safeParse(String(formData.get("fecha_inicial") ?? ""));
    if (precio !== null && precio >= 0 && desde.success) {
      await db().from("price_changes").insert({
        item_id: itemId, channel: "LISTA", price: precio, effective_date: desde.data, note: "Precio inicial", created_by: user.alias,
      });
    }
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: id ? "price_item:update" : "price_item:create", entity: "price_items", entity_id: itemId,
    detail: { nombre: d.nombre },
  });
  volverOk(back, id ? "Producto actualizado" : `${d.nombre} agregado a la lista de precios`);
}

// borrar un cambio cargado por error (no toca los demás)
export async function eliminarCambioPrecio(formData: FormData) {
  const user = await requireSection("precios");
  const back = "/precios?vista=historial";
  const id = uuid.safeParse(String(formData.get("cambio") ?? ""));
  if (!id.success) volverConError(back, "Cambio inválido");
  const { data: c } = await db().from("price_changes").select("item_id, channel, price, effective_date").eq("id", id.data).maybeSingle();
  const { error } = await db().from("price_changes").delete().eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "price:delete", entity: "price_changes", entity_id: id.data, detail: c ?? {},
  });
  volverOk(back, "Cambio de precio eliminado");
}

export async function guardarCondicionesMayoristas(formData: FormData) {
  const user = await requireSection("precios");
  const back = "/precios";
  const f = fecha.safeParse(String(formData.get("fecha") ?? ""));
  if (!f.success) volverConError(back, "Falta la fecha desde la que rigen");
  const m20 = num(formData.get("min_20"));
  const m30 = num(formData.get("min_30"));
  const m40 = num(formData.get("min_40"));
  if (!(m20! > 0 && m30! > m20! && m40! > m30!)) volverConError(back, "Los montos tienen que ir de menor a mayor (20% < 30% < 40%)");
  const { error } = await db().from("wholesale_terms").upsert(
    { effective_date: f.data, min_20: m20, min_30: m30, min_40: m40, note: String(formData.get("nota") ?? "").trim() || null, created_by: user.alias },
    { onConflict: "effective_date" }
  );
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "price:wholesale_terms", entity: "wholesale_terms", entity_id: null,
    detail: { fecha: f.data, min_20: m20, min_30: m30, min_40: m40 },
  });
  volverOk(back, "Condiciones mayoristas actualizadas");
}
