"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { can, requireSection, requireUser } from "./auth";

function volverConError(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}
function volverOk(path: string, msg: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}

const uuid = z.string().uuid();
const destinoSeguro = (v: FormDataEntryValue | null, def: string) => {
  const s = String(v ?? "");
  return /^\/(preventa|ingresos\/nuevo|compras\/[0-9a-f-]{36})(\?[\w=&%-]*)?$/.test(s) ? s : def;
};

const preventaSchema = z.object({
  cliente: z.string().trim().min(2, "Falta el cliente"),
  pedido: z.string().trim().optional(),
  canal: z.enum(["MAYORISTA", "MINORISTA"]).default("MAYORISTA"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Falta la fecha"),
  notas: z.string().trim().optional(),
});

export async function crearPreventa(formData: FormData) {
  const user = await requireSection("preventa");
  const back = "/preventa";
  const parsed = preventaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const productos = formData.getAll("pv_producto").map(String);
  const cantidades = formData.getAll("pv_cantidad").map(Number);
  const porProducto = new Map<string, number>();
  for (let i = 0; i < productos.length; i++) {
    if (!productos[i]) continue;
    if (!uuid.safeParse(productos[i]).success) volverConError(back, `Producto ${i + 1}: inválido`);
    if (!(cantidades[i] > 0)) volverConError(back, `Producto ${i + 1}: la cantidad debe ser mayor a 0`);
    porProducto.set(productos[i], (porProducto.get(productos[i]) ?? 0) + cantidades[i]);
  }
  if (porProducto.size === 0) volverConError(back, "Agregá al menos un producto");
  const { data: kits } = await db().from("products").select("name").in("id", [...porProducto.keys()]).eq("type", "KIT");
  if (kits?.length) volverConError(back, `"${kits[0].name}" es un kit: por ahora la preventa es de productos sueltos`);

  const { data: pv, error } = await db()
    .from("preorders")
    .insert({ customer: d.cliente, order_ref: d.pedido || null, channel: d.canal, order_date: d.fecha, notes: d.notas || null, created_by: user.alias })
    .select("id")
    .single();
  if (error || !pv) volverConError(back, error?.message ?? "No se pudo crear la preventa");
  const { error: e2 } = await db()
    .from("preorder_lines")
    .insert([...porProducto.entries()].map(([product_id, quantity]) => ({ preorder_id: pv.id, product_id, quantity })));
  if (e2) {
    await db().from("preorders").delete().eq("id", pv.id);
    volverConError(back, e2.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "preorder:create", entity: "preorders", entity_id: pv.id,
    detail: { cliente: d.cliente, pedido: d.pedido || null, productos: porProducto.size },
  });
  volverOk(back, `Preventa de ${d.cliente} cargada`);
}

export async function cancelarPreventa(formData: FormData) {
  const user = await requireSection("preventa");
  const back = "/preventa";
  const id = uuid.safeParse(String(formData.get("preventa") ?? ""));
  if (!id.success) volverConError(back, "Preventa inválida");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) volverConError(back, "Contá por qué se cancela");
  const { data: pv } = await db().from("preorders").select("customer, notes, status").eq("id", id.data).maybeSingle();
  if (!pv) volverConError(back, "Preventa inexistente");
  if (pv.status === "ENTREGADA") volverConError(back, "La preventa ya está entregada");
  const { error } = await db()
    .from("preorders")
    .update({ status: "CANCELADA", notes: [pv.notes, `Cancelada: ${motivo}`].filter(Boolean).join(" · "), updated_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "preorder:cancel", entity: "preorders", entity_id: id.data, detail: { motivo },
  });
  volverOk(back, `Preventa de ${pv.customer} cancelada (lo ya entregado no se toca)`);
}

// entrega: desde el reparto de un ingreso o desde el stock (lo puede hacer quien carga ingresos)
export async function entregarPreventas(formData: FormData) {
  const user = await requireUser();
  const volver = destinoSeguro(formData.get("volver"), "/preventa");
  const back = destinoSeguro(formData.get("back"), "/preventa");
  if (!can(user, "preventa") && !can(user, "ingresos")) volverConError("/", "No tenés permiso para entregar preventas");
  const lineas = formData.getAll("al_line").map(String);
  const cantidades = formData.getAll("al_qty").map((v) => Number(String(v).replace(",", ".")));
  // desde el reparto llegan al_loc / al_lot; desde "entregar desde stock", un select "ubicación|lote"
  const combinados = formData.getAll("al_loc_lot").map(String);
  const ubicaciones = combinados.length ? combinados.map((v) => v.split("|")[0]) : formData.getAll("al_loc").map(String);
  const lotes = combinados.length ? combinados.map((v) => v.split("|")[1] ?? "") : formData.getAll("al_lot").map(String);
  const allocs = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!(cantidades[i] > 0)) continue;
    if (!uuid.safeParse(lineas[i]).success || !uuid.safeParse(ubicaciones[i]).success) volverConError(back, "Reparto inválido");
    allocs.push({ line_id: lineas[i], quantity: cantidades[i], lot_id: lotes[i] || null, location_id: ubicaciones[i] });
  }
  if (allocs.length === 0) volverConError(back, "No pusiste ninguna cantidad para entregar");
  const entry = uuid.safeParse(String(formData.get("ingreso") ?? ""));
  const { data, error } = await db().rpc("fulfill_preorders", {
    p_allocs: allocs,
    p_entry: entry.success ? entry.data : null,
    p_actor: user.alias,
    p_idem: String(formData.get("idem") ?? "") || null,
  });
  if (error) volverConError(back, error.message);
  volverOk(volver, `${data ?? allocs.length} entrega(s) de preventa registrada(s) como venta`);
}
