"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "../db";
import { requireRole, requireSection } from "../auth";
import { getOrder } from "./client";
import {
  conciliarInventario,
  corridaSync,
  descartarPausados,
  getWixSettings,
  mapearCatalogo,
  patchWixSettings,
  probarConexion,
  procesarEvento,
  procesarPendientes,
  publicarInventario,
  reanudarPausados,
  reconciliarPedido,
  sincronizarFulfillments,
} from "./processor";

function volverConError(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}
function volverOk(path: string, msg: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}
const uuid = z.string().uuid();

// ── Pedidos: marcar "A revisar" como resuelto (Yura, Mel, Joel) ──────
export async function marcarPedidoRevisado(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const id = uuid.safeParse(String(formData.get("pedido") ?? ""));
  if (!id.success) volverConError("/pedidos", "Pedido inválido");
  const back = `/pedidos/${id.data}`;
  const { error } = await db().rpc("wix_mark_reviewed", {
    p_order_id: id.data,
    p_note: String(formData.get("nota") ?? ""),
    p_actor: user.alias,
  });
  if (error) volverConError(back, error.message);
  volverOk(back, "Marcado como revisado: el aviso queda registrado en el historial");
}

// ── Pedidos: marcar procesado (egreso real con responsable) ─────────

export async function procesarPedido(formData: FormData) {
  const user = await requireSection("pedidos");
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) volverConError("/pedidos", "Pedido inválido");
  const back = `/pedidos/${id}`;
  // cantidades por ítem (en unidades del ítem de Wix); vacío o 0 = no se procesa
  const lineas: { item_id: string; quantity: number }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("item_")) continue;
    const itemId = k.slice(5);
    const q = Number(v);
    if (!uuid.safeParse(itemId).success) volverConError(back, "Ítem inválido");
    if (!Number.isInteger(q) || q < 0) volverConError(back, "Las cantidades deben ser enteras");
    if (q > 0) lineas.push({ item_id: itemId, quantity: q });
  }
  // si solo hay que sacar cosas del paquete (pedido editado en Wix), se procesa sin cantidades nuevas
  if (lineas.length === 0 && formData.get("devoluciones") !== "1") volverConError(back, "Indicá qué cantidades estás despachando");
  const batchRaw = String(formData.get("batch") ?? "");
  const batch = uuid.safeParse(batchRaw).success ? batchRaw : null; // evita doble envío del mismo formulario
  const { data, error } = await db().rpc("wix_process_order", {
    p_order_id: id,
    p_lines: lineas,
    p_actor_id: user.id,
    p_actor: user.alias,
    p_batch: batch,
  });
  if (error) volverConError(back, error.message);
  const r = data as { batch_id: string; repeated?: boolean; lines?: unknown[]; devueltos?: unknown[] };
  if (r.repeated) volverOk(back, "Ese despacho ya estaba registrado (no se descontó dos veces).");
  // avisar a Wix (si falla o está desconectado, el stock ya salió: queda pendiente y lo reintenta el cron)
  const settings = await getWixSettings();
  const ful = settings.enabled ? await sincronizarFulfillments(r.batch_id) : { ok: 0, errores: 0 };
  after(() => publicarInventario().catch(() => {}));
  const msg = !settings.enabled
    ? "Stock descontado. La integración está desconectada: Wix no se marcó (se hará al reconectar)."
    : ful.errores > 0
      ? "Stock descontado. No se pudo marcar en Wix todavía (se reintenta solo)."
      : (r.lines?.length ?? 0) === 0
        ? "Pedido rearmado: lo sacado del paquete volvió al stock del Depósito."
        : `Pedido procesado: stock descontado y marcado como procesado en Wix.${r.devueltos?.length ? " Lo sacado del paquete volvió al stock." : ""}`;
  volverOk(back, msg);
}

// volver a leer el pedido en Wix y aplicar las reglas
export async function actualizarPedidoDesdeWix(formData: FormData) {
  await requireSection("pedidos");
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) volverConError("/pedidos", "Pedido inválido");
  const back = `/pedidos/${id}`;
  const { data, error } = await db().from("channel_orders").select("external_id").eq("id", id).single();
  if (error) volverConError(back, error.message);
  let res: string;
  try {
    const o = await getOrder(data.external_id);
    res = await reconciliarPedido(o);
  } catch (e) {
    volverConError(back, (e as Error).message);
  }
  volverOk(back, `Actualizado desde Wix (${res})`);
}

// ── Ventas sin descontar: regularizar a mano ────────────────────────

const SIN_DESCONTAR = "/pedidos/sin-descontar";

// descontar: el operador elige el producto de Melania ("SKU · Nombre" del buscador) y la cantidad
export async function descontarItemWix(formData: FormData) {
  const user = await requireSection("pedidos");
  const item = String(formData.get("item") ?? "");
  if (!uuid.safeParse(item).success) volverConError(SIN_DESCONTAR, "Ítem inválido");
  const elegido = String(formData.get("producto") ?? "").trim();
  const sku = elegido.split(" · ")[0].trim();
  if (!sku) volverConError(SIN_DESCONTAR, "Elegí el producto de Melania");
  const cantidad = Number(formData.get("cantidad"));
  if (!(cantidad > 0)) volverConError(SIN_DESCONTAR, "La cantidad tiene que ser mayor a 0");
  const prod = await db().from("products").select("id").eq("sku", sku).maybeSingle();
  if (prod.error) volverConError(SIN_DESCONTAR, prod.error.message);
  if (!prod.data) volverConError(SIN_DESCONTAR, `No existe el producto "${elegido}": elegilo de la lista o crealo en Productos`);
  const { error } = await db().rpc("wix_settle_item", {
    p_item: item,
    p_product: prod.data.id,
    p_quantity: cantidad,
    p_actor: user.alias,
    p_note: String(formData.get("nota") ?? "").trim() || null,
  });
  if (error) volverConError(SIN_DESCONTAR, error.message);
  after(() => publicarInventario().catch(() => {}));
  volverOk(SIN_DESCONTAR, "Descontado del stock con el N° de pedido como motivo.");
}

export async function descartarItemWix(formData: FormData) {
  const user = await requireRole("ADMIN", "MANAGER");
  const item = String(formData.get("item") ?? "");
  if (!uuid.safeParse(item).success) volverConError(SIN_DESCONTAR, "Ítem inválido");
  const { error } = await db().rpc("wix_discard_item", {
    p_item: item,
    p_actor: user.alias,
    p_note: String(formData.get("motivo") ?? ""),
  });
  if (error) volverConError(SIN_DESCONTAR, error.message);
  volverOk(SIN_DESCONTAR, "Línea descartada (queda registrado quién y por qué).");
}

// ── Integración (solo ADMIN) ────────────────────────────────────────

export async function cambiarPulsador(formData: FormData) {
  const user = await requireRole("ADMIN");
  const encender = formData.get("accion") === "conectar";
  const motivo = String(formData.get("motivo") ?? "").trim();
  const modo = String(formData.get("pausados") ?? "procesar"); // procesar | descartar
  if (!encender && !motivo) volverConError("/wix", "Indicá el motivo de la desconexión (queda en la auditoría)");
  const { error } = await db().rpc("wix_set_enabled", { p_enabled: encender, p_actor: user.alias, p_reason: motivo || null });
  if (error) volverConError("/wix", error.message);
  if (encender) {
    const n = modo === "descartar" ? await descartarPausados() : await reanudarPausados();
    if (modo !== "descartar" && n > 0) after(() => procesarPendientes().catch(() => {}));
    volverOk("/wix", n > 0 ? `Conectado. ${n} evento(s) acumulados ${modo === "descartar" ? "descartados" : "en proceso"}.` : "Conectado a Wix.");
  }
  volverOk("/wix", "Desconectado de Wix. Las ventas se cargan a mano hasta volver a conectar.");
}

export async function cambiarOpcionesWix(formData: FormData) {
  const user = await requireRole("ADMIN");
  await patchWixSettings(
    { sync_inventory: formData.get("sync_inventory") === "si", enable_tracking: formData.get("enable_tracking") === "si" },
    user.alias
  );
  volverOk("/wix", "Opciones guardadas");
}

// botón "Actualizar ahora" en Pedidos Wix: lo mismo que el cron de 5 min, a demanda
export async function actualizarPedidosAhora() {
  await requireSection("pedidos");
  let r: Record<string, unknown>;
  try {
    r = await corridaSync();
  } catch (e) {
    volverConError("/pedidos", (e as Error).message);
  }
  if (!r.enabled) volverConError("/pedidos", "La integración con Wix está desconectada");
  const poll = r.poll as { revisados: number } | undefined;
  const ful = r.fulfillments as { ok: number; errores: number } | undefined;
  volverOk(
    "/pedidos",
    `Actualizado desde Wix: ${poll?.revisados ?? 0} pedido(s) revisados` +
      (ful?.ok ? `, ${ful.ok} despacho(s) enviados a Wix` : "") +
      (ful?.errores ? `, ${ful.errores} despacho(s) con error` : "")
  );
}

export async function sincronizarAhora() {
  await requireRole("ADMIN");
  let r: Record<string, unknown>;
  try {
    r = await corridaSync();
  } catch (e) {
    volverConError("/wix", (e as Error).message);
  }
  volverOk("/wix", `Sincronización: ${JSON.stringify(r)}`);
}

export async function publicarTodoElStock() {
  await requireRole("ADMIN");
  let r: Awaited<ReturnType<typeof publicarInventario>>;
  try {
    r = await publicarInventario(true);
  } catch (e) {
    volverConError("/wix", (e as Error).message);
  }
  volverOk("/wix", `Publicado a Wix: ${r.skus} SKU, ${r.errores} con error, ${r.omitidos} omitidos (sin mapeo o sin seguimiento)`);
}

export async function conciliarStockWix() {
  const user = await requireRole("ADMIN");
  let r: Awaited<ReturnType<typeof conciliarInventario>>;
  try {
    r = await conciliarInventario(user.alias);
    if (r.diferencias) await publicarInventario();
  } catch (e) {
    volverConError("/wix", (e as Error).message);
  }
  volverOk("/wix", r.revisados === 0
    ? "Nada para conciliar (integración apagada, publicación desactivada o sin SKU con seguimiento)"
    : `Conciliación: ${r.revisados} SKU revisados, ${r.diferencias} con diferencia${r.diferencias ? " (corregidos)" : ""}`);
}

export async function mapearCatalogoWix() {
  const user = await requireRole("ADMIN");
  let r: Awaited<ReturnType<typeof mapearCatalogo>>;
  try {
    r = await mapearCatalogo(user.alias);
  } catch (e) {
    volverConError("/wix", (e as Error).message);
  }
  {
    const faltan = r.faltanEnWix.length ? ` Sin producto en Wix: ${r.faltanEnWix.slice(0, 15).join(", ")}${r.faltanEnWix.length > 15 ? "…" : ""}.` : "";
    const sobran = r.sobranEnWix.length ? ` SKU de Wix sin equivalencia: ${r.sobranEnWix.slice(0, 15).join(", ")}${r.sobranEnWix.length > 15 ? "…" : ""}.` : "";
    volverOk("/wix", `Catálogo ${r.version}: ${r.mapeados} SKU mapeados, ${r.sinSeguimiento} sin seguimiento de inventario en Wix.${faltan}${sobran}`);
  }
}

export async function probarConexionWix() {
  await requireRole("ADMIN");
  const r = await probarConexion();
  if (r.ok) volverOk("/wix", r.detalle);
  volverConError("/wix", r.detalle);
}

export async function reintentarEvento(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) volverConError("/wix", "Evento inválido");
  await db().from("integration_events").update({ status: "PENDING" }).eq("id", id);
  const r = await procesarEvento(id);
  if (r.startsWith("error:")) volverConError("/wix", r.slice(6));
  volverOk("/wix", `Evento procesado (${r})`);
}
