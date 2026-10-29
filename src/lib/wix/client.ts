import "server-only";
import { createVerify } from "crypto";

// Cliente de la API de Wix (app custom, OAuth client_credentials). Solo servidor.
// Variables: WIX_APP_ID, WIX_APP_SECRET, WIX_INSTANCE_ID, WIX_PUBLIC_KEY (PEM, \n escapados).

const BASE = "https://www.wixapis.com";
const VARIANTE_UNICA = "00000000-0000-0000-0000-000000000000"; // producto sin variantes (catálogo V1)

export function wixConfigurado(): boolean {
  return !!(process.env.WIX_APP_ID && process.env.WIX_APP_SECRET && process.env.WIX_INSTANCE_ID);
}

let tokenCache: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const r = await fetch(`${BASE}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.WIX_APP_ID,
      client_secret: process.env.WIX_APP_SECRET,
      instance_id: process.env.WIX_INSTANCE_ID,
    }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Wix: no se pudo obtener token (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { access_token: string; expires_in?: number };
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 14400) * 1000 };
  return j.access_token;
}

export async function wixFetch<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}, reintento = true): Promise<T> {
  if (!wixConfigurado()) throw new Error("Wix no está configurado (faltan variables de entorno)");
  const token = await getToken();
  const r = await fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: token, "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (r.status === 401 && reintento) {
    tokenCache = null;
    return wixFetch<T>(path, init, false);
  }
  if (r.status === 429 && reintento) {
    await new Promise((res) => setTimeout(res, 2500));
    return wixFetch<T>(path, init, false);
  }
  if (!r.ok) throw new Error(`Wix ${init.method ?? "GET"} ${path} → ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const txt = await r.text();
  return (txt ? JSON.parse(txt) : {}) as T;
}

// ── Pedidos (eCommerce) ─────────────────────────────────────────────

export type WixOrder = {
  id: string;
  number?: string | number;
  createdDate?: string;
  updatedDate?: string;
  status?: string; // INITIALIZED | APPROVED | CANCELED | PENDING | REJECTED
  paymentStatus?: string; // PAID | NOT_PAID | FULLY_REFUNDED | PARTIALLY_REFUNDED | PENDING | PARTIALLY_PAID | ...
  fulfillmentStatus?: string; // NOT_FULFILLED | PARTIALLY_FULFILLED | FULFILLED
  archived?: boolean;
  currency?: string;
  channelInfo?: { type?: string };
  buyerInfo?: { email?: string; contactId?: string };
  billingInfo?: { contactDetails?: { firstName?: string; lastName?: string; company?: string } };
  recipientInfo?: { contactDetails?: { firstName?: string; lastName?: string; company?: string } };
  priceSummary?: { total?: { amount?: string } };
  shippingInfo?: { title?: string } | null; // método de entrega; los pedidos manuales pueden no tenerlo
  lineItems?: {
    id: string;
    quantity: number;
    productName?: { original?: string; translated?: string };
    itemType?: { preset?: string; custom?: string };
    physicalProperties?: { sku?: string };
    catalogReference?: { catalogItemId?: string; appId?: string; options?: { variantId?: string } };
    price?: { amount?: string };
  }[];
};

export type PedidoNormalizado = {
  external_id: string;
  number: string | null;
  channel_type: string;
  customer: string | null;
  email: string | null;
  wix_status: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  total: number | null;
  currency: string | null;
  ordered_at: string | null;
  updated_at: string | null;
  raw: WixOrder;
  items: { line_id: string; sku: string | null; name: string | null; quantity: number; unit_price: number | null }[];
};

// servicios (turnos de Wix Bookings): no son productos, no mueven stock
const APP_BOOKINGS = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
export function esServicio(li: NonNullable<WixOrder["lineItems"]>[number]): boolean {
  return li.itemType?.preset === "SERVICE" || li.catalogReference?.appId === APP_BOOKINGS;
}
export function soloServicios(o: WixOrder): boolean {
  return (o.lineItems ?? []).length > 0 && (o.lineItems ?? []).every(esServicio);
}

export function normalizarPedido(o: WixOrder): PedidoNormalizado {
  // la facturación puede venir vacía ({}), ej. compra como invitada: se usa el destinatario del envío
  const nombreDe = (c?: { firstName?: string; lastName?: string; company?: string }) =>
    [c?.firstName?.trim(), c?.lastName?.trim()].filter(Boolean).join(" ") || c?.company?.trim() || null;
  const nombre = nombreDe(o.billingInfo?.contactDetails) ?? nombreDe(o.recipientInfo?.contactDetails);
  return {
    external_id: o.id,
    number: o.number != null ? String(o.number) : null,
    channel_type: o.channelInfo?.type ?? "UNSPECIFIED",
    customer: nombre,
    email: o.buyerInfo?.email ?? null,
    wix_status: o.status ?? null,
    payment_status: o.paymentStatus ?? null,
    fulfillment_status: o.fulfillmentStatus ?? null,
    total: o.priceSummary?.total?.amount != null ? Number(o.priceSummary.total.amount) : null,
    currency: o.currency ?? null,
    ordered_at: o.createdDate ?? null,
    updated_at: o.updatedDate ?? null,
    raw: o,
    items: (o.lineItems ?? []).filter((li) => !esServicio(li)).map((li) => ({
      line_id: li.id,
      sku: li.physicalProperties?.sku?.trim() || null,
      name: li.productName?.original ?? li.productName?.translated ?? null,
      quantity: Number(li.quantity),
      unit_price: li.price?.amount != null ? Number(li.price.amount) : null,
    })),
  };
}

export async function getOrder(id: string): Promise<WixOrder> {
  const r = await wixFetch<{ order: WixOrder }>(`/ecom/v1/orders/${id}`);
  return r.order;
}

// pedidos modificados después de una fecha, en orden ascendente (paginado por cursor)
export async function searchOrdersDesde(desdeIso: string, maxPaginas = 20): Promise<WixOrder[]> {
  const out: WixOrder[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPaginas; i++) {
    const body: Record<string, unknown> = cursor
      ? { search: { cursorPaging: { cursor, limit: 100 } } }
      : {
          search: {
            filter: { updatedDate: { $gt: desdeIso } },
            sort: [{ fieldName: "updatedDate", order: "ASC" }],
            cursorPaging: { limit: 100 },
          },
        };
    const r = await wixFetch<{ orders?: WixOrder[]; metadata?: { cursors?: { next?: string }; hasNext?: boolean } }>(
      "/ecom/v1/orders/search",
      { body }
    );
    out.push(...(r.orders ?? []));
    if (!r.metadata?.hasNext || !r.metadata.cursors?.next) break;
    cursor = r.metadata.cursors.next;
  }
  return out;
}

// seguimiento de Correo Argentino: no es un proveedor predefinido de Wix, el link se pasa a mano
// (el formulario de seguimiento de envíos e-commerce del Correo)
function trackingInfo(numero: string) {
  return { trackingNumber: numero, shippingProvider: "Correo Argentino", trackingLink: "https://www.correoargentino.com.ar/formularios/e-commerce" };
}

export async function createFulfillment(orderId: string, lineItems: { id: string; quantity: number }[], seguimiento?: string | null) {
  return wixFetch<{ orderWithFulfillments?: unknown; fulfillmentId?: string }>(
    `/ecom/v1/fulfillments/orders/${orderId}/create-fulfillment`,
    { body: { fulfillment: seguimiento ? { lineItems, trackingInfo: trackingInfo(seguimiento) } : { lineItems } } }
  );
}

// envíos (fulfillments) ya creados en Wix para un pedido
export async function listFulfillments(orderId: string) {
  const r = await wixFetch<{ orderWithFulfillments?: { fulfillments?: { id: string; createdDate?: string; trackingInfo?: { trackingNumber?: string } }[] } }>(
    `/ecom/v1/fulfillments/orders/${orderId}`
  );
  return r.orderWithFulfillments?.fulfillments ?? [];
}

// cargar o cambiar el seguimiento de un envío (Wix puede mandarle el email a la clienta, según su configuración)
export async function updateFulfillmentTracking(orderId: string, fulfillmentId: string, seguimiento: string) {
  return wixFetch(`/ecom/v1/fulfillments/${fulfillmentId}/orders/${orderId}`, {
    method: "PATCH",
    body: { fulfillment: { trackingInfo: trackingInfo(seguimiento) } },
  });
}

// ── Catálogo e inventario ───────────────────────────────────────────

export type CatalogVersion = "V1_CATALOG" | "V3_CATALOG" | "STORES_NOT_INSTALLED" | string;

export async function getCatalogVersion(): Promise<CatalogVersion> {
  const r = await wixFetch<{ catalogVersion?: string }>("/stores/v3/provision/version");
  return r.catalogVersion ?? "UNKNOWN";
}

export type SkuEnWix = {
  sku: string;
  productId: string;
  variantId: string;
  inventoryItemId: string | null;
  tracked: boolean | null;
  quantity: number | null;
  name: string | null;
};

// V1: todos los productos con variantes → SKU → ids
export async function listarSkusV1(): Promise<SkuEnWix[]> {
  type Prod = {
    id: string;
    name?: string;
    sku?: string;
    manageVariants?: boolean;
    inventoryItemId?: string;
    stock?: { trackQuantity?: boolean; quantity?: number; inStock?: boolean };
    variants?: { id: string; variant?: { sku?: string }; stock?: { trackQuantity?: boolean; quantity?: number } }[];
  };
  const out: SkuEnWix[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const r = await wixFetch<{ products?: Prod[]; totalResults?: number }>("/stores/v1/products/query", {
      body: { includeVariants: true, includeHiddenProducts: true, query: { paging: { limit: 100, offset } } },
    });
    const ps = r.products ?? [];
    for (const p of ps) {
      const tracked = p.stock?.trackQuantity ?? null;
      if (p.manageVariants && p.variants?.length) {
        for (const v of p.variants) {
          const sku = v.variant?.sku?.trim();
          if (!sku) continue;
          out.push({ sku, productId: p.id, variantId: v.id, inventoryItemId: p.inventoryItemId ?? null, tracked, quantity: v.stock?.quantity ?? null, name: p.name ?? null });
        }
      } else if (p.sku?.trim()) {
        out.push({ sku: p.sku.trim(), productId: p.id, variantId: VARIANTE_UNICA, inventoryItemId: p.inventoryItemId ?? null, tracked, quantity: p.stock?.quantity ?? null, name: p.name ?? null });
      }
    }
    if (ps.length < 100) break;
  }
  return out;
}

// V3: ítems de inventario (uno por variante) → SKU → ids
export async function listarSkusV3(): Promise<SkuEnWix[]> {
  type Item = {
    id: string;
    revision?: string;
    productId: string;
    variantId: string;
    trackQuantity?: boolean;
    quantity?: number;
    product?: { variantSku?: string; name?: string };
  };
  const out: SkuEnWix[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await wixFetch<{ inventoryItems?: Item[]; pagingMetadata?: { cursors?: { next?: string }; hasNext?: boolean } }>(
      "/stores/v3/inventory-items/search",
      { body: { search: cursor ? { cursorPaging: { cursor, limit: 1000 } } : { cursorPaging: { limit: 1000 } } } }
    );
    for (const it of r.inventoryItems ?? []) {
      const sku = it.product?.variantSku?.trim();
      if (!sku) continue;
      out.push({ sku, productId: it.productId, variantId: it.variantId, inventoryItemId: it.id, tracked: it.trackQuantity ?? null, quantity: it.quantity ?? null, name: it.product?.name ?? null });
    }
    if (!r.pagingMetadata?.hasNext || !r.pagingMetadata.cursors?.next) break;
    cursor = r.pagingMetadata.cursors.next;
  }
  return out;
}

// V1: fija cantidades por variante (siempre con trackQuantity, si no Wix desactiva el seguimiento)
export async function fijarInventarioV1(productId: string, variants: { variantId: string; quantity: number }[]) {
  return wixFetch(`/stores/v2/inventoryItems/product/${productId}`, {
    method: "PATCH",
    body: { inventoryItem: { productId, trackQuantity: true, variants } },
  });
}

// V3: lee revisión fresca y actualiza cantidades en lote
export async function fijarInventarioV3(items: { inventoryItemId: string; quantity: number }[]) {
  if (items.length === 0) return;
  const ids = items.map((i) => i.inventoryItemId);
  const r = await wixFetch<{ inventoryItems?: { id: string; revision: string }[] }>("/stores/v3/inventory-items/search", {
    body: { search: { filter: { id: { $in: ids } }, cursorPaging: { limit: 1000 } } },
  });
  const rev = new Map((r.inventoryItems ?? []).map((i) => [i.id, i.revision]));
  const body = {
    inventoryItems: items
      .filter((i) => rev.has(i.inventoryItemId))
      .map((i) => ({ inventoryItem: { id: i.inventoryItemId, revision: rev.get(i.inventoryItemId), quantity: i.quantity } })),
    reason: "MANUAL",
    returnEntity: false,
  };
  if (body.inventoryItems.length === 0) return;
  return wixFetch("/stores/v3/bulk/inventory-items/update", { body });
}

// ── Webhooks: el cuerpo es un JWT RS256 firmado por Wix con la clave pública de la app ──

export type EventoWix = {
  eventType: string;
  instanceId: string;
  id: string;
  entityFqdn?: string;
  slug?: string;
  entityId?: string;
  eventTime?: string;
  data: Record<string, unknown>;
};

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function verificarWebhook(raw: string): EventoWix {
  const pem = (process.env.WIX_PUBLIC_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!pem) throw new Error("Falta WIX_PUBLIC_KEY");
  const partes = raw.trim().split(".");
  if (partes.length !== 3) throw new Error("Cuerpo del webhook no es un JWT");
  const [h, p, s] = partes;
  const header = JSON.parse(b64url(h).toString("utf8")) as { alg?: string };
  if (header.alg !== "RS256") throw new Error(`Algoritmo no soportado: ${header.alg}`);
  const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(pem, b64url(s));
  if (!ok) throw new Error("Firma del webhook inválida");
  const payload = JSON.parse(b64url(p).toString("utf8")) as { data?: string; exp?: number };
  if (payload.exp && payload.exp * 1000 < Date.now() - 5 * 60_000) throw new Error("Webhook vencido");
  const ev = JSON.parse(payload.data ?? "{}") as { eventType?: string; instanceId?: string; data?: string };
  const data = JSON.parse(ev.data ?? "{}") as Record<string, unknown>;
  if (process.env.WIX_INSTANCE_ID && ev.instanceId && ev.instanceId !== process.env.WIX_INSTANCE_ID) {
    throw new Error("El webhook es de otra instancia de la app");
  }
  return {
    eventType: ev.eventType ?? "desconocido",
    instanceId: ev.instanceId ?? "",
    id: String(data.id ?? ""),
    entityFqdn: data.entityFqdn as string | undefined,
    slug: data.slug as string | undefined,
    entityId: data.entityId as string | undefined,
    eventTime: data.eventTime as string | undefined,
    data,
  };
}
