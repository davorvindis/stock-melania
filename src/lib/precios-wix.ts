import "server-only";
import { randomUUID } from "crypto";
import { db } from "./db";
import { wixConfigurado, wixFetch } from "./wix/client";
import { getCambios, getItemsPrecio, hoyAR, vigenteEn } from "./precios";

// Wix es donde se cambian los precios. Una vez por día (y con el botón de Precios) se leen los
// precios publicados y, si alguno es distinto al vigente acá, se registra el cambio con fecha de
// hoy. Cada producto de la lista se empareja con su página de Wix por el slug.

export const QUIEN_WIX = "Wix (automático)";

type ProdWix = { slug?: string; name?: string; priceData?: { price?: number; discountedPrice?: number } };

async function preciosEnWix(): Promise<Map<string, { lista: number; oferta: number | null }>> {
  const out = new Map<string, { lista: number; oferta: number | null }>();
  for (let offset = 0; offset < 10000; offset += 100) {
    const r = await wixFetch<{ products?: ProdWix[] }>("/stores/v1/products/query", {
      body: { includeHiddenProducts: true, query: { paging: { limit: 100, offset } } },
    });
    const ps = r.products ?? [];
    for (const p of ps) {
      const lista = Number(p.priceData?.price);
      if (!p.slug || !(lista > 0)) continue;
      const desc = Number(p.priceData?.discountedPrice);
      out.set(p.slug, { lista, oferta: desc > 0 && desc < lista ? desc : null });
    }
    if (ps.length < 100) break;
  }
  return out;
}

export type ResultadoPreciosWix = { at: string; actor: string; revisados: number; cambios: number; sinPagina: string[]; detalle: string[] };

export async function traerPreciosWix(actor: string): Promise<ResultadoPreciosWix> {
  if (!wixConfigurado()) throw new Error("Wix no está conectado en este entorno (las claves están solo en producción)");
  const [wix, items, cambios] = await Promise.all([preciosEnWix(), getItemsPrecio(), getCambios()]);
  const hoy = hoyAR();
  const batch = randomUUID();
  const filas: Record<string, unknown>[] = [];
  const sinPagina: string[] = [];
  const detalle: string[] = [];
  let revisados = 0;
  const redondo = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  for (const it of items.filter((i) => i.active && i.web_slug)) {
    const w = wix.get(it.web_slug!);
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
