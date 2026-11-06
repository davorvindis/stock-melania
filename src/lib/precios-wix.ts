import "server-only";
import { randomUUID } from "crypto";
import { db } from "./db";
import { wixConfigurado, wixFetch } from "./wix/client";
import { getCambios, getItemsPrecio, hoyAR, vigenteEn } from "./precios";

// Wix es donde se cambian los precios. Una vez por día (y con el botón de Precios) se leen los
// precios publicados y, si alguno es distinto al vigente acá, se registra el cambio con fecha de
// hoy. Cada producto se empareja con su página de Wix (slug) o, si no, por el SKU del producto vinculado.

export const QUIEN_WIX = "Wix (automático)";

type ProdWix = { id: string; slug?: string; sku?: string; name?: string; priceData?: { price?: number; discountedPrice?: number } };
type PrecioWix = { lista: number; oferta: number | null };

// "https://www.melaniapro.com/product-page/pro-easy-gel" o "pro-easy-gel" → "pro-easy-gel"
export function normalizarSlug(s: string | null | undefined): string | null {
  if (!s) return null;
  let t = s.trim();
  try {
    t = decodeURIComponent(t);
  } catch {}
  t = t.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return (t.split("/product-page/").pop() ?? t).split("/").pop()!.toLowerCase() || null;
}

async function preciosEnWix() {
  const porSlug = new Map<string, PrecioWix>();
  const porId = new Map<string, PrecioWix>();
  const porSku = new Map<string, PrecioWix>();
  for (let offset = 0; offset < 10000; offset += 100) {
    const r = await wixFetch<{ products?: ProdWix[] }>("/stores/v1/products/query", {
      body: { includeHiddenProducts: true, query: { paging: { limit: 100, offset } } },
    });
    const ps = r.products ?? [];
    for (const p of ps) {
      const lista = Number(p.priceData?.price);
      if (!(lista > 0)) continue;
      const desc = Number(p.priceData?.discountedPrice);
      const precio = { lista, oferta: desc > 0 && desc < lista ? desc : null };
      porId.set(p.id, precio);
      const slug = normalizarSlug(p.slug);
      if (slug) porSlug.set(slug, precio);
      if (p.sku?.trim()) porSku.set(p.sku.trim().toUpperCase(), precio);
    }
    if (ps.length < 100) break;
  }
  return { porSlug, porId, porSku };
}

export type ResultadoPreciosWix = { at: string; actor: string; revisados: number; cambios: number; sinPagina: string[]; detalle: string[] };

export async function traerPreciosWix(actor: string): Promise<ResultadoPreciosWix> {
  if (!wixConfigurado()) throw new Error("Wix no está conectado en este entorno (las claves están solo en producción)");
  const [wix, items, cambios, prods, canal] = await Promise.all([
    preciosEnWix(),
    getItemsPrecio(),
    getCambios(),
    db().from("products").select("id, sku"),
    db().from("channel_skus").select("external_sku, wix_product_id").not("wix_product_id", "is", null),
  ]);
  const skuDe = new Map((prods.data ?? []).map((p) => [p.id as string, String(p.sku).toUpperCase()]));
  const idWixDeSku = new Map((canal.data ?? []).map((c) => [String(c.external_sku).toUpperCase(), c.wix_product_id as string]));
  // primero por la página web; si no se encuentra (link viejo o mal cargado), por el SKU del producto vinculado
  const buscar = (it: (typeof items)[number]): PrecioWix | undefined => {
    const slug = normalizarSlug(it.web_slug);
    const porSlug = slug ? wix.porSlug.get(slug) : undefined;
    if (porSlug) return porSlug;
    const sku = it.product_id ? skuDe.get(it.product_id) : undefined;
    if (!sku) return undefined;
    const idWix = idWixDeSku.get(sku);
    return (idWix && wix.porId.get(idWix)) || wix.porSku.get(sku);
  };
  const hoy = hoyAR();
  const batch = randomUUID();
  const filas: Record<string, unknown>[] = [];
  const sinPagina: string[] = [];
  const detalle: string[] = [];
  let revisados = 0;
  const redondo = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  for (const it of items.filter((i) => i.active && (i.web_slug || i.product_id))) {
    const w = buscar(it);
    if (!w) {
      sinPagina.push(it.name);
      continue;
    }
    revisados++;
    const delItem = cambios.filter((c) => c.item_id === it.id);
    const lista = vigenteEn(delItem, "LISTA", hoy);
    const oferta = vigenteEn(delItem, "OFERTA", hoy);
    const base = { item_id: it.id, effective_date: hoy, batch_id: batch, note: "Cambio detectado en Wix", created_by: QUIEN_WIX };
    if (redondo(lista) !== redondo(w.lista)) {
      filas.push({ ...base, channel: "LISTA", price: w.lista });
      detalle.push(`${it.name}: lista ${lista ?? "—"} → ${w.lista}`);
    }
    if (redondo(oferta) !== redondo(w.oferta)) {
      filas.push({ ...base, channel: "OFERTA", price: w.oferta });
      detalle.push(`${it.name}: oferta ${oferta ?? "—"} → ${w.oferta ?? "sin oferta"}`);
    }
  }
  if (filas.length) {
    const { error } = await db().from("price_changes").insert(filas);
    if (error) throw new Error(error.message);
    await db().from("audit_logs").insert({
      actor, action: "price:wix_sync", entity: "price_changes", entity_id: batch,
      detail: { cambios: filas.length, detalle: detalle.slice(0, 50) },
    });
  }
  const r: ResultadoPreciosWix = { at: new Date().toISOString(), actor, revisados, cambios: filas.length, sinPagina, detalle };
  await db().from("app_settings").upsert({ key: "precios_wix", value: r, updated_at: r.at, updated_by: actor }, { onConflict: "key" });
  return r;
}

export async function ultimaLecturaWix(): Promise<ResultadoPreciosWix | null> {
  const { data } = await db().from("app_settings").select("value").eq("key", "precios_wix").maybeSingle();
  return (data?.value as ResultadoPreciosWix) ?? null;
}
