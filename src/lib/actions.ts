"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection, requireRole } from "./auth";
import { NEEDS_DESTINATION, OPERABLE_TYPES } from "./types";

function backWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function okRedirect(path: string, message: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}?ok=${encodeURIComponent(message)}`);
}

const numeroPositivo = z.coerce.number().positive("La cantidad debe ser mayor a 0");
const uuid = z.string().uuid();

// ── Ingreso de stock ────────────────────────────────────────────────

const ingresoSchema = z.object({
  fecha: z.string().min(1, "Falta la fecha"),
  producto: uuid,
  cantidad: numeroPositivo,
  lote: z.string().trim().optional(),
  vencimiento: z.string().optional(),
  remito: z.string().trim().optional(),
  factura: z.string().trim().optional(),
  costo_total: z.string().optional(),
  costo_unitario: z.string().optional(),
  proveedor: z.string().optional(),
  ubicacion: uuid,
  notas: z.string().trim().optional(),
  idem: z.string().min(8),
});

export async function registrarIngreso(formData: FormData) {
  const user = await requireSection("ingresos");
  const back = "/ingresos/nuevo";
  const parsed = ingresoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;

  const costoTotal = d.costo_total ? parseFloat(d.costo_total) : null;
  const costoUnitario = d.costo_unitario ? parseFloat(d.costo_unitario) : null;
  if (costoTotal !== null && (isNaN(costoTotal) || costoTotal < 0)) backWithError(back, "Costo total inválido");
  if (costoUnitario !== null && (isNaN(costoUnitario) || costoUnitario < 0)) backWithError(back, "Costo unitario inválido");

  const { data: prodTipo } = await db().from("products").select("type").eq("id", d.producto).maybeSingle();
  if (prodTipo?.type === "KIT") {
    backWithError(back, "Los kits no llevan stock propio: ingresá stock de sus componentes");
  }

  const { error } = await db().rpc("create_stock_entry", {
    p_entry_date: d.fecha,
    p_supplier: d.proveedor || null,
    p_remito: d.remito || null,
    p_invoice: d.factura || null,
    p_notes: d.notas || null,
    p_actor: user.alias,
    p_idem: d.idem,
    p_lines: [
      {
        product_id: d.producto,
        lot_code: d.lote || null,
        expires_on: d.vencimiento || null,
        quantity: d.cantidad,
        unit_cost: costoUnitario,
        total_cost: costoTotal,
        location_id: d.ubicacion,
      },
    ],
  });
  if (error) backWithError(back, error.message);
  okRedirect("/movimientos", "Ingreso registrado");
}

// ── Movimiento (transferencia / egreso) ─────────────────────────────

const movimientoCabeceraSchema = z.object({
  tipo: z.enum(OPERABLE_TYPES),
  destino: z.string().optional(),
  motivo: z.string().trim().optional(),
  notas: z.string().trim().optional(),
  idem: z.string().min(8),
});

// una operación puede tener varias líneas (productos o kits), todas atómicas
export async function registrarMovimiento(formData: FormData) {
  const user = await requireSection("movimientos");
  const back = "/movimientos/nuevo";
  const parsed = movimientoCabeceraSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;

  const valores = formData.getAll("linea_valor").map(String);
  const cantidades = formData.getAll("linea_cantidad").map(String);
  const ubicacionesKit = formData.getAll("linea_kit_ubicacion").map(String);

  type Linea = {
    product_id: string;
    lot_id?: string | null;
    from_location_id: string;
    quantity: number;
    is_kit?: boolean;
  };
  const lineas: Linea[] = [];
  for (let i = 0; i < valores.length; i++) {
    const valor = valores[i].trim();
    if (!valor) continue;
    const qty = Number(cantidades[i]);
    if (isNaN(qty) || qty <= 0) backWithError(back, `Línea ${i + 1}: la cantidad debe ser mayor a 0`);
    if (valor.startsWith("kit:")) {
      const from = (ubicacionesKit[i] ?? "").trim();
      if (!from) backWithError(back, `Línea ${i + 1}: elegí desde qué ubicación sale el kit`);
      lineas.push({ product_id: valor.slice(4), is_kit: true, from_location_id: from, quantity: qty });
    } else {
      const [productId, lotId, fromId] = valor.split("|");
      if (!productId || !fromId) backWithError(back, `Línea ${i + 1}: origen inválido`);
      lineas.push({ product_id: productId, lot_id: lotId || null, from_location_id: fromId, quantity: qty });
    }
  }
  if (lineas.length === 0) backWithError(back, "Agregá al menos un producto");

  const needsDest = NEEDS_DESTINATION.includes(d.tipo);
  if (needsDest && !d.destino) backWithError(back, "Este tipo de movimiento necesita ubicación destino");
  if (needsDest && lineas.some((l) => l.from_location_id === d.destino)) {
    backWithError(back, "Origen y destino no pueden ser iguales");
  }
  if (d.tipo === "OTHER" && !d.motivo) backWithError(back, "El tipo 'Otro' exige un motivo");

  const { error } = await db().rpc("apply_movement_batch", {
    p_type: d.tipo,
    p_to: needsDest ? d.destino : null,
    p_actor: user.alias,
    p_reason: d.motivo || null,
    p_notes: d.notas || null,
    p_idem: d.idem,
    p_lines: lineas,
  });
  if (error) backWithError(back, error.message);
  okRedirect(
    "/movimientos",
    lineas.length > 1 ? `Movimiento registrado (${lineas.length} líneas)` : "Movimiento registrado"
  );
}

// ── Reversión (solo admin/manager) ──────────────────────────────────

const reversionSchema = z.object({
  movimiento: uuid,
  motivo: z.string().trim().min(3, "Explicá el motivo de la reversión"),
});

export async function revertirMovimiento(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const back = "/movimientos";
  const parsed = reversionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const { error } = await db().rpc("reverse_movement", {
    p_movement: d.movimiento,
    p_actor: user.alias,
    p_reason: d.motivo,
  });
  if (error) backWithError(back, error.message);
  okRedirect("/movimientos", "Movimiento revertido");
}

// ── Productos ───────────────────────────────────────────────────────

const productoSchema = z.object({
  sku: z.string().trim().min(1, "Falta el SKU"),
  nombre: z.string().trim().min(1, "Falta el nombre"),
  descripcion: z.string().trim().optional(),
  categoria: z.string().trim().optional(),
  unidad: z.string().trim().min(1, "Falta la unidad"),
  tipo: z.enum(["TERMINADO", "MONODOSIS", "INSUMO", "PACKAGING", "GRANEL", "ACCESORIO"]),
  stock_minimo: z.coerce.number().min(0).default(0),
});

export async function crearProducto(formData: FormData) {
  const user = await requireSection("productos");
  const back = "/productos";
  const parsed = productoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const { error } = await db().from("products").insert({
    sku: d.sku,
    name: d.nombre,
    description: d.descripcion || null,
    category: d.categoria || null,
    unit: d.unidad,
    type: d.tipo,
    min_stock: d.stock_minimo,
  });
  if (error) {
    backWithError(back, error.code === "23505" ? `El SKU "${d.sku}" ya existe` : error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "product:create", entity: "products", detail: { sku: d.sku },
  });
  okRedirect("/productos", `Producto ${d.sku} creado`);
}

const editarProductoSchema = productoSchema.extend({
  producto: uuid,
  activo: z.string().optional(),
  maneja_lote: z.string().optional(),
  maneja_vencimiento: z.string().optional(),
});

export async function editarProducto(formData: FormData) {
  const user = await requireSection("productos");
  const parsed = editarProductoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError("/productos", parsed.error.issues[0].message);
  const d = parsed.data;
  const back = `/productos/${d.producto}`;

  const { data: antes } = await db()
    .from("products")
    .select("sku, name, category, unit, type, min_stock, active, tracks_lot, tracks_expiry, description")
    .eq("id", d.producto)
    .maybeSingle();
  if (!antes) backWithError("/productos", "Producto inexistente");

  const cambios = {
    sku: d.sku,
    name: d.nombre,
    description: d.descripcion || null,
    category: d.categoria || null,
    unit: d.unidad,
    type: d.tipo,
    min_stock: d.stock_minimo,
    active: d.activo === "on",
    tracks_lot: d.maneja_lote === "on",
    tracks_expiry: d.maneja_vencimiento === "on",
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("products").update(cambios).eq("id", d.producto);
  if (error) {
    backWithError(back, error.code === "23505" ? `El SKU "${d.sku}" ya existe` : error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "product:update", entity: "products", entity_id: d.producto,
    detail: { before: antes, after: cambios },
  });
  okRedirect(back, "Producto actualizado");
}

// ── Proveedores ─────────────────────────────────────────────────────

const proveedorSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre"),
  cuit: z.string().trim().optional(),
  contacto: z.string().trim().optional(),
});

export async function crearProveedor(formData: FormData) {
  await requireSection("proveedores");
  const back = "/proveedores";
  const parsed = proveedorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const { error } = await db().from("suppliers").insert({
    name: d.nombre,
    cuit: d.cuit || null,
    contact: d.contacto || null,
  });
  if (error) {
    backWithError(back, error.code === "23505" ? `El proveedor "${d.nombre}" ya existe` : error.message);
  }
  okRedirect("/proveedores", `Proveedor ${d.nombre} creado`);
}

// ── Conteo físico ciego ─────────────────────────────────────────────

export async function abrirConteo(formData: FormData) {
  const user = await requireSection("conteos");
  const back = "/conteos";
  const ubicacion = uuid.safeParse(String(formData.get("ubicacion") ?? ""));
  if (!ubicacion.success) backWithError(back, "Elegí una ubicación");
  const { data, error } = await db().rpc("open_count", {
    p_location: ubicacion.data,
    p_actor: user.alias,
  });
  if (error) backWithError(back, error.message);
  revalidatePath("/", "layout");
  redirect(`/conteos/${data}?ok=${encodeURIComponent("Conteo abierto. Cargá las cantidades físicas.")}`);
}

export async function guardarConteo(formData: FormData) {
  const user = await requireSection("conteos");
  const countId = String(formData.get("conteo") ?? "");
  const cerrar = formData.get("cerrar") === "1";
  const back = `/conteos/${countId}`;
  if (!countId) backWithError("/conteos", "Conteo inválido");

  const lines: { line_id: string; counted: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("linea_") && String(value).trim() !== "") {
      const n = Number(value);
      if (isNaN(n) || n < 0) backWithError(back, "Las cantidades deben ser números mayores o iguales a 0");
      lines.push({ line_id: key.slice(6), counted: String(value) });
    }
  }
  if (lines.length > 0) {
    const { error } = await db().rpc("save_count_lines", {
      p_count: countId,
      p_lines: lines,
      p_actor: user.alias,
    });
    if (error) backWithError(back, error.message);
  }
  if (cerrar) {
    const { error } = await db().rpc("close_count", { p_count: countId, p_actor: user.alias });
    if (error) backWithError(back, error.message);
    okRedirect(back, "Conteo cerrado. Un responsable debe revisar las diferencias.");
  }
  okRedirect(back, "Avance guardado");
}

const revisarSchema = z.object({
  conteo: uuid,
  motivo: z.string().trim().min(3, "Indicá el motivo de la decisión"),
  decision: z.enum(["aprobar", "rechazar"]),
});

export async function revisarConteo(formData: FormData) {
  const user = await requireRole("ADMIN");
  const parsed = revisarSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError("/conteos", parsed.error.issues[0].message);
  const d = parsed.data;
  const back = `/conteos/${d.conteo}`;
  const { error } = await db().rpc("review_count", {
    p_count: d.conteo,
    p_actor: user.alias,
    p_approve: d.decision === "aprobar",
    p_reason: d.motivo,
  });
  if (error) backWithError(back, error.message);
  okRedirect(
    back,
    d.decision === "aprobar"
      ? "Conteo aprobado: se generaron los ajustes de stock."
      : "Conteo rechazado: el stock no se modificó."
  );
}

// ── Estado de lote (cuarentena / bloqueo / liberación) ──────────────

const estadoLoteSchema = z.object({
  lote: uuid,
  estado: z.enum(["ACTIVE", "QUARANTINE", "BLOCKED", "EXPIRED", "DEPLETED"]),
  motivo: z.string().trim().min(3, "Indicá el motivo"),
  volver: z.string().optional(),
});

export async function cambiarEstadoLote(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const parsed = estadoLoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError("/lotes", parsed.error.issues[0].message);
  const d = parsed.data;
  const back = d.volver || "/lotes";
  const { error } = await db().rpc("change_lot_status", {
    p_lot: d.lote,
    p_status: d.estado,
    p_actor: user.alias,
    p_reason: d.motivo,
  });
  if (error) backWithError(back, error.message);
  okRedirect(back, "Estado del lote actualizado");
}

// ── Importación masiva de productos desde Excel ─────────────────────

export async function importarProductos(formData: FormData) {
  const user = await requireSection("productos");
  const back = "/productos/importar";
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    backWithError(back, "Subí el archivo Excel completado");
  }
  if (archivo.size > 2 * 1024 * 1024) backWithError(back, "El archivo no puede superar 2 MB");

  const { parseProductosExcel } = await import("./export");
  let filas, errores;
  try {
    ({ filas, errores } = await parseProductosExcel(await archivo.arrayBuffer()));
  } catch {
    backWithError(back, "No se pudo leer el archivo: usá la plantilla .xlsx");
  }
  if (errores.length > 0) {
    backWithError(back, `Nada se importó. Corregí y volvé a subir: ${errores.slice(0, 5).join(" · ")}${errores.length > 5 ? ` (+${errores.length - 5} más)` : ""}`);
  }
  if (filas.length === 0) backWithError(back, "El archivo no tiene filas de productos");

  const cli = db();

  // ubicaciones válidas (para filas con stock inicial)
  const { data: locs } = await cli.from("locations").select("id, name").eq("active", true);
  const locPorNombre = new Map((locs ?? []).map((l) => [l.name.toLowerCase(), l.id]));
  const ubicacionesMalas = [
    ...new Set(
      filas
        .filter((f) => f.ubicacion && !locPorNombre.has(f.ubicacion.toLowerCase()))
        .map((f) => f.ubicacion as string)
    ),
  ];
  if (ubicacionesMalas.length > 0) {
    backWithError(
      back,
      `Nada se importó. Ubicaciones inexistentes: ${ubicacionesMalas.join(", ")}. Válidas: ${(locs ?? [])
        .map((l) => l.name)
        .join(", ")}`
    );
  }

  const { data: existentes } = await cli.from("products").select("sku");
  const ya = new Set((existentes ?? []).map((p) => p.sku.toLowerCase()));
  const nuevas = filas.filter((f) => !ya.has(f.sku.toLowerCase()));
  const salteados = filas.length - nuevas.length;

  if (nuevas.length > 0) {
    const { error } = await cli.from("products").insert(
      nuevas.map((f) => ({
        sku: f.sku,
        name: f.nombre,
        description: f.descripcion,
        category: f.categoria,
        unit: f.unidad,
        type: f.tipo,
        min_stock: f.minimo,
        tracks_lot: true,
        tracks_expiry: true,
      }))
    );
    if (error) backWithError(back, error.message);
  }

  // stock inicial: un solo ingreso trazable con todas las líneas que traen cantidad
  const conStock = nuevas.filter((f) => f.cantidad !== null && f.ubicacion);
  let lineasStock = 0;
  if (conStock.length > 0) {
    const { data: creados } = await cli
      .from("products")
      .select("id, sku")
      .in("sku", conStock.map((f) => f.sku));
    const idPorSku = new Map((creados ?? []).map((p) => [p.sku.toLowerCase(), p.id]));
    const { randomUUID } = await import("crypto");
    const { error } = await cli.rpc("create_stock_entry", {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_supplier: null,
      p_remito: null,
      p_invoice: null,
      p_notes: "Stock inicial importado desde Excel",
      p_actor: user.alias,
      p_idem: `import:${randomUUID()}`,
      p_lines: conStock.map((f) => ({
        product_id: idPorSku.get(f.sku.toLowerCase()),
        lot_code: f.lote,
        expires_on: f.vencimiento,
        quantity: f.cantidad,
        unit_cost: f.costo,
        total_cost: null,
        location_id: locPorNombre.get(f.ubicacion!.toLowerCase()),
      })),
    });
    if (error) {
      backWithError(back, `Los productos se crearon pero falló la carga de stock: ${error.message}`);
    }
    lineasStock = conStock.length;
  }

  await cli.from("audit_logs").insert({
    actor: user.alias, action: "product:import", entity: "products",
    detail: { creados: nuevas.length, salteados, con_stock: lineasStock },
  });
  okRedirect(
    "/productos",
    `Importación lista: ${nuevas.length} producto(s) creado(s)${
      lineasStock > 0 ? `, ${lineasStock} con stock inicial cargado` : ""
    }${salteados > 0 ? `, ${salteados} salteado(s) por SKU existente` : ""}.`
  );
}

// ── Ajuste directo de stock (ADMIN/MANAGER) ─────────────────────────

const ajusteSchema = z.object({
  renglon: z.string().min(1), // "productId|lotId|locationId"
  cantidad_nueva: z.coerce.number().min(0, "La cantidad debe ser 0 o mayor"),
  motivo: z.string().trim().min(3, "Indicá el motivo del ajuste"),
});

export async function ajustarStock(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const back = "/stock";
  const parsed = ajusteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const [productId, lotId, locationId] = d.renglon.split("|");
  if (!productId || !locationId) backWithError(back, "Renglón inválido");
  const { error } = await db().rpc("adjust_stock_to", {
    p_product: productId,
    p_lot: lotId || null,
    p_location: locationId,
    p_new: d.cantidad_nueva,
    p_actor: user.alias,
    p_reason: d.motivo,
  });
  if (error) backWithError(back, error.message);
  okRedirect("/stock", "Stock ajustado (quedó registrado como movimiento de ajuste)");
}

// ── Eliminar producto (solo sin historial; con historial se desactiva) ──

export async function eliminarProducto(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const id = uuid.safeParse(String(formData.get("producto") ?? ""));
  if (!id.success) backWithError("/productos", "Producto inválido");
  const back = `/productos/${id.data}`;
  const cli = db();

  const { data: prod } = await cli.from("products").select("sku, name").eq("id", id.data).maybeSingle();
  if (!prod) backWithError("/productos", "Producto inexistente");

  const refs = await Promise.all([
    cli.from("inventory_movements").select("id", { count: "exact", head: true }).eq("product_id", id.data),
    cli.from("stock_entry_lines").select("id", { count: "exact", head: true }).eq("product_id", id.data),
    cli.from("inventory_count_lines").select("id", { count: "exact", head: true }).eq("product_id", id.data),
  ]);
  const historial = refs.reduce((s, r) => s + (r.count ?? 0), 0);
  if (historial > 0) {
    backWithError(
      back,
      `No se puede eliminar: tiene ${historial} registro(s) de historial. Desactivalo en su lugar (destildá "Activo" y guardá).`
    );
  }

  const { error: lotErr } = await cli.from("lots").delete().eq("product_id", id.data);
  if (lotErr) backWithError(back, "No se puede eliminar: sus lotes tienen historial. Desactivalo en su lugar.");
  const { error } = await cli.from("products").delete().eq("id", id.data);
  if (error) backWithError(back, error.message);

  await cli.from("audit_logs").insert({
    actor: user.alias, action: "product:delete", entity: "products", entity_id: id.data,
    detail: { sku: prod.sku, name: prod.name },
  });
  okRedirect("/productos", `Producto ${prod.sku} eliminado`);
}

// ── Ubicaciones ─────────────────────────────────────────────────────

const ubicacionSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre"),
  es_cuarentena: z.string().optional(),
});

export async function crearUbicacion(formData: FormData) {
  await requireSection("ubicaciones");
  const back = "/ubicaciones";
  const parsed = ubicacionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const { error } = await db().from("locations").insert({
    name: d.nombre,
    is_quarantine: d.es_cuarentena === "on",
  });
  if (error) {
    backWithError(back, error.code === "23505" ? `La ubicación "${d.nombre}" ya existe` : error.message);
  }
  okRedirect(back, `Ubicación ${d.nombre} creada`);
}

export async function editarUbicacion(formData: FormData) {
  const user = await requireSection("ubicaciones");
  const back = "/ubicaciones";
  const id = uuid.safeParse(String(formData.get("ubicacion") ?? ""));
  const parsed = ubicacionSchema.safeParse(Object.fromEntries(formData));
  if (!id.success || !parsed.success) backWithError(back, "Datos inválidos");
  const d = parsed.data;
  const { error } = await db()
    .from("locations")
    .update({ name: d.nombre, is_quarantine: d.es_cuarentena === "on", active: formData.get("activo") === "on" })
    .eq("id", id.data);
  if (error) {
    backWithError(back, error.code === "23505" ? `La ubicación "${d.nombre}" ya existe` : error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "location:update", entity: "locations", entity_id: id.data,
    detail: { name: d.nombre },
  });
  okRedirect(back, "Ubicación actualizada");
}

export async function eliminarUbicacion(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const back = "/ubicaciones";
  const id = uuid.safeParse(String(formData.get("ubicacion") ?? ""));
  if (!id.success) backWithError(back, "Ubicación inválida");
  const cli = db();
  const refs = await Promise.all([
    cli.from("inventory_movements").select("id", { count: "exact", head: true }).eq("from_location_id", id.data),
    cli.from("inventory_movements").select("id", { count: "exact", head: true }).eq("to_location_id", id.data),
    cli.from("stock_balances").select("id", { count: "exact", head: true }).eq("location_id", id.data),
    cli.from("stock_entry_lines").select("id", { count: "exact", head: true }).eq("location_id", id.data),
    cli.from("inventory_counts").select("id", { count: "exact", head: true }).eq("location_id", id.data),
  ]);
  const historial = refs.reduce((s, r) => s + (r.count ?? 0), 0);
  if (historial > 0) {
    backWithError(back, `No se puede eliminar: tiene ${historial} registro(s) de historial. Desactivala en su lugar.`);
  }
  const { error } = await cli.from("locations").delete().eq("id", id.data);
  if (error) backWithError(back, error.message);
  await cli.from("audit_logs").insert({
    actor: user.alias, action: "location:delete", entity: "locations", entity_id: id.data,
  });
  okRedirect(back, "Ubicación eliminada");
}

// ── Proveedores: edición y eliminación ──────────────────────────────

const editarProveedorSchema = z.object({
  proveedor: uuid,
  nombre: z.string().trim().min(1, "Falta el nombre"),
  razon_social: z.string().trim().optional(),
  cuit: z.string().trim().optional(),
  contacto: z.string().trim().optional(),
  email: z.string().trim().optional(),
  telefono: z.string().trim().optional(),
  notas: z.string().trim().optional(),
  activo: z.string().optional(),
});

export async function editarProveedor(formData: FormData) {
  const user = await requireSection("proveedores");
  const parsed = editarProveedorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError("/proveedores", parsed.error.issues[0].message);
  const d = parsed.data;
  const back = `/proveedores/${d.proveedor}`;
  const { error } = await db()
    .from("suppliers")
    .update({
      name: d.nombre,
      legal_name: d.razon_social || null,
      cuit: d.cuit || null,
      contact: d.contacto || null,
      email: d.email || null,
      phone: d.telefono || null,
      notes: d.notas || null,
      active: d.activo === "on",
    })
    .eq("id", d.proveedor);
  if (error) {
    backWithError(back, error.code === "23505" ? `El proveedor "${d.nombre}" ya existe` : error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "supplier:update", entity: "suppliers", entity_id: d.proveedor,
    detail: { name: d.nombre },
  });
  okRedirect(back, "Proveedor actualizado");
}

export async function eliminarProveedor(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const id = uuid.safeParse(String(formData.get("proveedor") ?? ""));
  if (!id.success) backWithError("/proveedores", "Proveedor inválido");
  const back = `/proveedores/${id.data}`;
  const cli = db();
  const { count } = await cli
    .from("stock_entries")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", id.data);
  if ((count ?? 0) > 0) {
    backWithError(back, `No se puede eliminar: tiene ${count} ingreso(s) asociados. Desactivalo en su lugar.`);
  }
  const { error } = await cli.from("suppliers").delete().eq("id", id.data);
  if (error) backWithError(back, error.message);
  await cli.from("audit_logs").insert({
    actor: user.alias, action: "supplier:delete", entity: "suppliers", entity_id: id.data,
  });
  okRedirect("/proveedores", "Proveedor eliminado");
}

// ── Componentes de kit ──────────────────────────────────────────────

const componenteSchema = z.object({
  kit: uuid,
  componente: uuid,
  cantidad: numeroPositivo,
});

export async function agregarComponenteKit(formData: FormData) {
  const user = await requireSection("productos");
  const parsed = componenteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError("/productos", parsed.error.issues[0].message);
  const d = parsed.data;
  const back = `/productos/${d.kit}`;
  const { data: comp } = await db().from("products").select("type, name").eq("id", d.componente).maybeSingle();
  if (!comp) backWithError(back, "Componente inexistente");
  if (comp.type === "KIT") backWithError(back, "Un kit no puede contener otro kit");
  const { error } = await db().from("kit_components").insert({
    kit_id: d.kit,
    component_id: d.componente,
    quantity: d.cantidad,
  });
  if (error) {
    backWithError(back, error.code === "23505" ? `${comp.name} ya es parte del kit` : error.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "kit:add_component", entity: "products", entity_id: d.kit,
    detail: { componente: comp.name, cantidad: d.cantidad },
  });
  okRedirect(back, "Componente agregado al kit");
}

export async function quitarComponenteKit(formData: FormData) {
  const user = await requireSection("productos");
  const id = uuid.safeParse(String(formData.get("componente_id") ?? ""));
  const kit = String(formData.get("kit") ?? "");
  if (!id.success) backWithError("/productos", "Componente inválido");
  const back = `/productos/${kit}`;
  const { error } = await db().from("kit_components").delete().eq("id", id.data);
  if (error) backWithError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "kit:remove_component", entity: "products", entity_id: kit || null,
  });
  okRedirect(back, "Componente quitado del kit");
}
