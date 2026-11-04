import "server-only";
import { db } from "./db";

// Forecast: a qué ritmo se vende cada producto, hasta cuándo alcanza el stock y
// cuándo/cuánto conviene comprar. Método simple y explicable:
//  - ritmo actual = promedio ponderado de los últimos 28 días (60%) y 84 días (40%);
//  - estacionalidad = cómo se vendió cada mes en los 12 meses anteriores a que arrancara la
//    app (historial de Wix), suavizada a la mitad y limitada entre 0,6 y 1,6;
//  - se simula día a día el stock libre (stock − reservado) sumando lo que está en camino
//    en órdenes de compra pendientes.

// ritmos: ventas por semana cargadas a mano por producto (reemplazan lo calculado, ej. cuando
// el historial está bajo porque faltó stock)
export type ConfigForecast = { demora: number; colchon: number; cubrir: number; ritmos: Record<string, number> };
export const CONFIG_DEFAULT: ConfigForecast = { demora: 30, colchon: 15, cubrir: 60, ritmos: {} };

export type Estado = "AGOTADO" | "FALTA" | "PEDIR_YA" | "PRONTO" | "OK" | "SIN_VENTAS";
export const ESTADOS: Record<Estado, { label: string; clase: string }> = {
  AGOTADO: { label: "Sin stock", clase: "bg-red-100 text-red-800" },
  FALTA: { label: "Falta hasta que llegue", clase: "bg-orange-100 text-orange-900" },
  PEDIR_YA: { label: "Pedir ya", clase: "bg-rose-deep text-white" },
  PRONTO: { label: "Pedir pronto", clase: "bg-amber-100 text-amber-900" },
  OK: { label: "Bien", clase: "bg-emerald-50 text-emerald-800" },
  SIN_VENTAS: { label: "Sin ventas", clase: "bg-stone-200 text-stone-700" },
};

export type FilaForecast = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  type: string;
  propio: boolean;
  libre: number;
  prevendido: number; // preventas pendientes de entregar: se pagan primero con lo que llega
  manual: boolean; // el ritmo lo cargó gerencia a mano
  enCamino: number;
  llegada: string | null; // próxima llegada de una orden pendiente
  porSemana: number; // ritmo actual (u./semana)
  tendencia: number | null; // últimos 28 días vs 84 días (1 = igual)
  estacional: boolean;
  semanas: number[]; // últimas 12 semanas, de la más vieja a la última
  diasHistoria: number;
  seAcaba: string | null; // fecha estimada en que se queda sin stock (null = más de un año)
  hueco: { desde: string; hasta: string } | null; // se queda sin stock antes de que llegue lo pedido
  diasStock: number | null;
  pedirAntes: string | null;
  sugerido: number;
  estado: Estado;
  incluye: string | null; // otro producto que se cuenta junto (ej. el blister x4 en las unidades sueltas)
};

const DIA = 86400000;
export const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const sumar = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
const entre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);

export async function getConfigForecast(): Promise<ConfigForecast> {
  const { data } = await db().from("app_settings").select("value").eq("key", "forecast").maybeSingle();
  const v = (data?.value as Partial<ConfigForecast>) ?? {};
  return { ...CONFIG_DEFAULT, ...v, ritmos: v.ritmos ?? {} };
}

export type ResumenHistorial = {
  lineas: number;
  desde: string | null;
  hasta: string | null;
  importado: string | null;
  corte: string | null;
  sin_equivalencia: { sku: string; nombre: string | null; unidades: number }[];
};

export async function getResumenHistorial(): Promise<ResumenHistorial> {
  const { data, error } = await db().rpc("forecast_historial_resumen");
  if (error) throw new Error(error.message);
  const r = (data as ResumenHistorial[])[0];
  return { ...r, lineas: Number(r.lineas) };
}

// una sola llamada: una fila por producto con {dia: cantidad}
async function getDemanda(desde: string) {
  const { data, error } = await db().rpc("forecast_demanda_json", { p_desde: desde });
  if (error) throw new Error(error.message);
  const filas: { product_id: string; dia: string; qty: number }[] = [];
  for (const r of (data ?? []) as { product_id: string; dias: Record<string, number> }[]) {
    for (const [dia, qty] of Object.entries(r.dias)) filas.push({ product_id: r.product_id, dia, qty: Number(qty) });
  }
  return filas;
}

// índice por mes (0-11) a partir de los 12 meses completos anteriores a `corte`
function estacionalidad(porMes: Map<string, number>, corte: string, inicio: string): number[] | null {
  const meses: string[] = [];
  let m = new Date(`${corte.slice(0, 7)}-01T12:00:00Z`);
  for (let i = 0; i < 12; i++) {
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1, 12));
    meses.push(m.toISOString().slice(0, 7));
  }
  if (meses[11] < inicio.slice(0, 7) || (meses[11] === inicio.slice(0, 7) && inicio.slice(8) !== "01")) return null;
  const tot = meses.map((k) => porMes.get(k) ?? 0);
  const prom = tot.reduce((s, x) => s + x, 0) / 12;
  if (prom * 12 < 24) return null; // muy pocas ventas para sacar conclusiones
  const idx = new Array(12).fill(1);
  meses.forEach((k, i) => {
    const raw = tot[i] / prom;
    idx[Number(k.slice(5, 7)) - 1] = Math.min(1.6, Math.max(0.6, 1 + 0.5 * (raw - 1)));
  });
  return idx;
}

export async function getForecast(cfg: ConfigForecast): Promise<{ filas: FilaForecast[]; inicio: string | null; sinVincular: string[] }> {
  const hoy = hoyAR();
  const ayer = sumar(hoy, -1);
  const [demanda, { data: productos, error: e1 }, { data: stock, error: e2 }, { data: oc, error: e3 }, resumen, { data: sueltas }, { data: pre, error: e4 }] = await Promise.all([
    getDemanda(sumar(hoy, -800)),
    db().from("products").select("id, sku, name, unit, category, type, active, own_made, split_into_product_id, split_factor").eq("active", true),
    db().from("v_stock_disponible").select("product_id, on_hand, reserved, location_id"),
    db()
      .from("purchase_order_lines")
      .select("product_id, quantity, received_qty, order:purchase_orders!inner(status, order_date, expected_date)")
      .not("product_id", "is", null)
      .in("order.status", ["PENDIENTE", "RECIBIDA_PARCIAL"]),
    getResumenHistorial(),
    // ítems de órdenes abiertas sin producto vinculado: no se pueden contar como "en camino"
    db()
      .from("purchase_order_lines")
      .select("description, quantity, received_qty, order:purchase_orders!inner(status)")
      .is("product_id", null)
      .in("order.status", ["PENDIENTE", "RECIBIDA_PARCIAL"]),
    db()
      .from("preorder_lines")
      .select("product_id, quantity, delivered, preorder:preorders!inner(status)")
      .in("preorder.status", ["PENDIENTE", "PARCIAL"]),
  ]);
  if (e1 || e2 || e3 || e4) throw new Error((e1 ?? e2 ?? e3 ?? e4)!.message);
  const prevendido = new Map<string, number>();
  for (const l of pre ?? []) {
    const q = Number(l.quantity) - Number(l.delivered);
    if (q > 0) prevendido.set(l.product_id, (prevendido.get(l.product_id) ?? 0) + q);
  }

  const inicio = demanda.length ? demanda.reduce((a, d) => (d.dia < a ? d.dia : a), demanda[0].dia) : null;
  const corte = resumen.corte ?? hoy;
  const diasHistoria = inicio ? Math.max(1, entre(inicio, hoy)) : 0;

  const porProd = new Map<string, Map<string, number>>();
  for (const d of demanda) {
    let m = porProd.get(d.product_id);
    if (!m) porProd.set(d.product_id, (m = new Map()));
    m.set(d.dia, (m.get(d.dia) ?? 0) + Number(d.qty));
  }
  const libre = new Map<string, number>();
  for (const s of stock ?? []) libre.set(s.product_id, (libre.get(s.product_id) ?? 0) + Number(s.on_hand) - Number(s.reserved));
  const llegadas = new Map<string, { dia: string; qty: number }[]>();
  for (const l of (oc ?? []) as unknown as { product_id: string; quantity: number | null; received_qty: number; order: { order_date: string; expected_date: string | null } }[]) {
    const falta = Number(l.quantity ?? 0) - Number(l.received_qty ?? 0);
    if (falta <= 0) continue;
    let dia = l.order.expected_date ?? sumar(l.order.order_date, cfg.demora);
    if (dia <= hoy) dia = sumar(hoy, 1); // atrasada: se supone que llega ya
    const arr = llegadas.get(l.product_id) ?? [];
    arr.push({ dia, qty: falta });
    llegadas.set(l.product_id, arr);
  }

  // productos que se separan en otro (blister x4 → unidades sueltas): es el mismo producto,
  // así que se suman al suelto en unidades (stock, ventas y lo que viene) y el blister no se
  // muestra aparte.
  const activos = new Set((productos ?? []).map((p) => p.id));
  const incluye = new Map<string, string>();
  const unidos = new Set<string>();
  for (const b of productos ?? []) {
    const destino = b.split_into_product_id as string | null;
    const f = Number(b.split_factor);
    if (!destino || !activos.has(destino) || !(f > 0)) continue;
    unidos.add(b.id);
    const dd = porProd.get(destino) ?? new Map<string, number>();
    for (const [d, q] of porProd.get(b.id) ?? []) dd.set(d, (dd.get(d) ?? 0) + q * f);
    porProd.set(destino, dd);
    const lb = libre.get(b.id) ?? 0;
    libre.set(destino, (libre.get(destino) ?? 0) + lb * f);
    const ll = llegadas.get(destino) ?? [];
    for (const x of llegadas.get(b.id) ?? []) ll.push({ dia: x.dia, qty: x.qty * f });
    llegadas.set(destino, ll);
    if (prevendido.get(b.id)) prevendido.set(destino, (prevendido.get(destino) ?? 0) + prevendido.get(b.id)! * f);
    incluye.set(destino, `Incluye ${b.name}: ${lb.toLocaleString("es-AR")} × ${f.toLocaleString("es-AR")} u.`);
  }

  const filas: FilaForecast[] = [];
  for (const p of productos ?? []) {
    if (unidos.has(p.id)) continue;
    const dias = porProd.get(p.id) ?? new Map<string, number>();
    const total = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += dias.get(sumar(ayer, -i)) ?? 0;
      return s;
    };
    const disp = Math.max(1, diasHistoria - 1);
    const n28 = Math.min(28, disp);
    const n84 = Math.min(84, disp);
    const r28 = total(n28) / n28;
    const r84 = total(n84) / n84;
    const aMano = cfg.ritmos[p.id];
    const manual = typeof aMano === "number" && aMano > 0;
    const base = manual ? aMano / 7 : disp >= 56 ? 0.6 * r28 + 0.4 * r84 : r28;

    const porMes = new Map<string, number>();
    for (const [d, q] of dias) porMes.set(d.slice(0, 7), (porMes.get(d.slice(0, 7)) ?? 0) + q);
    const idx = inicio && !manual ? estacionalidad(porMes, corte, inicio) : null;
    const mesHoy = Number(hoy.slice(5, 7)) - 1;
    const idxAhora = idx ? (idx[mesHoy] + idx[(mesHoy + 11) % 12]) / 2 : 1;
    const ritmo = (d: number) => {
      if (!idx) return base;
      const mes = Number(sumar(hoy, d).slice(5, 7)) - 1;
      return (base * idx[mes]) / idxAhora;
    };

    const ll = llegadas.get(p.id) ?? [];
    const enCamino = ll.reduce((s, x) => s + x.qty, 0);
    const prev = prevendido.get(p.id) ?? 0;
    let s = (libre.get(p.id) ?? 0) - prev; // lo prevendido ya está comprometido
    let seAcaba: number | null = null;
    let hueco: { desde: string; hasta: string } | null = null;
    if (base > 0) {
      const ultimaLlegada = ll.reduce<string | null>((a, x) => (!a || x.dia > a ? x.dia : a), null);
      for (let d = 0; d < 366; d++) {
        const f = sumar(hoy, d);
        for (const x of ll) if (x.dia === f) s += x.qty;
        if (hueco && !hueco.hasta && s > 0) hueco.hasta = f;
        const antes = s;
        s -= ritmo(d);
        if (s <= 0) {
          // si todavía tiene que llegar algo, es un faltante transitorio: lo que no hay no se
          // vende (pero lo prevendido sigue debiéndose)
          if (ultimaLlegada && ultimaLlegada > f) {
            if (!hueco) hueco = { desde: f, hasta: "" };
            s = Math.min(antes, 0);
            continue;
          }
          seAcaba = d;
          break;
        }
      }
      if (hueco && !hueco.hasta) hueco = null;
    }
    const horizonte = cfg.demora + cfg.cubrir;
    let necesidad = 0;
    for (let d = 0; d < horizonte; d++) necesidad += ritmo(d);
    necesidad += ritmo(cfg.demora) * cfg.colchon;
    const sugerido = base > 0 ? Math.max(0, Math.ceil(necesidad + prev - Math.max(0, libre.get(p.id) ?? 0) - enCamino)) : 0;

    const pedirAntes = seAcaba !== null ? sumar(hoy, seAcaba - cfg.demora - cfg.colchon) : null;
    let estado: Estado = "OK";
    if (base <= 0) estado = "SIN_VENTAS";
    else if ((libre.get(p.id) ?? 0) - prev <= 0 && enCamino <= 0) estado = "AGOTADO";
    else if (hueco) estado = "FALTA";
    else if (pedirAntes && pedirAntes <= hoy) estado = sugerido > 0 ? "PEDIR_YA" : "OK";
    else if (pedirAntes && pedirAntes <= sumar(hoy, 14)) estado = sugerido > 0 ? "PRONTO" : "OK";

    const semanas: number[] = [];
    for (let w = 11; w >= 0; w--) {
      let q = 0;
      for (let i = 0; i < 7; i++) q += dias.get(sumar(ayer, -(w * 7 + i))) ?? 0;
      semanas.push(q);
    }

    filas.push({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      category: p.category,
      type: p.type,
      propio: !!p.own_made,
      libre: libre.get(p.id) ?? 0,
      prevendido: prev,
      manual,
      enCamino,
      llegada: ll.length ? ll.map((x) => x.dia).sort()[0] : null,
      porSemana: base * 7,
      tendencia: disp >= 56 && r84 > 0 ? r28 / r84 : null,
      estacional: !!idx,
      semanas,
      diasHistoria: disp,
      seAcaba: seAcaba !== null ? sumar(hoy, seAcaba) : null,
      hueco,
      diasStock: seAcaba,
      pedirAntes,
      sugerido,
      estado,
      incluye: incluye.get(p.id) ?? null,
    });
  }
  const orden: Record<Estado, number> = { AGOTADO: 0, FALTA: 1, PEDIR_YA: 2, PRONTO: 3, OK: 4, SIN_VENTAS: 5 };
  filas.sort((a, b) => Number(b.propio) - Number(a.propio) || orden[a.estado] - orden[b.estado] || (a.diasStock ?? 9999) - (b.diasStock ?? 9999) || b.porSemana - a.porSemana);
  const sinVincular = ((sueltas ?? []) as { description: string; quantity: number | null; received_qty: number }[])
    .filter((l) => l.quantity == null || Number(l.received_qty) < Number(l.quantity))
    .map((l) => l.description);
  return { filas, inicio, sinVincular };
}
