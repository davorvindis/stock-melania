import "server-only";
import { db } from "./db";

export const ESTADOS_PREVENTA: Record<string, string> = {
  PENDIENTE: "Pendiente",
  PARCIAL: "Entregada parcial",
  ENTREGADA: "Entregada",
  CANCELADA: "Cancelada",
};

export function estadoPreventaClass(s: string) {
  if (s === "PENDIENTE") return "bg-amber-100 text-amber-800";
  if (s === "PARCIAL") return "bg-blue-100 text-blue-800";
  if (s === "ENTREGADA") return "bg-emerald-100 text-emerald-800";
  return "bg-stone-200 text-stone-700";
}

export type LineaPreventa = {
  id: string;
  quantity: number;
  delivered: number;
  product: { id: string; sku: string; name: string; unit: string };
};

export type Preventa = {
  id: string;
  customer: string;
  order_ref: string | null;
  channel: "MAYORISTA" | "MINORISTA";
  order_date: string;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  lines: LineaPreventa[];
};

const SELECT =
  "id, customer, order_ref, channel, order_date, status, notes, created_by, created_at, lines:preorder_lines(id, quantity, delivered, product:products(id, sku, name, unit))";

export async function getPreventas(): Promise<Preventa[]> {
  const { data, error } = await db().from("preorders").select(SELECT).order("order_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Preventa[];
}

export const pendiente = (l: { quantity: number; delivered: number }) => Number(l.quantity) - Number(l.delivered);

// líneas pendientes (de preventas abiertas) de ciertos productos, primero las más viejas
export async function getPendientes(productIds?: string[]) {
  let q = db()
    .from("preorder_lines")
    .select("id, quantity, delivered, product_id, preorder:preorders!inner(id, customer, order_ref, channel, order_date, created_at, status)")
    .in("preorder.status", ["PENDIENTE", "PARCIAL"]);
  if (productIds) q = q.in("product_id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Fila = {
    id: string;
    quantity: number;
    delivered: number;
    product_id: string;
    preorder: { id: string; customer: string; order_ref: string | null; channel: string; order_date: string; created_at: string; status: string };
  };
  return ((data ?? []) as unknown as Fila[])
    .filter((l) => pendiente(l) > 0)
    .sort((a, b) =>
      a.preorder.order_date === b.preorder.order_date
        ? a.preorder.created_at.localeCompare(b.preorder.created_at)
        : a.preorder.order_date.localeCompare(b.preorder.order_date)
    );
}

export type Asignacion = {
  line_id: string;
  customer: string;
  order_ref: string | null;
  order_date: string;
  pendiente: number;
  quantity: number;
  lot_id: string | null;
  lot_code: string | null;
  location_id: string;
  location_name: string;
};

// propuesta de reparto de un ingreso: lo que entró de cada producto se asigna a las
// preventas más viejas primero (puede partir una preventa entre dos lotes)
export async function propuestaReparto(entryId: string) {
  const { data: entry } = await db()
    .from("stock_entries")
    .select("id, entry_date, lines:stock_entry_lines(product_id, lot_id, location_id, quantity, product:products(name, unit), lot:lots(code, sealed), location:locations(name))")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return null;
  type L = {
    product_id: string;
    lot_id: string | null;
    location_id: string;
    quantity: number;
    product: { name: string; unit: string };
    lot: { code: string; sealed: boolean } | null;
    location: { name: string };
  };
  // lo que entró en caja cerrada no se reparte hasta abrir la caja
  const lineas = ((entry.lines ?? []) as unknown as L[]).filter((l) => !l.lot?.sealed);
  const pend = await getPendientes([...new Set(lineas.map((l) => l.product_id))]);
  const porProducto = new Map<string, { nombre: string; unidad: string; ingresado: number; prevendido: number; asignaciones: Asignacion[] }>();
  for (const l of lineas) {
    const p = porProducto.get(l.product_id) ?? { nombre: l.product.name, unidad: l.product.unit, ingresado: 0, prevendido: 0, asignaciones: [] };
    p.ingresado += Number(l.quantity);
    porProducto.set(l.product_id, p);
  }
  for (const [pid, p] of porProducto) {
    const cola = pend.filter((x) => x.product_id === pid).map((x) => ({ ...x, falta: pendiente(x) }));
    p.prevendido = cola.reduce((s, x) => s + x.falta, 0);
    for (const l of lineas.filter((x) => x.product_id === pid)) {
      let disponible = Number(l.quantity);
      for (const c of cola) {
        if (disponible <= 0) break;
        if (c.falta <= 0) continue;
        const q = Math.min(c.falta, disponible);
        p.asignaciones.push({
          line_id: c.id,
          customer: c.preorder.customer,
          order_ref: c.preorder.order_ref,
          order_date: c.preorder.order_date,
          pendiente: pendiente(c),
          quantity: q,
          lot_id: l.lot_id,
          lot_code: l.lot?.code ?? null,
          location_id: l.location_id,
          location_name: l.location.name,
        });
        c.falta -= q;
        disponible -= q;
      }
    }
  }
  const productos = [...porProducto.entries()].filter(([, p]) => p.prevendido > 0).map(([id, p]) => ({ id, ...p }));
  return { entry, productos };
}
