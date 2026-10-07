"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection, requireRole, can, ubicacionFija, type Profile } from "./auth";
import { NEEDS_DESTINATION, OPERABLE_TYPES } from "./types";

function backWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function okRedirect(path: string, message: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}?ok=${encodeURIComponent(message)}`);
}

// usuario atado a una ubicación (ej. vendedora del Store): solo opera desde ahí
function exigirUbicacion(user: Profile, locationId: string | null | undefined, back: string) {
  const fija = ubicacionFija(user);
  if (fija && locationId !== fija) {
    backWithError(back, "Tu usuario solo puede operar stock desde su ubicación asignada");
  }
}

const numeroPositivo = z.coerce.number().positive("La cantidad debe ser mayor a 0");
const uuid = z.string().uuid();

// ── Ingreso de stock ────────────────────────────────────────────────

const ingresoSchema = z.object({
  fecha: z.string().min(1, "Falta la fecha"),
  remito: z.string().trim().optional(),
  factura: z.string().trim().optional(),
  proveedor: z.string().optional(),
  ubicacion: uuid,
  notas: z.string().trim().optional(),
  idem: z.string().min(8),
});

// un ingreso (remito) puede traer varios productos: todo se registra junto o nada
export async function registrarIngreso(formData: FormData) {
  const user = await requireSection("ingresos");
  const back = "/ingresos/nuevo";
  const parsed = ingresoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  exigirUbicacion(user, d.ubicacion, back);

  const productos = formData.getAll("ing_producto").map(String);
  const cantidades = formData.getAll("ing_cantidad").map(String);
  const lotes = formData.getAll("ing_lote").map(String);
  const vencimientos = formData.getAll("ing_vencimiento").map(String);
  const costos = formData.getAll("ing_costo").map(String);

  const lineas = [];
  for (let i = 0; i < productos.length; i++) {
    const n = i + 1;
    if (!uuid.safeParse(productos[i]).success) backWithError(back, `Producto ${n}: elegí el producto`);
    const qty = Number(cantidades[i]);
    if (!(qty > 0)) backWithError(back, `Producto ${n}: la cantidad debe ser mayor a 0`);
    const costo = costos[i]?.trim() ? Number(costos[i]) : null;
    if (costo !== null && !(costo >= 0)) backWithError(back, `Producto ${n}: costo inválido`);
    lineas.push({
      product_id: productos[i],
      lot_code: lotes[i]?.trim() || null,
      expires_on: vencimientos[i] || null,
      quantity: qty,
      unit_cost: costo,
      total_cost: null,
      location_id: d.ubicacion,
    });
  }
  if (lineas.length === 0) backWithError(back, "Agregá al menos un producto");

  const { data: kits } = await db()
    .from("products")
    .select("name")
    .in("id", lineas.map((l) => l.product_id))
    .eq("type", "KIT");
  if (kits?.length) {
    backWithError(back, `"${kits[0].name}" es un kit: los kits no se ingresan, se arman con sus componentes`);
  }

  const { error } = await db().rpc("create_stock_entry", {
    p_entry_date: d.fecha,
    p_supplier: d.proveedor || null,
    p_remito: d.remito || null,
    p_invoice: d.factura || null,
    p_notes: d.notas || null,
    p_actor: user.alias,
    p_idem: d.idem,
    p_lines: lineas,
  });
  if (error) backWithError(back, error.message);
  okRedirect(
    "/movimientos",
    lineas.length > 1 ? `Ingreso registrado (${lineas.length} productos)` : "Ingreso registrado"
  );
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
  for (const l of lineas) exigirUbicacion(user, l.from_location_id, back);

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
  tipo: z.enum(["TERMINADO", "MONODOSIS", "INSUMO", "PACKAGING", "GRANEL", "ACCESORIO", "KIT"]),
  stock_minimo: z.coerce.number().min(0).default(0),
});

const stockInicialSchema = z.object({
  cantidad_inicial: z.coerce.number().min(0, "La cantidad inicial no puede ser negativa").default(0),
  ubicacion_inicial: z.string().optional(),
  lote_inicial: z.string().trim().optional(),
  vencimiento_inicial: z.string().optional(),
  idem: z.string().min(8).optional(),
});

export async function crearProducto(formData: FormData) {
  const user = await requireSection("productos");
  const back = "/productos";
  const parsed = productoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const ini = stockInicialSchema.safeParse({
    cantidad_inicial: formData.get("cantidad_inicial") || 0,
    ubicacion_inicial: formData.get("ubicacion_inicial") || undefined,
    lote_inicial: formData.get("lote_inicial") || undefined,
    vencimiento_inicial: formData.get("vencimiento_inicial") || undefined,
    idem: formData.get("idem") || undefined,
  });
  if (!ini.success) backWithError(back, ini.error.issues[0].message);
  const cargaInicial = ini.data.cantidad_inicial > 0;
  if (cargaInicial) {
    if (d.tipo === "KIT") {
      backWithError(back, "Los kits no se cargan con cantidad inicial: usá \"Armar kit\" y cargá los kits ya armados ahí");
    }
    if (!can(user, "ingresos")) backWithError(back, "No tenés permiso para cargar ingresos de stock");
    if (!uuid.safeParse(ini.data.ubicacion_inicial).success) {
      backWithError(back, "Elegí en qué ubicación entra la cantidad inicial");
    }
    exigirUbicacion(user, ini.data.ubicacion_inicial, back);
  }
  const { data: creado, error } = await db()
    .from("products")
    .insert({
      sku: d.sku,
      name: d.nombre,
      description: d.descripcion || null,
      category: d.categoria || null,
      unit: d.unidad,
      type: d.tipo,
      min_stock: d.stock_minimo,
    })
    .select("id")
    .single();
  if (error || !creado) {
    backWithError(back, error?.code === "23505" ? `El SKU "${d.sku}" ya existe` : (error?.message ?? "Error al crear"));
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "product:create", entity: "products", entity_id: creado.id, detail: { sku: d.sku },
  });
  if (d.tipo === "KIT") {
    okRedirect(`/productos/${creado.id}`, `Kit ${d.sku} creado: ahora agregale los productos que lo componen ↓`);
  }
  if (cargaInicial) {
    const { error: errIngreso } = await db().rpc("create_stock_entry", {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_supplier: null,
      p_remito: null,
      p_invoice: null,
      p_notes: "Stock inicial al crear el producto",
      p_actor: user.alias,
      p_idem: ini.data.idem ?? `alta:${creado.id}`,
      p_lines: [
        {
          product_id: creado.id,
          lot_code: ini.data.lote_inicial || null,
          expires_on: ini.data.vencimiento_inicial || null,
          quantity: ini.data.cantidad_inicial,
          unit_cost: null,
          total_cost: null,
          location_id: ini.data.ubicacion_inicial,
        },
      ],
    });
    if (errIngreso) {
      backWithError(back, `Producto ${d.sku} creado, pero falló la carga del stock inicial: ${errIngreso.message}`);
    }
    okRedirect("/productos", `Producto ${d.sku} creado con ${ini.data.cantidad_inicial} unidad(es) en stock`);
  }
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
  exigirUbicacion(user, ubicacion.data, back);
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

// asigna nro de lote + vencimiento a stock existente (sin lote o de otro lote).
// origen: "TODO" = todo el stock sin lote del producto; "lotId|locationId" = un renglón
const asignarLoteSchema = z.object({
  producto: uuid,
  origen: z.string().min(1, "Elegí qué stock pasa al lote"),
  cantidad: z.string().optional(),
  lote: z.string().trim().min(1, "Indicá el número de lote"),
  vencimiento: z.string().optional(),
  idem: z.string().min(8),
});

export async function asignarLote(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const back = "/lotes";
  const parsed = asignarLoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;

  let fromLot: string | null = null;
  let location: string | null = null;
  let qty: number | null = null;
  if (d.origen !== "TODO") {
    const [lotId, locId] = d.origen.split("|");
    if (lotId && !uuid.safeParse(lotId).success) backWithError(back, "Origen inválido");
    if (!uuid.safeParse(locId).success) backWithError(back, "Origen inválido");
    fromLot = lotId || null;
    location = locId;
    if (d.cantidad) {
      qty = Number(d.cantidad);
      if (!(qty > 0)) backWithError(back, "La cantidad debe ser mayor a 0");
    }
  }

  if (ubicacionFija(user) && !location) backWithError(back, "Elegí un renglón de tu ubicación");
  if (location) exigirUbicacion(user, location, back);
  const { error } = await db().rpc("assign_lot", {
    p_product: d.producto,
    p_from_lot: fromLot,
    p_location: location,
    p_qty: qty,
    p_code: d.lote,
    p_expires: d.vencimiento || null,
    p_actor: user.alias,
    p_idem: d.idem,
  });
  if (error) backWithError(back, error.message);
  okRedirect(back, `Stock asignado al lote ${d.lote}`);
}

// lote nuevo: con cantidad es un ingreso (crea el lote y suma stock); sin
// cantidad solo registra el lote para usarlo después
const nuevoLoteSchema = z.object({
  producto: uuid,
  lote: z.string().trim().min(1, "Indicá el número de lote"),
  vencimiento: z.string().optional(),
  cantidad: z.string().optional(),
  ubicacion: z.string().optional(),
  idem: z.string().min(8),
});

export async function crearLote(formData: FormData) {
  const user = await requireSection("lotes");
  const back = "/lotes";
  const parsed = nuevoLoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const { data: prod } = await db().from("products").select("type").eq("id", d.producto).maybeSingle();
  if (!prod) backWithError(back, "Producto inexistente");
  if (prod.type === "KIT") backWithError(back, "Los kits no llevan lote: se arman con sus componentes");

  const cantidad = d.cantidad ? Number(d.cantidad) : 0;
  if (!(cantidad >= 0)) backWithError(back, "Cantidad inválida");
  if (cantidad > 0) {
    if (!can(user, "ingresos")) backWithError(back, "No tenés permiso para cargar ingresos de stock");
    if (!uuid.safeParse(d.ubicacion).success) backWithError(back, "Elegí en qué ubicación entra el lote");
    exigirUbicacion(user, d.ubicacion, back);
    const { error } = await db().rpc("create_stock_entry", {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_supplier: null,
      p_remito: null,
      p_invoice: null,
      p_notes: "Lote nuevo cargado desde Lotes",
      p_actor: user.alias,
      p_idem: d.idem,
      p_lines: [
        {
          product_id: d.producto,
          lot_code: d.lote,
          expires_on: d.vencimiento || null,
          quantity: cantidad,
          unit_cost: null,
          total_cost: null,
          location_id: d.ubicacion,
        },
      ],
    });
    if (error) backWithError(back, error.message);
    okRedirect(back, `Lote ${d.lote} ingresado con ${cantidad} unidad(es)`);
  }

  const { data: creado, error } = await db()
    .from("lots")
    .insert({ product_id: d.producto, code: d.lote, expires_on: d.vencimiento || null })
    .select("id")
    .single();
  if (error || !creado) {
    backWithError(back, error?.code === "23505" ? `El lote ${d.lote} ya existe para ese producto` : (error?.message ?? "Error al crear el lote"));
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "lot:create", entity: "lots", entity_id: creado.id,
    detail: { code: d.lote, expires_on: d.vencimiento || null },
  });
  okRedirect(back, `Lote ${d.lote} creado (sin stock todavía)`);
}

// corrige el vencimiento de un lote (no toca stock)
export async function editarVencimientoLote(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const lote = uuid.safeParse(String(formData.get("lote") ?? ""));
  if (!lote.success) backWithError("/lotes", "Lote inválido");
  const back = `/lotes/${lote.data}`;
  const venc = String(formData.get("vencimiento") ?? "") || null;
  const { data: antes } = await db().from("lots").select("expires_on").eq("id", lote.data).maybeSingle();
  if (!antes) backWithError("/lotes", "Lote inexistente");
  const { error } = await db().from("lots").update({ expires_on: venc }).eq("id", lote.data);
  if (error) backWithError(back, error.message);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "lot:expiry", entity: "lots", entity_id: lote.data,
    detail: { antes: antes.expires_on, despues: venc },
  });
  okRedirect(back, "Vencimiento actualizado");
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
  const [productId, lotId, locationFila] = d.renglon.split("|");
  const locationId = locationFila || String(formData.get("ubicacion") ?? "");
  exigirUbicacion(user, locationId, back);
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

// composición completa desde el armador visual (inputs comp_id/comp_qty)
async function leerComposicion(formData: FormData, back: string, kitId?: string) {
  const ids = formData.getAll("comp_id").map(String);
  const qtys = formData.getAll("comp_qty").map(String);
  const comps: { component_id: string; quantity: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = uuid.safeParse(ids[i]);
    const qty = numeroPositivo.safeParse(qtys[i]);
    if (!id.success) backWithError(back, "Componente inválido");
    if (!qty.success) backWithError(back, "Todas las cantidades del kit deben ser mayores a 0");
    if (id.data === kitId) backWithError(back, "Un kit no puede contenerse a sí mismo");
    if (comps.some((c) => c.component_id === id.data)) backWithError(back, "Hay un producto repetido en el kit");
    comps.push({ component_id: id.data, quantity: qty.data });
  }
  if (comps.length === 0) backWithError(back, "Agregá al menos un producto al kit");
  const { data: prods } = await db()
    .from("products")
    .select("id, name, type")
    .in("id", comps.map((c) => c.component_id));
  const nombres = new Map((prods ?? []).map((p) => [p.id, p.name]));
  for (const c of comps) {
    const p = prods?.find((x) => x.id === c.component_id);
    if (!p) backWithError(back, "Componente inexistente");
    if (p.type === "KIT") backWithError(back, `"${p.name}" es un kit: un kit no puede contener otro kit`);
  }
  return { comps, nombres };
}

const kitNuevoSchema = z.object({
  sku: z.string().trim().min(1, "Falta el SKU"),
  nombre: z.string().trim().min(1, "Falta el nombre"),
  descripcion: z.string().trim().optional(),
  stock_minimo: z.coerce.number().min(0).default(0),
});

export async function crearKit(formData: FormData) {
  const user = await requireSection("productos");
  const back = "/productos/kits/nuevo";
  const parsed = kitNuevoSchema.safeParse({
    sku: formData.get("sku"),
    nombre: formData.get("nombre"),
    descripcion: formData.get("descripcion") ?? undefined,
    stock_minimo: formData.get("stock_minimo") || 0,
  });
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const { comps, nombres } = await leerComposicion(formData, back);
  const armados = Number(formData.get("armados") || 0);
  const ubicArmados = uuid.safeParse(String(formData.get("ubicacion_armados") ?? ""));
  if (armados > 0) {
    if (!can(user, "movimientos")) backWithError(back, "No tenés permiso para armar kits");
    if (!ubicArmados.success) backWithError(back, "Elegí en qué ubicación quedan los kits armados");
    exigirUbicacion(user, ubicArmados.data, back);
  }

  const { data: creado, error } = await db()
    .from("products")
    .insert({
      sku: d.sku,
      name: d.nombre,
      description: d.descripcion || null,
      unit: "unidad",
      type: "KIT",
      min_stock: d.stock_minimo,
    })
    .select("id")
    .single();
  if (error || !creado) {
    backWithError(back, error?.code === "23505" ? `El SKU "${d.sku}" ya existe` : (error?.message ?? "Error al crear"));
  }
  const { error: errComp } = await db()
    .from("kit_components")
    .insert(comps.map((c) => ({ kit_id: creado.id, ...c })));
  if (errComp) {
    // el kit recién creado no tiene historial: se descarta para no dejarlo vacío
    await db().from("products").delete().eq("id", creado.id);
    backWithError(back, errComp.message);
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "product:create", entity: "products", entity_id: creado.id,
    detail: { sku: d.sku, kit: comps.map((c) => ({ componente: nombres.get(c.component_id), cantidad: c.quantity })) },
  });
  if (armados > 0 && ubicArmados.success) {
    const fichaKit = `/productos/${creado.id}`;
    const { error: errArmado } = await db().rpc("assemble_kits", {
      p_kit: creado.id,
      p_qty: armados,
      p_location: ubicArmados.data,
      p_actor: user.alias,
      p_idem: String(formData.get("idem") || `alta-kit:${creado.id}`),
    });
    if (errArmado) backWithError(fichaKit, `Kit ${d.sku} creado, pero no se pudo armar: ${errArmado.message}`);
    okRedirect(fichaKit, `Kit ${d.sku} creado y ${armados} armado(s): componentes descontados del stock`);
  }
  okRedirect(`/productos/${creado.id}`, `Kit ${d.sku} creado con ${comps.length} producto(s)`);
}

export async function guardarComponentesKit(formData: FormData) {
  const user = await requireSection("productos");
  const kit = uuid.safeParse(String(formData.get("kit") ?? ""));
  if (!kit.success) backWithError("/productos", "Kit inválido");
  const back = `/productos/${kit.data}`;
  const { comps, nombres } = await leerComposicion(formData, back, kit.data);

  const { data: actuales, error: errLeer } = await db()
    .from("kit_components")
    .select("id, component_id, quantity")
    .eq("kit_id", kit.data);
  if (errLeer) backWithError(back, errLeer.message);

  const nuevos = new Map(comps.map((c) => [c.component_id, c.quantity]));
  const aBorrar = (actuales ?? []).filter((a) => !nuevos.has(a.component_id)).map((a) => a.id);
  const aActualizar = (actuales ?? []).filter(
    (a) => nuevos.has(a.component_id) && Number(a.quantity) !== nuevos.get(a.component_id),
  );
  const existentes = new Set((actuales ?? []).map((a) => a.component_id));
  const aInsertar = comps.filter((c) => !existentes.has(c.component_id));

  if (aBorrar.length) {
    const { error } = await db().from("kit_components").delete().in("id", aBorrar);
    if (error) backWithError(back, error.message);
  }
  for (const a of aActualizar) {
    const { error } = await db()
      .from("kit_components")
      .update({ quantity: nuevos.get(a.component_id) })
      .eq("id", a.id);
    if (error) backWithError(back, error.message);
  }
  if (aInsertar.length) {
    const { error } = await db()
      .from("kit_components")
      .insert(aInsertar.map((c) => ({ kit_id: kit.data, ...c })));
    if (error) backWithError(back, error.message);
  }
  if (!aBorrar.length && !aActualizar.length && !aInsertar.length) {
    okRedirect(back, "Sin cambios en el kit");
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "kit:set_components", entity: "products", entity_id: kit.data,
    detail: { kit: comps.map((c) => ({ componente: nombres.get(c.component_id), cantidad: c.quantity })) },
  });
  okRedirect(back, "Contenido del kit guardado");
}

// ── Armado / desarmado de kits ──────────────────────────────────────

const armadoSchema = z.object({
  kit: uuid,
  cantidad: numeroPositivo,
  ubicacion: uuid,
  idem: z.string().min(8),
});

export async function armarKits(formData: FormData) {
  const user = await requireSection("movimientos");
  const parsed = armadoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError("/productos", parsed.error.issues[0].message);
  const d = parsed.data;
  const back = `/productos/${d.kit}`;
  exigirUbicacion(user, d.ubicacion, back);
  const { error } = await db().rpc("assemble_kits", {
    p_kit: d.kit,
    p_qty: d.cantidad,
    p_location: d.ubicacion,
    p_actor: user.alias,
    p_idem: d.idem,
  });
  if (error) backWithError(back, error.message);
  okRedirect(back, `${d.cantidad} kit(s) armado(s): componentes descontados y kits sumados al stock`);
}

export async function desarmarKits(formData: FormData) {
  const user = await requireSection("movimientos");
  const parsed = armadoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError("/productos", parsed.error.issues[0].message);
  const d = parsed.data;
  const back = `/productos/${d.kit}`;
  exigirUbicacion(user, d.ubicacion, back);
  const { error } = await db().rpc("disassemble_kits", {
    p_kit: d.kit,
    p_qty: d.cantidad,
    p_location: d.ubicacion,
    p_actor: user.alias,
    p_idem: d.idem,
  });
  if (error) backWithError(back, error.message);
  okRedirect(back, `${d.cantidad} kit(s) desarmado(s): componentes devueltos al stock`);
}
