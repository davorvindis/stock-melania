// Cálculos del cierre de caja (los usa el formulario en vivo, la pantalla y el Excel).
// Mismas reglas que la planilla de Yura:
//  - CIERRE TOTAL (ventas) = efectivo + posnet + link MP + transferencia (los USD van aparte)
//  - "Ingresos de dinero" entran a la caja chica pero no son venta
//  - Caja chica = caja inicial + ingresos de dinero − gastos pagados con la caja + sobrante

export type LineaCaja = {
  kind: "MINORISTA" | "MAYORISTA";
  order_ref?: string | null;
  customer?: string | null;
  description?: string | null;
  cash?: number | null;
  money_in?: number | null;
  posnet?: number | null;
  mp_link?: number | null;
  transfer?: number | null;
  account?: string | null;
  usd?: number | null;
  invoice?: string | null;
};

export type GastoCaja = {
  amount: number | null;
  currency: "ARS" | "USD";
  description?: string | null;
  from_petty_cash: boolean;
};

// contadores operativos del día, con el mismo nombre que en la planilla
export const CONTADORES: { key: string; label: string }[] = [
  { key: "mercado_libre", label: "Mercado Libre" },
  { key: "motomensajeria", label: "Motomensajería" },
  { key: "correo_mayoristas", label: "Correo enviados mayoristas" },
  { key: "correo_minoristas", label: "Correo enviados minoristas" },
  { key: "visitas", label: "Visitas al local" },
  { key: "mayoristas_armados", label: "Mayoristas armados" },
  { key: "cambio_minorista", label: "Cambio minorista" },
  { key: "armado_cambio_mayorista", label: "Armado cambio mayorista" },
  { key: "armado_pendiente_mayorista", label: "Armado pendiente mayorista" },
  { key: "pedidos_mayoristas", label: "Pedidos mayoristas 19-5" },
  { key: "pedidos_web_minoristas", label: "Pedidos web 19-5 minoristas" },
];

// cuentas donde entra la plata (columna EXTRAS); se puede escribir otra
export const CUENTAS = ["Marrudi", "Joel", "Melania"];

const n = (v: unknown) => {
  const x = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : 0;
};
export const ventaDe = (l: LineaCaja) => n(l.cash) + n(l.posnet) + n(l.mp_link) + n(l.transfer);

export function totalesCierre(lines: LineaCaja[], expenses: GastoCaja[], opening = 0, surplus = 0) {
  const suma = (f: (l: LineaCaja) => number, filtro: (l: LineaCaja) => boolean = () => true) =>
    lines.filter(filtro).reduce((s, l) => s + f(l), 0);
  const efectivo = suma((l) => n(l.cash));
  const ingresosDinero = suma((l) => n(l.money_in));
  const posnet = suma((l) => n(l.posnet));
  const link = suma((l) => n(l.mp_link));
  const transferencia = suma((l) => n(l.transfer));
  const usd = suma((l) => n(l.usd));
  const ventas = efectivo + posnet + link + transferencia;
  const mayorista = suma(ventaDe, (l) => l.kind === "MAYORISTA");
  const minorista = ventas - mayorista;
  const porCuenta = new Map<string, number>();
  for (const l of lines) {
    const v = ventaDe(l);
    if (!v) continue;
    const c = (l.account ?? "").trim() || "Sin indicar";
    const k = [...porCuenta.keys()].find((x) => x.toLowerCase() === c.toLowerCase()) ?? c;
    porCuenta.set(k, (porCuenta.get(k) ?? 0) + v);
  }
  const gastos = expenses.filter((g) => g.currency === "ARS").reduce((s, g) => s + n(g.amount), 0);
  const gastosUsd = expenses.filter((g) => g.currency === "USD").reduce((s, g) => s + n(g.amount), 0);
  const gastosCaja = expenses.filter((g) => g.currency === "ARS" && g.from_petty_cash).reduce((s, g) => s + n(g.amount), 0);
  return {
    efectivo, ingresosDinero, posnet, link, transferencia, usd,
    ventas, mayorista, minorista,
    porCuenta: [...porCuenta.entries()].sort((a, b) => b[1] - a[1]),
    gastos, gastosUsd, gastosCaja,
    neto: ventas - gastos,
    cajaChica: n(opening) + ingresosDinero - gastosCaja + n(surplus),
    pagos: lines.filter((l) => ventaDe(l) || n(l.money_in) || n(l.usd)).length,
  };
}

export const pesos = (v: number) =>
  v.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const dolares = (v: number) => `US$ ${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
