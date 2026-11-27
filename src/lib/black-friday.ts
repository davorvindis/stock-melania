import "server-only";
import { db } from "./db";
import type { Profile } from "./auth";

// Campañas de descuentos (Black Friday, etc.): resumen de lo vendido en Wix
// (web, Store por el POS y mayoristas) durante los días de la campaña, contra el
// promedio de los mismos días de las semanas anteriores.
// Los productos en promo se detectan solos: la línea del pedido se cobró por
// debajo del precio de lista que tiene Wix (fullPrice > price).

export type Campania = { slug: string; nombre: string; desde: string; hasta: string; semanasBase: number };

export const CAMPANIAS: Campania[] = [
  { slug: "black-friday-2026", nombre: "Black Friday", desde: "2026-11-27", hasta: "2026-11-29", semanasBase: 4 },
];

// la tarjeta del Dashboard se ve desde el primer día hasta 3 días después de terminar
const DIAS_TARJETA_DESPUES = 3;

export const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function campaniaEnDashboard(hoy = hoyAR()): Campania | null {
  return CAMPANIAS.find((c) => hoy >= c.desde && hoy <= sumarDias(c.hasta, DIAS_TARJETA_DESPUES)) ?? null;
}

export function ultimaCampania(hoy = hoyAR()): Campania | null {
  return [...CAMPANIAS].filter((c) => hoy >= c.desde).sort((a, b) => b.desde.localeCompare(a.desde))[0] ?? null;
}

// la plata (facturación, descuento, margen) solo la ven los administradores con
// la pestaña Costos habilitada a mano (Joel y Mel)
export function veMontosCampania(u: Profile): boolean {
  return u.role === "ADMIN" && u.permissions?.costos === true;
}

export type Canal = "WEB" | "STORE" | "MAYORISTA";
export const CANAL_LABEL: Record<Canal, string> = { WEB: "Web minorista", STORE: "Store (POS)", MAYORISTA: "Mayoristas" };

export type Totales = { pedidos: number; unidades: number; monto: number };
const cero = (): Totales => ({ pedidos: 0, unidades: 0, monto: 0 });

export type ProductoPromo = {
  sku: string;
  nombre: string;
  unidades: number;
  monto: number; // cobrado
  montoLista: number; // lo que se hubiera cobrado a precio de lista
  descuentoPct: number; // % de descuento promedio
  costo: number | null; // costo de lo vendido (null si falta el costo de algún componente)
  baseUnidades: number; // promedio de unidades en los mismos días de semanas anteriores (web + Store)
};

// por día: solo minorista (web + Store)
export type DiaCampania = { fecha: string; label: string; totales: Totales; base: Totales };

export type ResumenCampania = {
  campania: Campania;
  estado: "EN_CURSO" | "TERMINADA";
  actualizado: string;
  total: Totales;
  base: Totales; // promedio por fin de semana de las semanas anteriores
  minorista: Totales; // web + Store (a lo que apunta la campaña; los mayoristas van aparte)
  baseMinorista: Totales;
  porCanal: Record<Canal, Totales>;
  basePorCanal: Record<Canal, Totales>;
  porDia: DiaCampania[];
  promo: ProductoPromo[];
  promoTotales: { unidades: number; monto: number; montoLista: number; costoConocido: number; montoConCosto: number; sinCosto: number };
  otros: { sku: string; nombre: string; unidades: number; monto: number }[]; // sin descuento (web + Store)
  aCobrar: { pedidos: number; monto: number };
};

type Linea = { external_line_id: string; external_sku: string | null; name: string | null; quantity: number; unit_price: number | null };
type Pedido = {
  id: string;
  number: string | null;
  channel_type: string | null;
  wholesale: boolean | null;
  payment_status: string | null;
  wix_status: string | null;
  ordered_at: string;
  items: Linea[];
};

const PAGADO = new Set(["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"]);
const diaAR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

function canal(p: Pedido): Canal {
  if (p.wholesale) return "MAYORISTA";
  if (p.channel_type === "POS") return "STORE";
  return "WEB";
}

async function traerPedidos(desde: string, hastaExcl: string): Promise<Pedido[]> {
  const out: Pedido[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db()
      .from("channel_orders")
      .select("id, number, channel_type, wholesale, payment_status, wix_status, ordered_at, items:channel_order_items(external_line_id, external_sku, name, quantity, unit_price)")
      .eq("channel", "WIX")
      .gte("ordered_at", `${desde}T00:00:00-03:00`)
      .lt("ordered_at", `${hastaExcl}T00:00:00-03:00`)
      .order("ordered_at")
      .range(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as Pedido[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// precio de lista de cada línea (solo está en el pedido crudo de Wix)
async function preciosLista(ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db().from("channel_orders").select("id, lineItems:raw->lineItems").in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const o of data ?? []) {
      const li = (o as { lineItems: unknown }).lineItems;
      if (!Array.isArray(li)) continue;
      for (const l of li as { id?: string; fullPrice?: { amount?: string } }[]) {
        const fp = Number(l.fullPrice?.amount);
        if (l.id && fp > 0) m.set(`${o.id}|${l.id}`, fp);
      }
    }
  }
  return m;
}

// costo unitario por SKU de Wix: suma de los costos (último mes cargado en Costos) de lo que descuenta
async function costosPorSku(skus: string[]): Promise<Map<string, number | null>> {
  const res = new Map<string, number | null>();
  if (!skus.length) return res;
  const [eq, pc] = await Promise.all([
    db().from("channel_skus").select("external_sku, lines:channel_sku_lines(quantity, product_id)").eq("channel", "WIX").in("external_sku", skus),
    db().from("product_costs").select("product_id, period, total_cost").not("product_id", "is", null).order("period"),
  ]);
  if (eq.error) throw new Error(eq.error.message);
  const costo = new Map<string, number>();
  for (const r of pc.data ?? []) if (r.total_cost !== null && Number(r.total_cost) > 0) costo.set(r.product_id as string, Number(r.total_cost));
  for (const e of eq.data ?? []) {
    const lines = (e.lines ?? []) as { quantity: number; product_id: string }[];
    if (!lines.length || lines.some((l) => !costo.has(l.product_id))) {
      res.set(e.external_sku, null);
      continue;
    }
    res.set(e.external_sku, lines.reduce((s, l) => s + Number(l.quantity) * costo.get(l.product_id)!, 0));
  }
  return res;
}

const DIA_SEMANA = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });

export async function getResumenCampania(c: Campania): Promise<ResumenCampania> {
  const hoy = hoyAR();
  const finExcl = sumarDias(c.hasta, 1);
  const inicioBase = sumarDias(c.desde, -7 * c.semanasBase);
  const pedidos = await traerPedidos(inicioBase, finExcl);

  const dias: string[] = [];
  for (let d = c.desde; d <= c.hasta; d = sumarDias(d, 1)) dias.push(d);
  // a qué día de la campaña corresponde una fecha de las semanas anteriores (o null)
  const semanasAtras = (fecha: string): number | null => {
    for (let w = 1; w <= c.semanasBase; w++) {
      const d = sumarDias(fecha, 7 * w);
      if (d >= c.desde && d <= c.hasta) return w;
    }
    return null;
  };
  const diaBase = (fecha: string): string | null => {
    const w = semanasAtras(fecha);
    return w === null ? null : sumarDias(fecha, 7 * w);
  };
  // con la campaña en curso se compara contra lo vendido hasta el mismo día y hora de
  // las semanas anteriores (si no, medio viernes contra un finde entero da siempre menos)
  const ahora = Date.now();
  const yaPasoEnLaCampania = (p: Pedido): boolean => {
    const w = semanasAtras(diaAR.format(new Date(p.ordered_at)));
    return w !== null && new Date(p.ordered_at).getTime() + w * 7 * 86400000 <= ahora;
  };

  const pagados = pedidos.filter((p) => PAGADO.has(p.payment_status ?? "") && p.number && p.number !== "0");
  const enCampania = (p: Pedido) => {
    const d = diaAR.format(new Date(p.ordered_at));
    return d >= c.desde && d <= c.hasta;
  };
  const campania = pagados.filter(enCampania);
  const base = pagados.filter((p) => !enCampania(p) && yaPasoEnLaCampania(p));

  const sumar = (t: Totales, p: Pedido) => {
    t.pedidos += 1;
    for (const i of p.items) {
      t.unidades += Number(i.quantity);
      t.monto += Number(i.quantity) * Number(i.unit_price ?? 0);
    }
  };
  const promedio = (t: Totales): Totales => ({ pedidos: t.pedidos / c.semanasBase, unidades: t.unidades / c.semanasBase, monto: t.monto / c.semanasBase });

  const total = cero();
  const baseT = cero();
  const porCanal: Record<Canal, Totales> = { WEB: cero(), STORE: cero(), MAYORISTA: cero() };
  const basePorCanal: Record<Canal, Totales> = { WEB: cero(), STORE: cero(), MAYORISTA: cero() };
  const porDiaMap = new Map(dias.map((d) => [d, { totales: cero(), base: cero() }]));
  for (const p of campania) {
    sumar(total, p);
    sumar(porCanal[canal(p)], p);
    if (canal(p) !== "MAYORISTA") sumar(porDiaMap.get(diaAR.format(new Date(p.ordered_at)))!.totales, p);
  }
  for (const p of base) {
    sumar(baseT, p);
    sumar(basePorCanal[canal(p)], p);
    if (canal(p) !== "MAYORISTA") sumar(porDiaMap.get(diaBase(diaAR.format(new Date(p.ordered_at)))!)!.base, p);
  }

  // productos: solo minorista (web + Store); los mayoristas tienen su propio precio
  const minoristas = campania.filter((p) => canal(p) !== "MAYORISTA");
  const lista = await preciosLista(minoristas.map((p) => p.id));
  const promoMap = new Map<string, ProductoPromo>();
  const otrosMap = new Map<string, { sku: string; nombre: string; unidades: number; monto: number }>();
  for (const p of minoristas) {
    for (const i of p.items) {
      const sku = i.external_sku ?? i.name ?? "?";
      const q = Number(i.quantity);
      const precio = Number(i.unit_price ?? 0);
      const fp = lista.get(`${p.id}|${i.external_line_id}`) ?? precio;
      if (fp > precio + 0.5) {
        const r = promoMap.get(sku) ?? { sku, nombre: i.name ?? sku, unidades: 0, monto: 0, montoLista: 0, descuentoPct: 0, costo: 0, baseUnidades: 0 };
        r.unidades += q;
        r.monto += q * precio;
        r.montoLista += q * fp;
        promoMap.set(sku, r);
      } else {
        const r = otrosMap.get(sku) ?? { sku, nombre: i.name ?? sku, unidades: 0, monto: 0 };
        r.unidades += q;
        r.monto += q * precio;
        otrosMap.set(sku, r);
      }
    }
  }
  // unidades de esos mismos productos en las semanas anteriores (minorista)
  for (const p of base) {
    if (canal(p) === "MAYORISTA") continue;
    for (const i of p.items) {
      const r = promoMap.get(i.external_sku ?? i.name ?? "?");
      if (r) r.baseUnidades += Number(i.quantity) / c.semanasBase;
    }
  }
  const costos = await costosPorSku([...promoMap.keys()]);
  const promo = [...promoMap.values()]
    .map((r) => {
      const cu = costos.get(r.sku);
      return { ...r, descuentoPct: r.montoLista > 0 ? (1 - r.monto / r.montoLista) * 100 : 0, costo: cu === undefined || cu === null ? null : cu * r.unidades };
    })
    .sort((a, b) => b.monto - a.monto);
  const conCosto = promo.filter((r) => r.costo !== null);

  const pendientes = pedidos.filter(
    (p) => enCampania(p) && !PAGADO.has(p.payment_status ?? "") && p.number && p.number !== "0" && p.wix_status === "APPROVED" && ["NOT_PAID", "PENDING"].includes(p.payment_status ?? "")
  );
  const aCobrar = { pedidos: pendientes.length, monto: pendientes.reduce((s, p) => s + p.items.reduce((x, i) => x + Number(i.quantity) * Number(i.unit_price ?? 0), 0), 0) };

  const suma = (a: Totales, b: Totales): Totales => ({ pedidos: a.pedidos + b.pedidos, unidades: a.unidades + b.unidades, monto: a.monto + b.monto });
  return {
    campania: c,
    minorista: suma(porCanal.WEB, porCanal.STORE),
    baseMinorista: promedio(suma(basePorCanal.WEB, basePorCanal.STORE)),
    estado: hoy > c.hasta ? "TERMINADA" : "EN_CURSO",
    actualizado: new Date().toISOString(),
    total,
    base: promedio(baseT),
    porCanal,
    basePorCanal: { WEB: promedio(basePorCanal.WEB), STORE: promedio(basePorCanal.STORE), MAYORISTA: promedio(basePorCanal.MAYORISTA) },
    porDia: dias.map((d) => ({
      fecha: d,
      label: DIA_SEMANA.format(new Date(`${d}T12:00:00Z`)),
      totales: porDiaMap.get(d)!.totales,
      base: promedio(porDiaMap.get(d)!.base),
    })),
    promo,
    promoTotales: {
      unidades: promo.reduce((s, r) => s + r.unidades, 0),
      monto: promo.reduce((s, r) => s + r.monto, 0),
      montoLista: promo.reduce((s, r) => s + r.montoLista, 0),
      costoConocido: conCosto.reduce((s, r) => s + (r.costo ?? 0), 0),
      montoConCosto: conCosto.reduce((s, r) => s + r.monto, 0),
      sinCosto: promo.length - conCosto.length,
    },
    otros: [...otrosMap.values()].sort((a, b) => b.monto - a.monto),
    aCobrar,
  };
}

// "x3,2" / "+45%" contra lo normal; null si no hay base
export function versusNormal(actual: number, base: number): string | null {
  if (base <= 0) return actual > 0 ? "sin ventas antes" : null;
  const r = actual / base;
  if (r >= 2) return `x${r.toLocaleString("es-AR", { maximumFractionDigits: 1 })}`;
  const pct = Math.round((r - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}
