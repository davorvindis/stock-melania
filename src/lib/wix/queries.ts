import "server-only";
import { db } from "../db";

export type PedidoWix = {
  id: string;
  external_id: string;
  number: string | null;
  channel_type: string | null;
  customer: string | null;
  email: string | null;
  wix_status: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  state: "NEW" | "RESERVED" | "PARTIAL" | "PROCESSED" | "RELEASED" | "CANCELED" | "IGNORED";
  location: { id: string; name: string } | null;
  total: number | null;
  currency: string | null;
  ordered_at: string | null;
  paid_at: string | null;
  processed_at: string | null;
  processed_by: string | null;
  review_reason: string | null;
  wix_fulfilled: boolean;
  created_at: string;
  updated_at: string;
};

export type ItemPedido = {
  id: string;
  external_line_id: string;
  external_sku: string | null;
  name: string | null;
  quantity: number;
  unit_price: number | null;
  resolved: boolean;
  note: string | null;
  reservations: {
    id: string;
    per_unit: number;
    quantity: number;
    consumed: number;
    released: number;
    status: "ACTIVE" | "CONSUMED" | "RELEASED";
    sale_type: string;
    product: { id: string; sku: string; name: string; unit: string };
  }[];
};

export type Fulfillment = { id: string; quantity: number; actor: string; created_at: string; wix_synced: boolean; wix_error: string | null; item_id: string };

export const ESTADOS_PEDIDO: Record<PedidoWix["state"], string> = {
  NEW: "Nuevo",
  RESERVED: "Reservado",
  PARTIAL: "Parcial",
  PROCESSED: "Procesado",
  RELEASED: "Liberado",
  CANCELED: "Cancelado",
  IGNORED: "Ignorado",
};

const SELECT = "id, external_id, number, channel_type, customer, email, wix_status, payment_status, fulfillment_status, state, location:locations(id, name), total, currency, ordered_at, paid_at, processed_at, processed_by, review_reason, wix_fulfilled, created_at, updated_at";

export async function getPedidosWix(f: { estado?: string; canal?: string; q?: string; desde?: string; hasta?: string; revisar?: boolean; limite?: number }): Promise<PedidoWix[]> {
  let q = db().from("channel_orders").select(SELECT).order("ordered_at", { ascending: false, nullsFirst: false }).limit(f.limite ?? 300);
  if (f.estado === "pendientes") q = q.in("state", ["RESERVED", "PARTIAL"]);
  else if (f.estado) q = q.eq("state", f.estado);
  if (f.canal === "POS") q = q.eq("channel_type", "POS");
  else if (f.canal === "WEB") q = q.neq("channel_type", "POS");
  if (f.revisar) q = q.not("review_reason", "is", null);
  if (f.desde) q = q.gte("ordered_at", `${f.desde}T00:00:00-03:00`);
  if (f.hasta) q = q.lte("ordered_at", `${f.hasta}T23:59:59-03:00`);
  if (f.q) {
    const t = f.q.replace(/[%,]/g, "").trim();
    if (t) q = q.or(`number.ilike.%${t}%,customer.ilike.%${t}%,email.ilike.%${t}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PedidoWix[];
}

export async function getPedidoWix(id: string): Promise<{ pedido: PedidoWix; items: ItemPedido[]; fulfillments: Fulfillment[] } | null> {
  const cli = db();
  const [p, it, fu] = await Promise.all([
    cli.from("channel_orders").select(SELECT).eq("id", id).maybeSingle(),
    cli
      .from("channel_order_items")
      .select("id, external_line_id, external_sku, name, quantity, unit_price, resolved, note, reservations(id, per_unit, quantity, consumed, released, status, sale_type, product:products(id, sku, name, unit))")
      .eq("order_id", id)
      .order("external_line_id"),
    cli.from("channel_order_fulfillments").select("id, quantity, actor, created_at, wix_synced, wix_error, item_id").eq("order_id", id).order("created_at"),
  ]);
  for (const r of [p, it, fu]) if (r.error) throw new Error(r.error.message);
  if (!p.data) return null;
  return { pedido: p.data as unknown as PedidoWix, items: (it.data ?? []) as unknown as ItemPedido[], fulfillments: (fu.data ?? []) as Fulfillment[] };
}

// unidades del ítem todavía reservadas (mínimo entre sus productos)
export function pendientesItem(it: ItemPedido): number {
  const act = it.reservations.filter((r) => r.status === "ACTIVE");
  if (act.length === 0) return 0;
  return Math.min(...act.map((r) => Math.floor((Number(r.quantity) - Number(r.consumed) - Number(r.released)) / Number(r.per_unit))));
}

// disponible por producto en una ubicación (vista v_stock_disponible)
export async function getDisponibles(locationId: string, productIds?: string[]): Promise<Map<string, { on_hand: number; sellable: number; reserved: number; available: number }>> {
  let q = db().from("v_stock_disponible").select("product_id, on_hand, sellable, reserved, available").eq("location_id", locationId);
  if (productIds && productIds.length) q = q.in("product_id", productIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.product_id, { on_hand: Number(r.on_hand), sellable: Number(r.sellable), reserved: Number(r.reserved), available: Number(r.available) }]));
}

// reservado por producto+ubicación (para Stock y Nuevo movimiento)
export async function getReservados(): Promise<Map<string, number>> {
  const { data, error } = await db().from("v_stock_disponible").select("product_id, location_id, reserved").gt("reserved", 0);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [`${r.product_id}|${r.location_id}`, Number(r.reserved)]));
}

// avisos para el Dashboard
export async function getAvisosWix(): Promise<{ demorados: PedidoWix[]; revisar: PedidoWix[]; enabled: boolean; configurado: boolean }> {
  const cli = db();
  const hace3 = new Date(Date.now() - 3 * 86400_000).toISOString();
  const [s, dem, rev] = await Promise.all([
    cli.from("app_settings").select("value").eq("key", "wix").single(),
    cli.from("channel_orders").select(SELECT).in("state", ["RESERVED", "PARTIAL"]).lt("paid_at", hace3).order("paid_at"),
    cli.from("channel_orders").select(SELECT).not("review_reason", "is", null).not("state", "in", "(IGNORED)").order("updated_at", { ascending: false }).limit(50),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (dem.error) throw new Error(dem.error.message);
  if (rev.error) throw new Error(rev.error.message);
  const v = s.data.value as { enabled: boolean; activated_at: string | null };
  return {
    demorados: (dem.data ?? []) as unknown as PedidoWix[],
    revisar: (rev.data ?? []) as unknown as PedidoWix[],
    enabled: !!v.enabled,
    configurado: !!v.activated_at,
  };
}

export type EventoRow = {
  id: string;
  event_id: string;
  event_type: string;
  entity_id: string | null;
  source: string;
  received_at: string;
  processed_at: string | null;
  status: string;
  attempts: number;
  result: string | null;
  error: string | null;
};

export async function getEventosWix(limite = 60): Promise<EventoRow[]> {
  const { data, error } = await db()
    .from("integration_events")
    .select("id, event_id, event_type, entity_id, source, received_at, processed_at, status, attempts, result, error")
    .order("received_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventoRow[];
}

export async function contarEventos(): Promise<Record<string, number>> {
  const c: Record<string, number> = {};
  await Promise.all(
    ["PENDING", "PAUSED", "ERROR"].map(async (st) => {
      const { count, error } = await db().from("integration_events").select("id", { count: "exact", head: true }).eq("status", st);
      if (error) throw new Error(error.message);
      c[st] = count ?? 0;
    })
  );
  return c;
}

export async function resumenEquivalenciasWix(): Promise<{ total: number; mapeadas: number; sinSeguimiento: number; conError: number; ultimaSync: string | null }> {
  const { data, error } = await db().from("channel_skus").select("wix_product_id, wix_tracked, wix_sync_error, wix_last_sync_at").eq("active", true);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  let ultima: string | null = null;
  for (const r of rows) if (r.wix_last_sync_at && (!ultima || r.wix_last_sync_at > ultima)) ultima = r.wix_last_sync_at;
  return {
    total: rows.length,
    mapeadas: rows.filter((r) => r.wix_product_id).length,
    sinSeguimiento: rows.filter((r) => r.wix_tracked === false).length,
    conError: rows.filter((r) => r.wix_sync_error).length,
    ultimaSync: ultima,
  };
}

// ── Ventas sin descontar (sin SKU / sin equivalencia / sin stock) ───

export type SinDescontar = {
  item_id: string;
  order_id: string;
  number: string | null;
  channel_type: string | null;
  state: string;
  ordered_at: string | null;
  customer: string | null;
  external_sku: string | null;
  name: string | null;
  quantity: number;
  note: string | null;
};

export async function getSinDescontar(): Promise<SinDescontar[]> {
  const { data, error } = await db().from("v_wix_sin_descontar").select("*").order("ordered_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as SinDescontar[];
}

export async function contarSinDescontar(): Promise<number> {
  const { count, error } = await db().from("v_wix_sin_descontar").select("item_id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type Regularizado = {
  id: string;
  name: string | null;
  external_sku: string | null;
  quantity: number;
  settled_at: string;
  settled_by: string;
  settled_action: "DESCONTADO" | "DESCARTADO";
  settled_quantity: number | null;
  settled_note: string | null;
  order: { id: string; number: string | null; channel_type: string | null };
  product: { sku: string; name: string } | null;
};

export async function getRegularizados(limite = 50): Promise<Regularizado[]> {
  const { data, error } = await db()
    .from("channel_order_items")
    .select(
      "id, name, external_sku, quantity, settled_at, settled_by, settled_action, settled_quantity, settled_note, order:channel_orders(id, number, channel_type), product:products!channel_order_items_settled_product_id_fkey(sku, name)"
    )
    .not("settled_at", "is", null)
    .order("settled_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Regularizado[];
}
