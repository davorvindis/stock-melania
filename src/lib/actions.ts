"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
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
  actor: z.string().trim().min(1, "Indicá quién registra el ingreso"),
  notas: z.string().trim().optional(),
  idem: z.string().min(8),
});

export async function registrarIngreso(formData: FormData) {
  const back = "/ingresos/nuevo";
  const parsed = ingresoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;

  const costoTotal = d.costo_total ? parseFloat(d.costo_total) : null;
  const costoUnitario = d.costo_unitario ? parseFloat(d.costo_unitario) : null;
  if (costoTotal !== null && (isNaN(costoTotal) || costoTotal < 0)) backWithError(back, "Costo total inválido");
  if (costoUnitario !== null && (isNaN(costoUnitario) || costoUnitario < 0)) backWithError(back, "Costo unitario inválido");

  const { error } = await db().rpc("create_stock_entry", {
    p_entry_date: d.fecha,
    p_supplier: d.proveedor || null,
    p_remito: d.remito || null,
    p_invoice: d.factura || null,
    p_notes: d.notas || null,
    p_actor: d.actor,
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

const movimientoSchema = z.object({
  tipo: z.enum(OPERABLE_TYPES),
  origen: z.string().min(1, "Elegí el stock de origen"), // "productId|lotId|locationId"
  cantidad: numeroPositivo,
  destino: z.string().optional(),
  motivo: z.string().trim().optional(),
  actor: z.string().trim().min(1, "Indicá quién realiza el movimiento"),
  notas: z.string().trim().optional(),
  idem: z.string().min(8),
});

export async function registrarMovimiento(formData: FormData) {
  const back = "/movimientos/nuevo";
  const parsed = movimientoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;

  const [productId, lotId, fromId] = d.origen.split("|");
  if (!productId || !fromId) backWithError(back, "Origen inválido");

  const needsDest = NEEDS_DESTINATION.includes(d.tipo);
  if (needsDest && !d.destino) backWithError(back, "Este tipo de movimiento necesita ubicación destino");
  if (needsDest && d.destino === fromId) backWithError(back, "Origen y destino no pueden ser iguales");
  if (d.tipo === "OTHER" && !d.motivo) backWithError(back, "El tipo 'Otro' exige un motivo");

  const { error } = await db().rpc("apply_movement", {
    p_type: d.tipo,
    p_product: productId,
    p_lot: lotId || null,
    p_quantity: d.cantidad,
    p_from: fromId,
    p_to: needsDest ? d.destino : null,
    p_actor: d.actor,
    p_reason: d.motivo || null,
    p_notes: d.notas || null,
    p_idem: d.idem,
  });
  if (error) backWithError(back, error.message);
  okRedirect("/movimientos", "Movimiento registrado");
}

// ── Reversión ───────────────────────────────────────────────────────

const reversionSchema = z.object({
  movimiento: uuid,
  actor: z.string().trim().min(1, "Indicá quién revierte"),
  motivo: z.string().trim().min(3, "Explicá el motivo de la reversión"),
});

export async function revertirMovimiento(formData: FormData) {
  const back = "/movimientos";
  const parsed = reversionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const { error } = await db().rpc("reverse_movement", {
    p_movement: d.movimiento,
    p_actor: d.actor,
    p_reason: d.motivo,
  });
  if (error) backWithError(back, error.message);
  okRedirect("/movimientos", "Movimiento revertido");
}

// ── Producto ────────────────────────────────────────────────────────

const productoSchema = z.object({
  sku: z.string().trim().min(1, "Falta el SKU"),
  nombre: z.string().trim().min(1, "Falta el nombre"),
  categoria: z.string().trim().optional(),
  unidad: z.string().trim().min(1, "Falta la unidad"),
  tipo: z.enum(["TERMINADO", "MONODOSIS", "INSUMO", "PACKAGING", "GRANEL", "ACCESORIO"]),
  stock_minimo: z.coerce.number().min(0).default(0),
});

export async function crearProducto(formData: FormData) {
  const back = "/productos";
  const parsed = productoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backWithError(back, parsed.error.issues[0].message);
  const d = parsed.data;
  const { error } = await db().from("products").insert({
    sku: d.sku,
    name: d.nombre,
    category: d.categoria || null,
    unit: d.unidad,
    type: d.tipo,
    min_stock: d.stock_minimo,
  });
  if (error) {
    backWithError(back, error.code === "23505" ? `El SKU "${d.sku}" ya existe` : error.message);
  }
  okRedirect("/productos", `Producto ${d.sku} creado`);
}

// ── Proveedor ───────────────────────────────────────────────────────

const proveedorSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre"),
  cuit: z.string().trim().optional(),
  contacto: z.string().trim().optional(),
});

export async function crearProveedor(formData: FormData) {
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
