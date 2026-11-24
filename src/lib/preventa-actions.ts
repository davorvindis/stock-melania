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

// montos en pesos: vacío = sin cargar; acepta "1500000", "1500000.50" o "1.500.000,50"
function monto(v: FormDataEntryValue | null): number | null | "invalido" {
  let t = String(v ?? "").trim().replace(/\$|\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : "invalido";
}
const MEDIOS = ["TRANSFERENCIA", "EFECTIVO", "MERCADO_PAGO", "OTRO"] as const;

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
  const total = monto(formData.get("total"));
  if (total === "invalido") volverConError(back, "El total no es un monto válido");
  const abonado = monto(formData.get("abonado"));
  if (abonado === "invalido") volverConError(back, "El monto abonado no es válido");
  const medio = String(formData.get("medio") ?? "");
  if (abonado && !MEDIOS.includes(medio as (typeof MEDIOS)[number])) volverConError(back, "Elegí el medio de pago");

  const { data: pv, error } = await db()
    .from("preorders")
    .insert({ customer: d.cliente, order_ref: d.pedido || null, channel: d.canal, order_date: d.fecha, notes: d.notas || null, created_by: user.alias, total_amount: total })
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
    detail: { cliente: d.cliente, pedido: d.pedido || null, productos: porProducto.size, total, abonado },
  });
  if (abonado) {
    const { data: pago, error: e3 } = await db()
      .from("preorder_payments")
      .insert({ preorder_id: pv.id, paid_on: d.fecha, amount: abonado, method: medio, created_by: user.alias })
      .select("id")
      .single();
    if (e3 || !pago) volverConError(back, `La preventa se cargó pero el pago no: ${e3?.message ?? ""}. Cargalo desde la preventa.`);
    await db().from("audit_logs").insert({
      actor: user.alias, action: "preorder:payment", entity: "preorder_payments", entity_id: pago.id,
      detail: { preventa: pv.id, cliente: d.cliente, monto: abonado, medio },
    });
  }
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

// editar una preventa abierta: datos, cantidades (no menos de lo entregado; 0 = quitar) y productos nuevos
export async function editarPreventa(formData: FormData) {
  const user = await requireSection("preventa");
  const back = "/preventa";
  const id = uuid.safeParse(String(formData.get("preventa") ?? ""));
  if (!id.success) volverConError(back, "Preventa inválida");
  const parsed = preventaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;

  const lineasIds = formData.getAll("ed_line").map(String);
  const lineasQty = formData.getAll("ed_qty").map((v) => Number(String(v).replace(",", ".")));
  const lineas = [];
  for (let i = 0; i < lineasIds.length; i++) {
    if (!uuid.safeParse(lineasIds[i]).success) volverConError(back, "Línea inválida");
    if (!(lineasQty[i] >= 0)) volverConError(back, `Producto ${i + 1}: la cantidad tiene que ser 0 o más`);
    lineas.push({ line_id: lineasIds[i], quantity: lineasQty[i] });
  }
  const productos = formData.getAll("pv_producto").map(String);
  const cantidades = formData.getAll("pv_cantidad").map((v) => Number(String(v).replace(",", ".")));
  const nuevas = [];
  for (let i = 0; i < productos.length; i++) {
    if (!productos[i] && !cantidades[i]) continue;
    if (!uuid.safeParse(productos[i]).success) volverConError(back, `Producto nuevo ${i + 1}: elegilo de la lista`);
    if (!(cantidades[i] > 0)) volverConError(back, `Producto nuevo ${i + 1}: la cantidad debe ser mayor a 0`);
    nuevas.push({ product_id: productos[i], quantity: cantidades[i] });
  }

  const { error } = await db().rpc("edit_preorder", {
    p_id: id.data,
    p_datos: { customer: d.cliente, order_ref: d.pedido ?? "", channel: d.canal, order_date: d.fecha, notes: d.notas ?? "" },
    p_lineas: lineas,
    p_nuevas: nuevas,
    p_actor: user.alias,
  });
  if (error) volverConError(back, error.message);

  const total = monto(formData.get("total"));
  if (total === "invalido") volverConError(back, "Se guardaron los cambios, pero el total no es un monto válido");
  const { data: antes } = await db().from("preorders").select("total_amount").eq("id", id.data).single();
  const totalAntes = antes?.total_amount === null || antes?.total_amount === undefined ? null : Number(antes.total_amount);
  if (totalAntes !== total) {
    const { error: e2 } = await db().from("preorders").update({ total_amount: total, updated_at: new Date().toISOString() }).eq("id", id.data);
    if (e2) volverConError(back, e2.message);
    await db().from("audit_logs").insert({
      actor: user.alias, action: "preorder:total", entity: "preorders", entity_id: id.data, detail: { antes: totalAntes, ahora: total },
    });
  }
  volverOk(back, `Preventa de ${d.cliente} actualizada`);
}

// pago del cliente (seña, resto...): no mueve stock, sirve para el comprobante
export async function registrarPagoPreventa(formData: FormData) {
  const user = await requireSection("preventa");
  const back = "/preventa";
  const id = uuid.safeParse(String(formData.get("preventa") ?? ""));
  if (!id.success) volverConError(back, "Preventa inválida");
  const importe = monto(formData.get("monto"));
  if (importe === "invalido" || !importe) volverConError(back, "Poné el monto abonado (mayor a 0)");
  const medio = String(formData.get("medio") ?? "");
  if (!MEDIOS.includes(medio as (typeof MEDIOS)[number])) volverConError(back, "Elegí el medio de pago");
  const fecha = String(formData.get("fecha") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) volverConError(back, "Falta la fecha del pago");
  const notas = String(formData.get("notas") ?? "").trim() || null;
  const { data: pv } = await db().from("preorders").select("customer, status").eq("id", id.data).maybeSingle();
  if (!pv) volverConError(back, "Preventa inexistente");
  if (pv.status === "CANCELADA") volverConError(back, "La preventa está cancelada");
  const { data: pago, error } = await db()
    .from("preorder_payments")
    .insert({
      preorder_id: id.data, paid_on: fecha, amount: importe, method: medio, notes: notas, created_by: user.alias,
      idempotency_key: String(formData.get("idem") ?? "") || null,
    })
    .select("id")
    .single();
  if (error?.code === "23505") volverOk(back, "Ese pago ya estaba registrado");
  if (error || !pago) volverConError(back, error?.message ?? "No se pudo registrar el pago");
  await db().from("audit_logs").insert({
    actor: user.alias, action: "preorder:payment", entity: "preorder_payments", entity_id: pago.id,
    detail: { preventa: id.data, cliente: pv.customer, monto: importe, medio, fecha, notas },
  });
  volverOk(back, `Pago de ${pv.customer} registrado`);
}

// un pago cargado mal no se borra: se anula con motivo
export async function anularPagoPreventa(formData: FormData) {
  const user = await requireSection("preventa");
  const back = "/preventa";
  const id = uuid.safeParse(String(formData.get("pago") ?? ""));
  if (!id.success) volverConError(back, "Pago inválido");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) volverConError(back, "Contá por qué se anula el pago");
  const { data, error } = await db()
    .from("preorder_payments")
    .update({ voided_at: new Date().toISOString(), voided_by: user.alias, void_reason: motivo })
    .eq("id", id.data)
    .is("voided_at", null)
    .select("amount, preorder_id")
    .maybeSingle();
  if (error) volverConError(back, error.message);
  if (!data) volverConError(back, "Ese pago ya estaba anulado");
  await db().from("audit_logs").insert({
    actor: user.alias, action: "preorder:payment_void", entity: "preorder_payments", entity_id: id.data,
    detail: { preventa: data.preorder_id, monto: data.amount, motivo },
  });
  volverOk(back, "Pago anulado");
}
