import "server-only";
import { db } from "../db";
import {
  createFulfillment,
  fijarInventarioV1,
  fijarInventarioV3,
  getCatalogVersion,
  getOrder,
  listarSkusV1,
  listarSkusV3,
  normalizarPedido,
  searchOrdersDesde,
  wixConfigurado,
  type PedidoNormalizado,
  type WixOrder,
} from "./client";

// Reglas de la integración. Cada evento (webhook o polling) termina en
// "reconciliar el pedido con su estado actual en Wix": se vuelve a leer el
// pedido y se aplica la regla que corresponda (reservar / vender POS / liberar /
// marcar procesado afuera). Así da igual el orden o la repetición de los eventos.

export type WixSettings = {
  enabled: boolean;
  paused_reason: string | null;
  paused_at: string | null;
  paused_by: string | null;
  activated_at: string | null;
  ignore_before?: string | null; // se corre al descartar la cola al reconectar
  sync_inventory: boolean;
  enable_tracking?: boolean; // activar seguimiento en Wix a productos que no lo tienen
  location_deposito: string | null;
  location_store: string | null;
  last_poll_at: string | null;
  catalog_version: string | null;
  last_reconcile_at?: string | null;
  last_reconcile_diffs?: number | null;
};

export async function getWixSettings(): Promise<WixSettings> {
  const { data, error } = await db().from("app_settings").select("value").eq("key", "wix").single();
  if (error) throw new Error(error.message);
  return data.value as WixSettings;
}

export async function patchWixSettings(patch: Partial<WixSettings>, actor: string) {
  const { error } = await db().rpc("wix_update_settings", { p_patch: patch, p_actor: actor });
  if (error) throw new Error(error.message);
}

const ACTOR = "wix";

// ── Reconciliar un pedido ───────────────────────────────────────────

export async function reconciliarPedido(o: WixOrder): Promise<string> {
  const settings = await getWixSettings();
  if (!settings.enabled) throw new Error("La integración con Wix está desconectada: no se aplican cambios");
  const n: PedidoNormalizado = normalizarPedido(o);
  const cli = db();
  // ya despachado / retirado: lo que había antes de esta lectura, para detectar ediciones en Wix
  const previo = await cli
    .from("channel_orders")
    .select("delivery_status, items:channel_order_items(external_line_id, quantity)")
    .eq("channel", "WIX")
    .eq("external_id", n.external_id)
    .maybeSingle();
  if (previo.error) throw new Error(previo.error.message);
  const up = await cli.rpc("wix_upsert_order", { p_order: n });
  if (up.error) throw new Error(`upsert: ${up.error.message}`);
  const orderId = up.data as string;
  const row = await cli.from("channel_orders").select("state, wix_fulfilled").eq("id", orderId).single();
  if (row.error) throw new Error(row.error.message);

  const cancelado =
    n.wix_status === "CANCELED" || ["FULLY_REFUNDED", "CANCELED", "DECLINED"].includes(n.payment_status ?? "");
  const pagado = ["PAID", "PARTIALLY_REFUNDED"].includes(n.payment_status ?? "");

  if (n.channel_type === "POS") {
    if (cancelado) return rpcTexto("wix_release_order", { p_order_id: orderId, p_reason: motivo(n), p_actor: ACTOR });
    // Wix crea el pedido POS con número 0 y lo numera segundos después: sin número
    // real no se descuenta (el motivo del movimiento es el N° de pedido); llega en el
    // evento siguiente (order_approved) o en el sondeo
    if (!n.number || n.number === "0") return "pos:esperando-numero";
    // primera vez descuenta todo; en corridas siguientes solo reintenta ítems con error / sin equivalencia
    if (n.wix_status === "APPROVED" || pagado) return rpcTexto("wix_pos_sale", { p_order_id: orderId, p_actor: ACTOR });
    return "pos:esperando";
  }

  if (cancelado) return rpcTexto("wix_release_order", { p_order_id: orderId, p_reason: motivo(n), p_actor: ACTOR });
  // el paquete ya salió (despachado / retirado): no se rearma ni se toca el stock, solo se avisa si cambió
  const entrega = previo.data?.delivery_status as string | null | undefined;
  if (entrega) {
    const antes = new Map((previo.data?.items ?? []).map((i) => [i.external_line_id, Number(i.quantity)]));
    const cambio = antes.size !== n.items.length || n.items.some((i) => antes.get(i.line_id) !== Number(i.quantity));
    const que = entrega === "PICKED_UP" ? "retirado" : "despachado";
    if (cambio) await cli.rpc("_wix_append_review", { p_order: orderId, p_text: `Editado en Wix después de ${que}: el paquete ya salió, revisar qué hacer con la diferencia` });
    if (n.payment_status === "PARTIALLY_REFUNDED") {
      await cli.rpc("_wix_append_review", { p_order: orderId, p_text: "Reembolso parcial en Wix: revisar qué se devuelve" });
    }
    if (n.fulfillment_status === "FULFILLED" && !row.data.wix_fulfilled) await cli.from("channel_orders").update({ wix_fulfilled: true }).eq("id", orderId);
    return `ya-${que}${cambio ? "+editado" : ""}`;
  }
  // pedido editado en Wix: antes de despachar la reserva sigue a Wix (cantidades, productos sacados);
  // ya despachado no se toca (lo agregado va en un pedido nuevo)
  const ed = await cli.rpc("wix_sync_order_items", { p_order_id: orderId, p_actor: ACTOR });
  if (ed.error) throw new Error(`wix_sync_order_items: ${ed.error.message}`);
  const edicion = ed.data as { resultado: string; avisos?: string[] };
  const marca = edicion.resultado.startsWith("editado") ? `+${edicion.resultado}` : "";
  if (!pagado) {
    for (const aviso of edicion.avisos ?? []) await cli.rpc("_wix_append_review", { p_order: orderId, p_text: aviso });
    return `esperando-pago:${n.payment_status}${marca}`;
  }

  // reservar es idempotente: agrega solo lo nuevo (ej. equivalencia cargada después)
  let res = (await rpcTexto("wix_reserve_order", { p_order_id: orderId, p_actor: ACTOR })) + marca;
  for (const aviso of edicion.avisos ?? []) await cli.rpc("_wix_append_review", { p_order: orderId, p_text: aviso });
  // etiqueta "Mayorista" en Wix → lo reservado sale como venta mayorista
  const tipo = await rpcTexto("wix_apply_order_tags", { p_order_id: orderId, p_actor: ACTOR });
  if (tipo !== "sin-cambios") res += `+${tipo}`;
  if (n.payment_status === "PARTIALLY_REFUNDED") {
    await cli.rpc("_wix_append_review", { p_order: orderId, p_text: "Reembolso parcial en Wix: revisar qué se devuelve" });
  }
  if (n.fulfillment_status === "FULFILLED" && !row.data.wix_fulfilled) {
    const after = await cli.from("channel_orders").select("state").eq("id", orderId).single();
    const st = after.data?.state;
    if (st === "RESERVED" || st === "PARTIAL") {
      await cli.rpc("wix_mark_fulfilled_externally", { p_order_id: orderId, p_actor: ACTOR });
      res += "+fulfilled-externally";
    } else {
      await cli.from("channel_orders").update({ wix_fulfilled: true }).eq("id", orderId);
    }
  }
  return res;
}

function motivo(n: PedidoNormalizado): string {
  if (n.wix_status === "CANCELED") return "Cancelado en Wix";
  if (n.payment_status === "FULLY_REFUNDED") return "Reembolsado en Wix";
  return `Pedido ${n.payment_status ?? n.wix_status ?? ""} en Wix`.trim();
}

async function rpcTexto(fn: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return String(data ?? "");
}

// ── Eventos (cola) ──────────────────────────────────────────────────

export async function registrarEvento(
  eventId: string,
  eventType: string,
  entityId: string | null,
  payload: unknown,
  source: "webhook" | "poll" | "manual"
): Promise<{ id: string; nuevo: boolean }> {
  const s = await getWixSettings();
  const { data, error } = await db().rpc("wix_record_event", {
    p_event_id: eventId,
    p_event_type: eventType,
    p_entity_id: entityId,
    p_payload: payload ?? {},
    p_source: source,
    p_status: s.enabled ? "PENDING" : "PAUSED",
  });
  if (error) throw new Error(error.message);
  const r = (data as { id: string; is_new: boolean }[])[0];
  return { id: r.id, nuevo: r.is_new };
}

export async function procesarEvento(eventId: string): Promise<string> {
  const cli = db();
  const ev = await cli.from("integration_events").select("*").eq("id", eventId).single();
  if (ev.error) throw new Error(ev.error.message);
  if (!["PENDING", "ERROR"].includes(ev.data.status)) return `omitido:${ev.data.status}`;
  const s = await getWixSettings();
  if (!s.enabled) {
    await cli.from("integration_events").update({ status: "PAUSED" }).eq("id", eventId);
    return "pausado";
  }
  // eventos de formato viejo (ej. OrderRefunded de Stores) no traen id de pedido:
  // el cambio llega igual por order_payment_status_updated / el sondeo
  if (!ev.data.entity_id) {
    await cli
      .from("integration_events")
      .update({ status: "SKIPPED", processed_at: new Date().toISOString(), attempts: ev.data.attempts + 1, result: "sin-pedido", error: null })
      .eq("id", eventId);
    return "sin-pedido";
  }
  try {
    const order = await getOrder(ev.data.entity_id);
    const res = await reconciliarPedido(order);
    await cli
      .from("integration_events")
      .update({ status: "DONE", processed_at: new Date().toISOString(), attempts: ev.data.attempts + 1, result: res, error: null })
      .eq("id", eventId);
    return res;
  } catch (e) {
    const msg = (e as Error).message;
    await cli
      .from("integration_events")
      .update({ status: "ERROR", processed_at: new Date().toISOString(), attempts: ev.data.attempts + 1, error: msg })
      .eq("id", eventId);
    return `error:${msg}`;
  }
}

// procesa lo pendiente (y errores con pocos intentos), de a uno y en orden
export async function procesarPendientes(limite = 50): Promise<{ procesados: number; errores: number }> {
  const { data, error } = await db()
    .from("integration_events")
    .select("id, status, attempts")
    .or("status.eq.PENDING,and(status.eq.ERROR,attempts.lt.5)")
    .order("received_at", { ascending: true })
    .limit(limite);
  if (error) throw new Error(error.message);
  let procesados = 0;
  let errores = 0;
  for (const ev of data ?? []) {
    const r = await procesarEvento(ev.id);
    if (r.startsWith("error:")) errores++;
    else procesados++;
  }
  return { procesados, errores };
}

export async function reanudarPausados(): Promise<number> {
  const { data, error } = await db().from("integration_events").update({ status: "PENDING" }).eq("status", "PAUSED").select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function descartarPausados(): Promise<number> {
  // lo que pasó mientras estaba desconectado ya se cargó a mano: no volver a leerlo
  const ahora = new Date().toISOString();
  await patchWixSettings({ ignore_before: ahora, last_poll_at: ahora }, ACTOR);
  const { data, error } = await db()
    .from("integration_events")
    .update({ status: "SKIPPED", processed_at: new Date().toISOString(), result: "descartado al reconectar" })
    .eq("status", "PAUSED")
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

// ── Polling de respaldo (por si un webhook se perdió) ───────────────

export async function sondearPedidos(): Promise<{ revisados: number; nuevos: number }> {
  const s = await getWixSettings();
  if (!s.enabled || !wixConfigurado()) return { revisados: 0, nuevos: 0 };
  const base = s.last_poll_at ?? s.activated_at ?? new Date(Date.now() - 86400_000).toISOString();
  const desde = new Date(new Date(base).getTime() - 60 * 60_000).toISOString(); // 1 h de margen
  const pedidos = await searchOrdersDesde(desde);
  let nuevos = 0;
  let maxUpd = new Date(base).getTime();
  for (const o of pedidos) {
    const upd = o.updatedDate ?? o.createdDate ?? "";
    const t = Date.parse(upd);
    if (Number.isFinite(t) && t > maxUpd) maxUpd = t;
    const { id, nuevo } = await registrarEvento(`poll:${o.id}:${upd}`, "poll.order", o.id, { number: o.number, updatedDate: upd }, "poll");
    if (!nuevo) continue;
    nuevos++;
    await procesarEvento(id);
  }
  await patchWixSettings({ last_poll_at: new Date(Math.max(maxUpd, Date.now() - 60 * 60_000)).toISOString() }, ACTOR);
  return { revisados: pedidos.length, nuevos };
}

// ── Fulfillment en Wix (después de procesar en Melania) ─────────────

export async function sincronizarFulfillments(batchId?: string): Promise<{ ok: number; errores: number }> {
  const s = await getWixSettings();
  if (!s.enabled) return { ok: 0, errores: 0 };
  const cli = db();
  let q = cli
    .from("channel_order_fulfillments")
    .select("id, order_id, quantity, wix_attempts, item:channel_order_items(external_line_id), order:channel_orders(external_id, number, wix_fulfilled, fulfillment_status)")
    .eq("wix_synced", false)
    .lt("wix_attempts", 5);
  if (batchId) q = q.eq("batch_id", batchId);
  const { data, error } = await q.order("wix_attempts", { ascending: true }).order("created_at", { ascending: true }).limit(100);
  if (error) throw new Error(error.message);
  type Row = {
    id: string;
    order_id: string;
    quantity: number;
    wix_attempts: number;
    item: { external_line_id: string } | null;
    order: { external_id: string; number: string | null; wix_fulfilled: boolean; fulfillment_status: string | null } | null;
  };
  const filas = (data ?? []) as unknown as Row[];
  // una llamada por pedido con todas sus líneas pendientes
  const porPedido = new Map<string, Row[]>();
  for (const f of filas) {
    const l = porPedido.get(f.order_id) ?? [];
    l.push(f);
    porPedido.set(f.order_id, l);
  }
  let ok = 0;
  let errores = 0;
  for (const [, grupo] of porPedido) {
    const ext = grupo[0].order?.external_id;
    if (!ext) continue;
    // ya lo marcaron procesado en Wix (a mano): no hay nada que crear
    if (grupo[0].order?.wix_fulfilled || grupo[0].order?.fulfillment_status === "FULFILLED") {
      await cli.from("channel_order_fulfillments").update({ wix_synced: true, wix_error: "ya estaba procesado en Wix" }).in("id", grupo.map((f) => f.id));
      ok += grupo.length;
      continue;
    }
    const lineas = new Map<string, number>();
    for (const f of grupo) {
      const lid = f.item?.external_line_id;
      if (!lid) continue;
      lineas.set(lid, (lineas.get(lid) ?? 0) + Number(f.quantity));
    }
    try {
      if (!wixConfigurado()) throw new Error("Wix no configurado");
      await createFulfillment(ext, [...lineas].map(([id, quantity]) => ({ id, quantity })));
      await cli.from("channel_order_fulfillments").update({ wix_synced: true, wix_error: null }).in("id", grupo.map((f) => f.id));
      ok += grupo.length;
    } catch (e) {
      const msg = (e as Error).message;
      for (const f of grupo) await cli.from("channel_order_fulfillments").update({ wix_error: msg, wix_attempts: f.wix_attempts + 1 }).eq("id", f.id);
      errores += grupo.length;
    }
  }
  return { ok, errores };
}

// ── Publicar disponible a Wix ───────────────────────────────────────

type EqLinea = { product_id: string; quantity: number };
type Eq = {
  id: string;
  external_sku: string;
  active: boolean;
  wix_product_id: string | null;
  wix_variant_id: string | null;
  wix_inventory_item_id: string | null;
  wix_tracked: boolean | null;
  lines: EqLinea[];
};

// disponible a publicar por SKU de Wix = mín. sobre sus productos de floor(disponible / cantidad)
export function disponibleSku(eq: { lines: EqLinea[] }, disp: Map<string, number>): number {
  let min = Infinity;
  for (const l of eq.lines) {
    const d = Math.floor(Math.max(0, disp.get(l.product_id) ?? 0) / Number(l.quantity));
    if (d < min) min = d;
  }
  return min === Infinity ? 0 : min;
}

export async function publicarInventario(todo = false): Promise<{ skus: number; errores: number; omitidos: number }> {
  const s = await getWixSettings();
  if (!s.enabled || !s.sync_inventory || !wixConfigurado() || !s.location_deposito) return { skus: 0, errores: 0, omitidos: 0 };
  const cli = db();
  // productos en cola (o todos). Se recuerda cuándo se leyó: lo encolado después no se borra.
  const leidoEn = new Date().toISOString();
  let productos: string[] = [];
  if (!todo) {
    const q = await cli.from("wix_sync_queue").select("product_id").lte("queued_at", leidoEn).limit(500);
    if (q.error) throw new Error(q.error.message);
    productos = (q.data ?? []).map((r) => r.product_id);
    if (productos.length === 0) return { skus: 0, errores: 0, omitidos: 0 };
  }
  const conError = new Set<string>(); // productos cuyo SKU falló: quedan en cola para reintentar
  // equivalencias afectadas
  let eqq = cli
    .from("channel_skus")
    .select("id, external_sku, active, wix_product_id, wix_variant_id, wix_inventory_item_id, wix_tracked, lines:channel_sku_lines(product_id, quantity)")
    .eq("active", true)
    .eq("publish_stock", true); // los MAYORISTA (marcadores internos) no reciben stock
  if (!todo) {
    const ids = await cli.from("channel_sku_lines").select("channel_sku_id").in("product_id", productos);
    if (ids.error) throw new Error(ids.error.message);
    const set = [...new Set((ids.data ?? []).map((r) => r.channel_sku_id))];
    if (set.length === 0) {
      await cli.from("wix_sync_queue").delete().in("product_id", productos).lte("queued_at", leidoEn);
      return { skus: 0, errores: 0, omitidos: 0 };
    }
    eqq = eqq.in("id", set);
  }
  const eqs = await eqq;
  if (eqs.error) throw new Error(eqs.error.message);
  const lista = (eqs.data ?? []) as unknown as Eq[];
  // disponible en Depósito de todos los productos involucrados
  const pids = [...new Set(lista.flatMap((e) => e.lines.map((l) => l.product_id)))];
  const disp = new Map<string, number>();
  if (pids.length) {
    const d = await cli.from("v_stock_disponible").select("product_id, available").eq("location_id", s.location_deposito).in("product_id", pids);
    if (d.error) throw new Error(d.error.message);
    for (const r of d.data ?? []) disp.set(r.product_id, Number(r.available));
  }
  const version = s.catalog_version ?? (await getCatalogVersion());
  let skus = 0;
  let errores = 0;
  let omitidos = 0;
  const ahora = new Date().toISOString();
  const marcar = (id: string, patch: Record<string, unknown>) => cli.from("channel_skus").update(patch).eq("id", id);

  if (version === "V3_CATALOG") {
    const items: { inventoryItemId: string; quantity: number; id: string }[] = [];
    for (const e of lista) {
      if (!e.wix_inventory_item_id || (e.wix_tracked !== true && !s.enable_tracking)) { omitidos++; continue; }
      items.push({ inventoryItemId: e.wix_inventory_item_id, quantity: disponibleSku(e, disp), id: e.id });
    }
    for (let i = 0; i < items.length; i += 500) {
      const lote = items.slice(i, i + 500);
      try {
        await fijarInventarioV3(lote);
        for (const it of lote) await marcar(it.id, { wix_last_qty: it.quantity, wix_last_sync_at: ahora, wix_sync_error: null });
        skus += lote.length;
      } catch (err) {
        for (const it of lote) await marcar(it.id, { wix_sync_error: (err as Error).message, wix_last_sync_at: ahora });
        for (const it of lote) for (const l of lista.find((e) => e.id === it.id)?.lines ?? []) conError.add(l.product_id);
        errores += lote.length;
      }
    }
  } else {
    // V1: una llamada por producto de Wix con sus variantes
    const porProducto = new Map<string, { eq: Eq; quantity: number }[]>();
    for (const e of lista) {
      // sin "activar seguimiento", solo se publica a productos que ya lo tienen (V1 manda trackQuantity:true siempre)
      if (!e.wix_product_id || !e.wix_variant_id || (e.wix_tracked !== true && !s.enable_tracking)) { omitidos++; continue; }
      const l = porProducto.get(e.wix_product_id) ?? [];
      l.push({ eq: e, quantity: disponibleSku(e, disp) });
      porProducto.set(e.wix_product_id, l);
    }
    for (const [productId, vars] of porProducto) {
      try {
        await fijarInventarioV1(productId, vars.map((v) => ({ variantId: v.eq.wix_variant_id!, quantity: v.quantity })));
        for (const v of vars) await marcar(v.eq.id, { wix_last_qty: v.quantity, wix_last_sync_at: ahora, wix_sync_error: null, wix_tracked: true });
        skus += vars.length;
      } catch (err) {
        for (const v of vars) await marcar(v.eq.id, { wix_sync_error: (err as Error).message, wix_last_sync_at: ahora });
        for (const v of vars) for (const l of v.eq.lines) conError.add(l.product_id);
        errores += vars.length;
      }
    }
  }
  const listos = productos.filter((pid) => !conError.has(pid));
  if (!todo && listos.length) await cli.from("wix_sync_queue").delete().in("product_id", listos).lte("queued_at", leidoEn);
  return { skus, errores, omitidos };
}

// ── Mapear catálogo de Wix ↔ equivalencias ──────────────────────────

export async function mapearCatalogo(actor: string): Promise<{ version: string; mapeados: number; faltanEnWix: string[]; sobranEnWix: string[]; sinSeguimiento: number }> {
  const version = await getCatalogVersion();
  const enWix = version === "V3_CATALOG" ? await listarSkusV3() : await listarSkusV1();
  const porSku = new Map(enWix.map((s) => [s.sku.toUpperCase(), s]));
  const cli = db();
  const eqs = await cli.from("channel_skus").select("id, external_sku");
  if (eqs.error) throw new Error(eqs.error.message);
  const ahora = new Date().toISOString();
  let mapeados = 0;
  const faltan: string[] = [];
  const nuestros = new Set<string>();
  for (const e of eqs.data ?? []) {
    nuestros.add(e.external_sku.toUpperCase());
    const w = porSku.get(e.external_sku.toUpperCase());
    if (!w) {
      faltan.push(e.external_sku);
      await cli.from("channel_skus").update({ wix_product_id: null, wix_variant_id: null, wix_inventory_item_id: null, wix_tracked: null, wix_mapped_at: ahora }).eq("id", e.id);
      continue;
    }
    await cli
      .from("channel_skus")
      .update({ wix_product_id: w.productId, wix_variant_id: w.variantId, wix_inventory_item_id: w.inventoryItemId, wix_tracked: w.tracked, wix_mapped_at: ahora })
      .eq("id", e.id);
    mapeados++;
  }
  const sobran = enWix.filter((s) => !nuestros.has(s.sku.toUpperCase())).map((s) => s.sku);
  await patchWixSettings({ catalog_version: version }, actor);
  await cli.from("audit_logs").insert({ actor, action: "wix:map_catalog", entity: "channel_skus", entity_id: null, detail: { version, mapeados, faltan, sobran } });
  return { version, mapeados, faltanEnWix: faltan, sobranEnWix: sobran, sinSeguimiento: enWix.filter((s) => s.tracked === false).length };
}

// ── Conciliación diaria de inventario ───────────────────────────────
// Compara lo que muestra Wix con lo que publicaríamos. Las diferencias quedan
// en auditoría y sus productos vuelven a la cola para publicarse de nuevo.

export async function conciliarInventario(actor = ACTOR): Promise<{ revisados: number; diferencias: number }> {
  const s = await getWixSettings();
  if (!s.enabled || !s.sync_inventory || !wixConfigurado() || !s.location_deposito) return { revisados: 0, diferencias: 0 };
  const version = s.catalog_version ?? (await getCatalogVersion());
  const enWix = version === "V3_CATALOG" ? await listarSkusV3() : await listarSkusV1();
  const porSku = new Map(enWix.map((w) => [w.sku.toUpperCase(), w]));
  const cli = db();
  const eqs = await cli
    .from("channel_skus")
    .select("id, external_sku, active, wix_product_id, wix_variant_id, wix_inventory_item_id, wix_tracked, lines:channel_sku_lines(product_id, quantity)")
    .eq("active", true)
    .eq("publish_stock", true); // los MAYORISTA (marcadores internos) no reciben stock
  if (eqs.error) throw new Error(eqs.error.message);
  const lista = (eqs.data ?? []) as unknown as Eq[];
  const disp = new Map<string, number>();
  const d = await cli.from("v_stock_disponible").select("product_id, available").eq("location_id", s.location_deposito);
  if (d.error) throw new Error(d.error.message);
  for (const r of d.data ?? []) disp.set(r.product_id, Number(r.available));

  let revisados = 0;
  const difs: { sku: string; wix: number | null; melania: number }[] = [];
  const reencolar = new Set<string>();
  for (const e of lista) {
    const w = porSku.get(e.external_sku.toUpperCase());
    if (!w || w.tracked !== true) continue; // sin seguimiento en Wix no hay cantidad que comparar
    revisados++;
    const nuestro = disponibleSku(e, disp);
    if (w.quantity !== nuestro) {
      difs.push({ sku: e.external_sku, wix: w.quantity, melania: nuestro });
      for (const l of e.lines) reencolar.add(l.product_id);
    }
  }
  if (reencolar.size) {
    const q = await cli.from("wix_sync_queue").upsert([...reencolar].map((product_id) => ({ product_id, queued_at: new Date().toISOString() })));
    if (q.error) throw new Error(q.error.message);
  }
  if (difs.length) {
    await cli.from("audit_logs").insert({ actor, action: "wix:inventory_diff", entity: "channel_skus", entity_id: null, detail: { revisados, diferencias: difs.slice(0, 200) } });
  }
  await patchWixSettings({ last_reconcile_at: new Date().toISOString(), last_reconcile_diffs: difs.length }, actor);
  return { revisados, diferencias: difs.length };
}

export async function probarConexion(): Promise<{ ok: boolean; detalle: string }> {
  try {
    if (!wixConfigurado()) return { ok: false, detalle: "Faltan variables WIX_APP_ID / WIX_APP_SECRET / WIX_INSTANCE_ID en el servidor" };
    const version = await getCatalogVersion();
    const pedidos = await searchOrdersDesde(new Date(Date.now() - 30 * 86400_000).toISOString(), 1);
    return { ok: true, detalle: `Conectado. Catálogo ${version}. ${pedidos.length} pedido(s) en los últimos 30 días (primera página).` };
  } catch (e) {
    return { ok: false, detalle: (e as Error).message };
  }
}

// corrida completa de mantenimiento (la llama el cron / botón "Sincronizar ahora")
export async function corridaSync(): Promise<Record<string, unknown>> {
  const s = await getWixSettings();
  if (!s.enabled) return { enabled: false };
  const pend = await procesarPendientes();
  const poll = await sondearPedidos();
  const ful = await sincronizarFulfillments();
  // una vez por día: conciliar antes de publicar, así lo que difiere sale en esta misma corrida
  let conciliacion: Record<string, unknown> | null = null;
  if (!s.last_reconcile_at || Date.now() - Date.parse(s.last_reconcile_at) > 86400_000) {
    conciliacion = await conciliarInventario().catch((e) => ({ error: (e as Error).message }));
  }
  const inv = await publicarInventario();
  return { enabled: true, pendientes: pend, poll, fulfillments: ful, conciliacion, inventario: inv };
}
