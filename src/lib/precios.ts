import "server-only";
import { db } from "./db";

export const CATEGORIAS_PRECIO = [
  "Línea Melania Pro",
  "Kits y combos",
  "Insumos y accesorios",
  "Exhibidores",
  "Extensiones de pestañas",
];

export const DESCUENTOS = [20, 30, 40] as const;

export type ItemPrecio = {
  id: string;
  name: string;
  category: string;
  product_id: string | null;
  web_slug: string | null;
  wholesale: boolean;
  wholesale_max_discount: number | null;
  active: boolean;
  notes: string | null;
};

export type CambioPrecio = {
  id: string;
  item_id: string;
  channel: "LISTA" | "OFERTA";
  price: number | null;
  effective_date: string;
  batch_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type CondicionesMayoristas = {
  id: string;
  effective_date: string;
  min_20: number;
  min_30: number;
  min_40: number;
  note: string | null;
};

export function hoyAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

export async function getItemsPrecio(): Promise<ItemPrecio[]> {
  const { data, error } = await db().from("price_items").select("*").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ItemPrecio[];
}

export async function getCambios(): Promise<CambioPrecio[]> {
  const out: CambioPrecio[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db()
      .from("price_changes")
      .select("*")
      .order("effective_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as CambioPrecio[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function getCondiciones(): Promise<CondicionesMayoristas[]> {
  const { data } = await db().from("wholesale_terms").select("*").order("effective_date", { ascending: false });
  return (data ?? []) as CondicionesMayoristas[];
}

// precio de un canal vigente en una fecha (último cambio con fecha <= fecha)
export function vigenteEn(cambios: CambioPrecio[], channel: "LISTA" | "OFERTA", fecha: string): number | null {
  let v: number | null = null;
  for (const c of cambios) {
    if (c.channel !== channel || c.effective_date > fecha) continue;
    v = c.price != null ? Number(c.price) : null;
  }
  return v;
}

export function pct(nuevo: number | null, viejo: number | null): number | null {
  if (nuevo == null || viejo == null || viejo === 0) return null;
  return ((nuevo - viejo) / viejo) * 100;
}

export type Analisis = {
  lista: number | null;
  oferta: number | null;
  ultimaSuba: string | null; // fecha del último cambio de precio de lista que lo subió
  pctUltimaSuba: number | null;
  diasDesdeSuba: number | null;
  pct12m: number | null;
};

const dias = (a: string, b: string) =>
  Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

export function analizar(cambiosItem: CambioPrecio[], hoy: string): Analisis {
  const listas = cambiosItem.filter((c) => c.channel === "LISTA" && c.effective_date <= hoy && c.price != null);
  let ultimaSuba: string | null = null;
  let pctUltimaSuba: number | null = null;
  for (let i = 1; i < listas.length; i++) {
    const antes = Number(listas[i - 1].price);
    const ahora = Number(listas[i].price);
    if (ahora > antes) {
      ultimaSuba = listas[i].effective_date;
      pctUltimaSuba = pct(ahora, antes);
    }
  }
  const lista = vigenteEn(cambiosItem, "LISTA", hoy);
  const haceUnAnio = `${+hoy.slice(0, 4) - 1}${hoy.slice(4)}`;
  const desdeFecha = ultimaSuba ?? listas[0]?.effective_date ?? null;
  return {
    lista,
    oferta: vigenteEn(cambiosItem, "OFERTA", hoy),
    ultimaSuba,
    pctUltimaSuba,
    diasDesdeSuba: desdeFecha ? dias(desdeFecha, hoy) : null,
    pct12m: pct(lista, vigenteEn(cambiosItem, "LISTA", haceUnAnio)),
  };
}

// costo total por producto y mes (de la pestaña Costos), para comparar contra las subas de precio
export async function getCostosPorProducto(): Promise<Map<string, { period: string; total: number }[]>> {
  const { data } = await db().from("product_costs").select("product_id, period, total_cost").not("product_id", "is", null).order("period");
  const map = new Map<string, { period: string; total: number }[]>();
  for (const r of data ?? []) {
    const k = r.product_id as string;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push({ period: r.period as string, total: Number(r.total_cost) });
  }
  return map;
}

// cuánto subió el costo desde la última suba de precio (costo del mes de la suba vs. el último costo cargado)
export function subaCostoDesde(costos: { period: string; total: number }[] | undefined, fecha: string | null): number | null {
  if (!costos?.length || !fecha) return null;
  const mes = `${fecha.slice(0, 7)}-01`;
  const base = [...costos].reverse().find((c) => c.period <= mes) ?? costos[0];
  const ultimo = costos[costos.length - 1];
  if (base === ultimo) return null;
  return pct(ultimo.total, base.total);
}

// precio de lista vigente al cierre de cada mes, por producto (para la pestaña Costos)
export async function getPrecioListaPorProducto(): Promise<Map<string, CambioPrecio[]>> {
  const [items, cambios] = await Promise.all([getItemsPrecio(), getCambios()]);
  const porItem = new Map<string, CambioPrecio[]>();
  for (const c of cambios) {
    if (c.channel !== "LISTA") continue;
    if (!porItem.has(c.item_id)) porItem.set(c.item_id, []);
    porItem.get(c.item_id)!.push(c);
  }
  const out = new Map<string, CambioPrecio[]>();
  for (const it of items) if (it.product_id && porItem.has(it.id)) out.set(it.product_id, porItem.get(it.id)!);
  return out;
}

export function finDeMes(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

// Costos usa como precio de venta el precio de lista vigente al cierre de cada mes
// (si el ítem está vinculado a un producto con precio); si no, el cargado a mano.
export async function conPrecioDeLista<T extends { product_id: string | null; period: string; sale_price: number | null }>(
  filas: T[]
): Promise<(T & { precio_de_lista: boolean })[]> {
  const precios = await getPrecioListaPorProducto();
  return filas.map((f) => {
    const cambios = f.product_id ? precios.get(f.product_id) : undefined;
    const v = cambios ? vigenteEn(cambios, "LISTA", finDeMes(f.period)) : null;
    return v != null ? { ...f, sale_price: v, precio_de_lista: true } : { ...f, precio_de_lista: false };
  });
}
