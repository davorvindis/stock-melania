import "server-only";
import { db } from "./db";

// Reporte de ventas armado desde el ledger de movimientos (ventas minoristas y
// mayoristas; opcionalmente otras salidas). Las ventas revertidas no cuentan.

export const CANALES: Record<string, { label: string; tipos: string[] }> = {
  "": { label: "Minorista y mayorista", tipos: ["SALE", "WHOLESALE_SALE"] },
  minorista: { label: "Solo minorista", tipos: ["SALE"] },
  mayorista: { label: "Solo mayorista", tipos: ["WHOLESALE_SALE"] },
  otras: { label: "Otras salidas (regalo, muestra, uso interno)", tipos: ["GIFT", "SAMPLE", "INTERNAL_USE"] },
};

export type FiltrosVentas = {
  desde?: string;
  hasta?: string;
  persona?: string;
  producto?: string;
  ubicacion?: string;
  canal?: string;
};

export type LineaVenta = {
  id: string;
  occurred_at: string;
  type: string;
  quantity: number;
  actor: string | null;
  reason: string | null;
  notes: string | null;
  product: { id: string; sku: string; name: string; unit: string };
  lot: { code: string } | null;
  from_location: { id: string; name: string } | null;
};

export type Pedido = {
  key: string;
  fecha: string;
  tipo: string;
  numero: string | null;
  actor: string | null;
  ubicacion: string | null;
  notas: string | null;
  unidades: number;
  lineas: LineaVenta[];
};

const esFecha = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const esUuid = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

// primer día del mes actual y hoy (Argentina), para el rango por defecto
export function rangoMesActual() {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
}

// últimos n días calendario argentinos (clave YYYY-MM-DD y etiqueta dd/mm), del más viejo a hoy
export function diasRecientes(n: number): { clave: string; label: string }[] {
  const clave = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const label = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" });
  const ahora = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(ahora - (n - 1 - i) * 86400000);
    return { clave: clave.format(d), label: label.format(d) };
  });
}

export async function getVentas(f: FiltrosVentas): Promise<LineaVenta[]> {
  const tipos = (CANALES[f.canal ?? ""] ?? CANALES[""]).tipos;
  const filas: LineaVenta[] = [];
  for (let desde = 0; ; desde += 1000) {
    let q = db()
      .from("inventory_movements")
      .select(
        "id, occurred_at, type, quantity, actor, reason, notes, product:products(id, sku, name, unit), lot:lots(code), from_location:locations!inventory_movements_from_location_id_fkey(id, name)"
      )
      .in("type", tipos)
      .order("occurred_at", { ascending: false })
      .range(desde, desde + 999);
    if (esFecha(f.desde)) q = q.gte("occurred_at", `${f.desde}T00:00:00-03:00`);
    if (esFecha(f.hasta)) q = q.lte("occurred_at", `${f.hasta}T23:59:59.999-03:00`);
    if (f.persona) q = q.eq("actor", f.persona);
    if (esUuid(f.producto)) q = q.eq("product_id", f.producto);
    if (esUuid(f.ubicacion)) q = q.eq("from_location_id", f.ubicacion);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    filas.push(...((data ?? []) as unknown as LineaVenta[]));
    if (!data || data.length < 1000) break;
  }
  // sacar las revertidas
  const revertidas = new Set<string>();
  for (let i = 0; i < filas.length; i += 300) {
    const ids = filas.slice(i, i + 300).map((m) => m.id);
    const { data } = await db().from("inventory_movements").select("reversal_of").in("reversal_of", ids);
    for (const r of data ?? []) revertidas.add(r.reversal_of as string);
  }
  return filas.filter((m) => !revertidas.has(m.id));
}

// un pedido = las líneas cargadas juntas (mismo momento, tipo, persona y N°)
export function agruparPedidos(lineas: LineaVenta[]): Pedido[] {
  const map = new Map<string, Pedido>();
  for (const l of lineas) {
    const key = [l.occurred_at, l.type, l.actor, l.reason].join("|");
    let p = map.get(key);
    if (!p) {
      p = {
        key,
        fecha: l.occurred_at,
        tipo: l.type,
        numero: l.reason,
        actor: l.actor,
        ubicacion: l.from_location?.name ?? null,
        notas: l.notes,
        unidades: 0,
        lineas: [],
      };
      map.set(key, p);
    }
    p.unidades += Number(l.quantity);
    p.lineas.push(l);
  }
  return [...map.values()];
}

export type ResumenProducto = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  minorista: number;
  mayorista: number;
  otras: number;
  total: number;
};

export function porProducto(lineas: LineaVenta[]): ResumenProducto[] {
  const map = new Map<string, ResumenProducto>();
  for (const l of lineas) {
    let r = map.get(l.product.id);
    if (!r) {
      r = { ...l.product, minorista: 0, mayorista: 0, otras: 0, total: 0 };
      map.set(l.product.id, r);
    }
    const q = Number(l.quantity);
    if (l.type === "SALE") r.minorista += q;
    else if (l.type === "WHOLESALE_SALE") r.mayorista += q;
    else r.otras += q;
    r.total += q;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function porPersona(pedidos: Pedido[]) {
  const map = new Map<string, { persona: string; pedidos: number; unidades: number; minorista: number; mayorista: number }>();
  for (const p of pedidos) {
    const k = p.actor ?? "—";
    const r = map.get(k) ?? { persona: k, pedidos: 0, unidades: 0, minorista: 0, mayorista: 0 };
    r.pedidos += 1;
    r.unidades += p.unidades;
    if (p.tipo === "SALE") r.minorista += p.unidades;
    if (p.tipo === "WHOLESALE_SALE") r.mayorista += p.unidades;
    map.set(k, r);
  }
  return [...map.values()].sort((a, b) => b.unidades - a.unidades);
}
