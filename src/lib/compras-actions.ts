"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";
import { COMPONENTES, mesSiguiente } from "./compras";

function volverConError(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}
function volverOk(path: string, msg: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}

const uuid = z.string().uuid();
const fechaOpc = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));
const numOpc = (v: FormDataEntryValue | null | undefined) => {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

// ── Órdenes de compra ───────────────────────────────────────────────

const ordenSchema = z.object({
  orden: z.string().optional(),
  proveedor: uuid.or(z.literal("")).refine((v) => v !== "", "Elegí el proveedor"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Falta la fecha de la orden"),
  fecha_estimada: fechaOpc,
  estado: z.enum(["PENDIENTE", "EN_PROCESO", "RECIBIDA_PARCIAL", "RECIBIDA", "CANCELADA"]).default("PENDIENTE"),
  pagado: z.string().optional(),
  notas: z.string().trim().optional(),
});

export async function guardarOrden(formData: FormData) {
  const user = await requireSection("compras");
  const id = String(formData.get("orden") ?? "");
  const back = id ? `/compras/${id}` : "/compras/nueva";
  const parsed = ordenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const pagado = numOpc(d.pagado);
  if (pagado !== null && !(pagado >= 0 && pagado <= 100)) volverConError(back, "El % pagado va de 0 a 100");

  // líneas
  const ids = formData.getAll("oc_linea_id").map(String);
  const prods = formData.getAll("oc_producto").map(String);
  const descs = formData.getAll("oc_desc").map((v) => String(v).trim());
  const cants = formData.getAll("oc_cantidad");
  const unidades = formData.getAll("oc_unidad").map((v) => String(v).trim());
  const tipos = formData.getAll("oc_tipo").map((v) => String(v).trim());
  const costos = formData.getAll("oc_costo");
  const { data: nombres } = await db().from("products").select("id, name").in("id", prods.filter((p) => p));
  const lineas = [];
  for (let i = 0; i < descs.length; i++) {
    const n = i + 1;
    const producto = prods[i] || null;
    if (producto && !uuid.safeParse(producto).success) volverConError(back, `Línea ${n}: producto inválido`);
    const descripcion = descs[i] || nombres?.find((p) => p.id === producto)?.name || "";
    if (!descripcion) continue; // línea vacía
    const cantidad = numOpc(cants[i]);
    if (cantidad !== null && !(cantidad > 0)) volverConError(back, `Línea ${n}: cantidad inválida`);
    const costo = numOpc(costos[i]);
    if (costo !== null && !(costo >= 0)) volverConError(back, `Línea ${n}: costo inválido`);
    lineas.push({
      id: ids[i] && uuid.safeParse(ids[i]).success ? ids[i] : null,
      position: i,
      product_id: producto,
      description: descripcion,
      quantity: cantidad,
      unit: unidades[i] || null,
      kind: tipos[i] || null,
      unit_cost: costo,
    });
  }
  if (lineas.length === 0) volverConError(back, "Agregá al menos un ítem a la orden");

  const cabecera = {
    supplier_id: d.proveedor,
    order_date: d.fecha,
    expected_date: d.fecha_estimada,
    status: d.estado,
    paid_pct: pagado,
    notes: d.notas || null,
    updated_at: new Date().toISOString(),
  };

  let ordenId = id;
  if (id) {
    if (!uuid.safeParse(id).success) volverConError("/compras", "Orden inválida");
    const { error } = await db().from("purchase_orders").update(cabecera).eq("id", id);
    if (error) volverConError(back, error.message);
    // líneas quitadas: solo si no se recibió nada de ellas
    const { data: actuales } = await db().from("purchase_order_lines").select("id, received_qty, description").eq("order_id", id);
    const quedan = new Set(lineas.map((l) => l.id).filter(Boolean));
    const quitar = (actuales ?? []).filter((a) => !quedan.has(a.id));
    const recibida = quitar.find((a) => Number(a.received_qty) > 0);
    if (recibida) volverConError(back, `"${recibida.description}" ya tiene mercadería recibida: no se puede quitar`);
    if (quitar.length) await db().from("purchase_order_lines").delete().in("id", quitar.map((a) => a.id));
  } else {
    const { data, error } = await db()
      .from("purchase_orders")
      .insert({ ...cabecera, created_by: user.alias })
      .select("id")
      .single();
    if (error || !data) volverConError(back, error?.message ?? "No se pudo crear la orden");
    ordenId = data.id;
  }
  for (const l of lineas) {
    const { id: lineaId, ...campos } = l;
    const { error } = lineaId
      ? await db().from("purchase_order_lines").update(campos).eq("id", lineaId).eq("order_id", ordenId)
      : await db().from("purchase_order_lines").insert({ ...campos, order_id: ordenId });
    if (error) volverConError(back, error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: id ? "purchase_order:update" : "purchase_order:create",
    entity: "purchase_orders", entity_id: ordenId, detail: { lineas: lineas.length, estado: d.estado, pagado },
  });
  volverOk(`/compras/${ordenId}`, id ? "Orden actualizada" : "Orden creada");
}

export async function eliminarOrden(formData: FormData) {
  const user = await requireSection("compras");
  const id = uuid.safeParse(String(formData.get("orden") ?? ""));
  if (!id.success) volverConError("/compras", "Orden inválida");
  const back = `/compras/${id.data}`;
  const { count } = await db().from("stock_entries").select("id", { count: "exact", head: true }).eq("purchase_order_id", id.data);
  if (count) volverConError(back, "La orden tiene ingresos registrados: cancelala en vez de eliminarla");
  const { error } = await db().from("purchase_orders").delete().eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "purchase_order:delete", entity: "purchase_orders", entity_id: id.data,
  });
  volverOk("/compras", "Orden eliminada");
}

// ── Seguimiento de envíos de una orden ──────────────────────────────

const envioSchema = z.object({
  orden: uuid,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Falta la fecha del envío"),
  desde: z.string().trim().min(1, "Indicá desde dónde sale"),
  hacia: z.string().trim().min(1, "Indicá hacia dónde va"),
  que: z.string().trim().optional(),
  flete: z.string().trim().optional(),
  costo_flete: z.string().optional(),
  notas: z.string().trim().optional(),
});

export async function registrarEnvio(formData: FormData) {
  const user = await requireSection("compras");
  const orden = String(formData.get("orden") ?? "");
  const back = `/compras/${orden}`;
  const parsed = envioSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) volverConError(uuid.safeParse(orden).success ? back : "/compras", parsed.error.issues[0].message);
  const d = parsed.data;
  if (d.desde.toLowerCase() === d.hacia.toLowerCase()) volverConError(back, "El origen y el destino no pueden ser el mismo");
  const costo = numOpc(d.costo_flete);
  if (costo !== null && !(costo >= 0)) volverConError(back, "Costo de flete inválido");
  const { error } = await db().from("purchase_order_shipments").insert({
    order_id: d.orden,
    ship_date: d.fecha,
    from_place: d.desde,
    to_place: d.hacia,
    description: d.que || null,
    carrier: d.flete || null,
    freight_cost: costo,
    notes: d.notas || null,
    created_by: user.alias,
  });
  if (error) volverConError(back, error.message);
  // primera salida: la orden pasa a "En proceso"
  await db().from("purchase_orders").update({ status: "EN_PROCESO", updated_at: new Date().toISOString() })
    .eq("id", d.orden).eq("status", "PENDIENTE");
  await db().from("audit_logs").insert({
    actor: user.alias, action: "purchase_order:shipment", entity: "purchase_orders", entity_id: d.orden,
    detail: { desde: d.desde, hacia: d.hacia, fecha: d.fecha, flete: d.flete || null, costo },
  });
  volverOk(back, `Envío ${d.desde} → ${d.hacia} registrado`);
}

export async function marcarEnvioEntregado(formData: FormData) {
  const user = await requireSection("compras");
  const envio = uuid.safeParse(String(formData.get("envio") ?? ""));
  const orden = String(formData.get("orden") ?? "");
  const back = `/compras/${orden}`;
  if (!envio.success) volverConError(back, "Envío inválido");
  const fecha = String(formData.get("fecha_entrega") ?? "");
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const { error } = await db().from("purchase_order_shipments")
    .update({ status: "ENTREGADO", delivered_date: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : hoy })
    .eq("id", envio.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "purchase_order:shipment_delivered", entity: "purchase_orders", entity_id: uuid.safeParse(orden).success ? orden : null,
    detail: { envio: envio.data },
  });
  volverOk(back, "Envío marcado como entregado");
}

export async function eliminarEnvio(formData: FormData) {
  const user = await requireSection("compras");
  const envio = uuid.safeParse(String(formData.get("envio") ?? ""));
  const orden = String(formData.get("orden") ?? "");
  const back = `/compras/${orden}`;
  if (!envio.success) volverConError(back, "Envío inválido");
  const { error } = await db().from("purchase_order_shipments").delete().eq("id", envio.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "purchase_order:shipment_delete", entity: "purchase_orders", entity_id: uuid.safeParse(orden).success ? orden : null,
    detail: { envio: envio.data },
  });
  volverOk(back, "Envío eliminado");
}

// ── Costos ──────────────────────────────────────────────────────────

const costoSchema = z.object({
  costo: z.string().optional(),
  periodo: z.string().regex(/^\d{4}-\d{2}-01$/, "Mes inválido"),
  item: z.string().trim().min(1, "Falta el nombre del ítem"),
  producto: z.string().optional(),
  proveedor: z.string().optional(),
  cotizacion: z.string().trim().optional(),
  notas: z.string().trim().optional(),
});

export async function guardarCosto(formData: FormData) {
  const user = await requireSection("costos");
  const parsed = costoSchema.safeParse(Object.fromEntries(formData));
  const periodoForm = String(formData.get("periodo") ?? "");
  const back = `/costos?mes=${periodoForm.slice(0, 7)}`;
  if (!parsed.success) volverConError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const fila: Record<string, unknown> = {
    period: d.periodo,
    item: d.item,
    product_id: d.producto && uuid.safeParse(d.producto).success ? d.producto : null,
    supplier_id: d.proveedor && uuid.safeParse(d.proveedor).success ? d.proveedor : null,
    quote_note: d.cotizacion || null,
    notes: d.notas || null,
    updated_by: user.alias,
    updated_at: new Date().toISOString(),
  };
  for (const [k, label] of COMPONENTES) {
    const v = numOpc(formData.get(k));
    if (v !== null && !(v >= 0)) volverConError(back, `${label}: valor inválido`);
    fila[k] = v;
  }
  const precio = numOpc(formData.get("precio"));
  if (precio !== null && !(precio >= 0)) volverConError(back, "Precio de venta inválido");
  fila.sale_price = precio;

  const id = d.costo && uuid.safeParse(d.costo).success ? d.costo : null;
  const { error } = id
    ? await db().from("product_costs").update(fila).eq("id", id)
    : await db().from("product_costs").insert(fila);
  if (error) {
    volverConError(back, error.code === "23505" ? `"${d.item}" ya existe en este mes` : error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: id ? "cost:update" : "cost:create", entity: "product_costs", entity_id: id,
    detail: { item: d.item, periodo: d.periodo, precio },
  });
  volverOk(back, `Costo de ${d.item} guardado`);
}

export async function eliminarCosto(formData: FormData) {
  const user = await requireSection("costos");
  const id = uuid.safeParse(String(formData.get("costo") ?? ""));
  const periodo = String(formData.get("periodo") ?? "");
  const back = `/costos?mes=${periodo.slice(0, 7)}`;
  if (!id.success) volverConError(back, "Ítem inválido");
  const { data } = await db().from("product_costs").select("item").eq("id", id.data).maybeSingle();
  const { error } = await db().from("product_costs").delete().eq("id", id.data);
  if (error) volverConError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "cost:delete", entity: "product_costs", entity_id: id.data, detail: { item: data?.item, periodo },
  });
  volverOk(back, `${data?.item ?? "Ítem"} quitado de este mes`);
}

// arranca el mes siguiente con los mismos ítems y valores, para editar solo lo que cambió
export async function copiarMes(formData: FormData) {
  const user = await requireSection("costos");
  const desde = String(formData.get("periodo") ?? "");
  if (!/^\d{4}-\d{2}-01$/.test(desde)) volverConError("/costos", "Mes inválido");
  const hasta = mesSiguiente(desde);
  const [{ data: origen }, { data: existentes }] = await Promise.all([
    db().from("product_costs").select("*").eq("period", desde),
    db().from("product_costs").select("item").eq("period", hasta),
  ]);
  const ya = new Set((existentes ?? []).map((r) => r.item));
  const nuevas = (origen ?? [])
    .filter((r) => !ya.has(r.item))
    .map((r) => {
      const { id: _id, total_cost: _t, updated_at: _u, ...resto } = r;
      void _id; void _t; void _u;
      return { ...resto, period: hasta, updated_by: user.alias, updated_at: new Date().toISOString() };
    });
  if (nuevas.length) {
    const { error } = await db().from("product_costs").insert(nuevas);
    if (error) volverConError(`/costos?mes=${desde.slice(0, 7)}`, error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "cost:copy_month", entity: "product_costs", entity_id: null,
    detail: { desde, hasta, filas: nuevas.length },
  });
  volverOk(`/costos?mes=${hasta.slice(0, 7)}`, `Mes creado con ${nuevas.length} ítem(s) copiados: actualizá lo que cambió`);
}
