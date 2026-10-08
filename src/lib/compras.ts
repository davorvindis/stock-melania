import "server-only";
import { db } from "./db";

// ── Órdenes de compra ───────────────────────────────────────────────

export const ESTADOS_OC: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  RECIBIDA_PARCIAL: "Recibida parcial",
  RECIBIDA: "Recibida",
  CANCELADA: "Cancelada",
};

export function estadoOcClass(s: string): string {
  if (s === "PENDIENTE") return "bg-amber-100 text-amber-800";
  if (s === "EN_PROCESO") return "bg-violet-100 text-violet-800";
  if (s === "RECIBIDA_PARCIAL") return "bg-blue-100 text-blue-800";
  if (s === "RECIBIDA") return "bg-emerald-100 text-emerald-800";
  return "bg-stone-200 text-stone-700";
}

export type LineaOC = {
  id: string;
  position: number;
  product_id: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  kind: string | null;
  unit_cost: number | null;
  received_qty: number;
  product: { id: string; sku: string; name: string } | null;
};

export type Envio = {
  id: string;
  ship_date: string;
  from_place: string;
  to_place: string;
  description: string | null;
  carrier: string | null;
  freight_cost: number | null;
  status: "EN_CAMINO" | "ENTREGADO";
  delivered_date: string | null;
  notes: string | null;
  created_by: string | null;
};

export type OrdenCompra = {
  id: string;
  order_date: string;
  expected_date: string | null;
  status: string;
  paid_pct: number | null;
  notes: string | null;
  created_by: string | null;
  supplier: { id: string; name: string };
  lines: LineaOC[];
  shipments: Envio[];
};

// la orden sigue abierta (falta recibir) mientras no esté recibida ni cancelada
export const ESTADOS_ABIERTOS = ["PENDIENTE", "EN_PROCESO", "RECIBIDA_PARCIAL"];

const OC_SELECT =
  "id, order_date, expected_date, status, paid_pct, notes, created_by, supplier:suppliers(id, name), lines:purchase_order_lines(id, position, product_id, description, quantity, unit, kind, unit_cost, received_qty, product:products(id, sku, name)), shipments:purchase_order_shipments(id, ship_date, from_place, to_place, description, carrier, freight_cost, status, delivered_date, notes, created_by)";

export async function getOrdenes(f: { proveedor?: string; estado?: string; desde?: string; hasta?: string; q?: string }) {
  let q = db().from("purchase_orders").select(OC_SELECT).order("order_date", { ascending: false });
  if (f.proveedor) q = q.eq("supplier_id", f.proveedor);
  if (f.estado) q = q.eq("status", f.estado);
  if (f.desde && /^\d{4}-\d{2}-\d{2}$/.test(f.desde)) q = q.gte("order_date", f.desde);
  if (f.hasta && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) q = q.lte("order_date", f.hasta);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let ordenes = (data ?? []) as unknown as OrdenCompra[];
  for (const o of ordenes) {
    o.lines.sort((a, b) => a.position - b.position);
    o.shipments.sort((a, b) => a.ship_date.localeCompare(b.ship_date));
  }
  if (f.q) {
    const t = f.q.toLowerCase();
    ordenes = ordenes.filter(
      (o) =>
        o.supplier.name.toLowerCase().includes(t) ||
        (o.notes ?? "").toLowerCase().includes(t) ||
        o.lines.some((l) => l.description.toLowerCase().includes(t) || (l.product?.name ?? "").toLowerCase().includes(t))
    );
  }
  return ordenes;
}

export async function getOrden(id: string) {
  const { data, error } = await db().from("purchase_orders").select(OC_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const o = data as unknown as OrdenCompra | null;
  o?.lines.sort((a, b) => a.position - b.position);
  o?.shipments.sort((a, b) => a.ship_date.localeCompare(b.ship_date));
  return o;
}

export async function getIngresosDeOrden(id: string) {
  const { data } = await db()
    .from("stock_entries")
    .select("id, entry_date, remito, invoice, actor, created_at")
    .eq("purchase_order_id", id)
    .order("created_at", { ascending: false });
  return data ?? [];
}

// ── Costos ──────────────────────────────────────────────────────────

export const COMPONENTES = [
  ["granel", "Granel"],
  ["envasado", "Envasado"],
  ["folia", "Folia"],
  ["envase", "Envase"],
  ["estuche", "Estuche"],
  ["etiqueta", "Etiqueta"],
  ["envase_granel", "Envase/envasado + granel"],
  ["envase_granel_etiqueta", "Envase + granel + etiqueta"],
] as const;

// descuentos que se ofrecen a mayoristas sobre el precio minorista
export const DESCUENTOS_MAYORISTA = [20, 30, 40, 45];

export type FilaCosto = {
  id: string;
  period: string;
  item: string;
  product_id: string | null;
  supplier_id: string | null;
  granel: number | null;
  envasado: number | null;
  folia: number | null;
  envase: number | null;
  estuche: number | null;
  etiqueta: number | null;
  envase_granel: number | null;
  envase_granel_etiqueta: number | null;
  total_cost: number;
  sale_price: number | null;
  quote_note: string | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
  supplier: { name: string } | null;
  product: { name: string; sku: string } | null;
};

const COSTO_SELECT = "*, supplier:suppliers(name), product:products(name, sku)";

export async function getPeriodos(): Promise<string[]> {
  const { data } = await db().from("product_costs").select("period").order("period", { ascending: false });
  return [...new Set((data ?? []).map((r) => r.period as string))];
}

export async function getCostos(period: string): Promise<FilaCosto[]> {
  const { data, error } = await db().from("product_costs").select(COSTO_SELECT).eq("period", period).order("item");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FilaCosto[];
}

export async function getHistorialItem(item: string): Promise<FilaCosto[]> {
  const { data, error } = await db().from("product_costs").select(COSTO_SELECT).eq("item", item).order("period");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FilaCosto[];
}

// margen sobre el precio (ganancia / precio), en %
export function margen(precio: number | null, costo: number): number | null {
  if (!precio || precio <= 0) return null;
  return ((precio - costo) / precio) * 100;
}

export function variacion(actual: number | null, anterior: number | null | undefined): number | null {
  if (actual == null || anterior == null || anterior === 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function nombreMes(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}
export function mesSiguiente(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
