import Link from "next/link";
import { can, requireSection } from "@/lib/auth";
import { ESTADOS, getConfigForecast, getForecast, getResumenHistorial, hoyAR, type Estado, type FilaForecast } from "@/lib/forecast";
import { guardarConfigForecast, guardarRitmo, importarHistorialWix } from "@/lib/forecast-actions";
import { wixConfigurado } from "@/lib/wix/client";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { PestaniasVentas } from "../pestanias";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SP = { ok?: string; error?: string; estado?: string; cat?: string; q?: string };

const FILTROS: [string, string][] = [
  ["", "Para comprar"],
  ["todos", "Todos con ventas"],
  ["AGOTADO", "Sin stock"],
  ["FALTA", "Falta hasta que llegue"],
  ["PEDIR_YA", "Pedir ya"],
  ["PRONTO", "Pedir pronto"],
  ["OK", "Bien"],
  ["SIN_VENTAS", "Sin ventas"],
];
const PARA_COMPRAR: Estado[] = ["AGOTADO", "FALTA", "PEDIR_YA", "PRONTO"];

function redondeo(n: number) {
  if (n >= 100) return Math.round(n);
  return Math.round(n * 10) / 10;
}

function Barras({ semanas }: { semanas: number[] }) {
  const max = Math.max(...semanas, 1);
  return (
    <svg viewBox="0 0 60 16" className="h-4 w-16" aria-label="Ventas de las últimas 12 semanas">
      {semanas.map((q, i) => {
        const h = q > 0 ? Math.max(1.5, (q / max) * 16) : 0.5;
        return <rect key={i} x={i * 5} y={16 - h} width={3.6} height={h} rx={0.6} className={i >= 8 ? "fill-rose-deep" : "fill-blush"} />;
      })}
    </svg>
  );
}

function Tendencia({ t }: { t: number | null }) {
  if (t == null) return null;
  if (t >= 1.2) return <span className="text-xs font-medium text-emerald-700">↑ {Math.round((t - 1) * 100)}%</span>;
  if (t <= 0.8) return <span className="text-xs font-medium text-amber-800">↓ {Math.round((1 - t) * 100)}%</span>;
  return <span className="text-xs text-soft">estable</span>;
}

function Chip({ e }: { e: Estado }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADOS[e].clase}`}>{ESTADOS[e].label}</span>;
}

function frase(f: FilaForecast, hoy: string) {
  if (f.estado === "SIN_VENTAS") return "No tuvo ventas en los últimos meses.";
  const falta = f.hueco
    ? `Se queda sin stock el ${fmtDate(f.hueco.desde)} y lo pedido llega el ${fmtDate(f.hueco.hasta)}: unos ${Math.round(
        (Date.parse(f.hueco.hasta) - Date.parse(f.hueco.desde)) / 86400000
      )} días sin stock. Conviene adelantar la entrega. `
    : "";
  const acaba = f.seAcaba
    ? f.diasStock === 0
      ? "Ya no alcanza el stock libre"
      : `Prevemos quedarnos sin stock el ${fmtDate(f.seAcaba)} (en ${f.diasStock} días)`
    : "Alcanza para más de un año";
  const pedir =
    f.sugerido > 0 && f.pedirAntes
      ? f.pedirAntes <= hoy
        ? `. ${f.propio ? "Hay que fabricar ya" : "Hacé la orden de compra ya"}: unas ${fmtQty(f.sugerido)} u.`
        : `. ${f.propio ? "Fabricá" : "Hacé la orden"} antes del ${fmtDate(f.pedirAntes)}: unas ${fmtQty(f.sugerido)} u.`
      : ".";
  return falta + acaba + pedir;
}

function Lista({ lista, hoy }: { lista: FilaForecast[]; hoy: string }) {
  return (
    <>
      {/* mobile: tarjetas */}
      <div className="grid gap-3 md:grid-cols-2 lg:hidden">
        {lista.map((f) => (
          <Card key={f.id}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/productos/${f.id}`} className="font-semibold text-ink hover:underline">
                  {f.name}
                </Link>
                <div className="truncate text-xs text-soft">{f.sku}</div>
                {f.incluye && <div className="text-xs text-rose-deep">{f.incluye}</div>}
              </div>
              <Chip e={f.estado} />
            </div>
            <p className="mb-2 text-sm text-ink">{frase(f, hoy)}</p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs text-soft">Stock libre</div>
                <div className="font-medium">{fmtQty(f.libre)}</div>
                {f.prevendido > 0 && <div className="text-xs text-amber-800">prevendido {fmtQty(f.prevendido)}</div>}
              </div>
              <div>
                <div className="text-xs text-soft">En camino</div>
                <div className="font-medium">{f.enCamino ? fmtQty(f.enCamino) : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-soft">Por semana</div>
                <div className="font-medium">{fmtQty(redondeo(f.porSemana))}</div>
                {f.manual && <div className="text-xs text-rose-deep">cargado a mano</div>}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Barras semanas={f.semanas} />
              {!f.manual && <Tendencia t={f.tendencia} />}
            </div>
          </Card>
        ))}
      </div>

      {/* desktop: tabla */}
      <Card className="hidden overflow-x-auto lg:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Producto</th>
              <th className={th}>Estado</th>
              <th className={`${th} text-right`}>Stock libre</th>
              <th className={`${th} text-right`}>En camino</th>
              <th className={th}>Ventas por semana</th>
              <th className={th}>Se acaba</th>
              <th className={th}>Pedir antes del</th>
              <th className={`${th} text-right`}>Sugerido</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id} className="border-b border-blush-100 align-top">
                <td className={td}>
                  <Link href={`/productos/${f.id}`} className="font-medium text-ink hover:underline">
                    {f.name}
                  </Link>
                  <div className="text-xs text-soft">{f.sku}</div>
                  {f.incluye && <div className="text-xs text-rose-deep">{f.incluye}</div>}
                </td>
                <td className={td}>
                  <Chip e={f.estado} />
                </td>
                <td className={`${td} text-right`}>
                  {fmtQty(f.libre)}
                  {f.prevendido > 0 && <div className="text-xs text-amber-800">prevendido {fmtQty(f.prevendido)}</div>}
                </td>
                <td className={`${td} text-right`}>
                  {f.enCamino ? fmtQty(f.enCamino) : "—"}
                  {f.llegada && <div className="text-xs text-soft">llega {fmtDate(f.llegada)}</div>}
                </td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-right font-medium">{fmtQty(redondeo(f.porSemana))}</span>
                    <Barras semanas={f.semanas} />
                  </div>
                  {f.manual ? <div className="text-xs text-rose-deep">cargado a mano</div> : <Tendencia t={f.tendencia} />}
                </td>
                <td className={td}>
                  {f.seAcaba ? (
                    <>
                      {fmtDate(f.seAcaba)}
                      <div className="text-xs text-soft">{f.diasStock === 0 ? "ya" : `en ${f.diasStock} días`}</div>
                    </>
                  ) : f.estado === "SIN_VENTAS" ? (
                    "—"
                  ) : (
                    <span className="text-soft">+1 año</span>
                  )}
                  {f.hueco && (
                    <div className="text-xs font-medium text-orange-800">
                      Falta del {fmtDate(f.hueco.desde)} al {fmtDate(f.hueco.hasta)}
                    </div>
                  )}
                </td>
                <td className={td}>
                  {f.sugerido > 0 && f.pedirAntes ? (
                    f.pedirAntes <= hoy ? (
                      <span className="font-semibold text-rose-deep">Ya</span>
                    ) : (
                      fmtDate(f.pedirAntes)
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${td} text-right font-semibold`}>{f.sugerido > 0 ? `${fmtQty(f.sugerido)} u.` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export default async function Forecast({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireSection("forecast");
  const sp = await searchParams;
  const hoy = hoyAR();
  const cfg = await getConfigForecast();
  const [{ filas, inicio, sinVincular }, hist] = await Promise.all([getForecast(cfg), getResumenHistorial()]);

  const cats = [...new Set(filas.map((f) => f.category ?? "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es"));
  const q = (sp.q ?? "").trim().toLowerCase();
  const lista = filas.filter((f) => {
    if (sp.estado === "todos") {
      if (f.estado === "SIN_VENTAS") return false;
    } else if (sp.estado && sp.estado in ESTADOS) {
      if (f.estado !== sp.estado) return false;
    } else if (!PARA_COMPRAR.includes(f.estado) && !f.propio) return false; // los propios se ven siempre
    if (sp.cat && (f.category ?? "Sin categoría") !== sp.cat) return false;
    if (q && !`${f.name} ${f.sku}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const conRitmo = filas.filter((f) => f.manual);
  const propios = lista.filter((f) => f.propio);
  const comprados = lista.filter((f) => !f.propio);
  const cuenta = (e: Estado) => filas.filter((f) => f.estado === e).length;
  const poca = filas.some((f) => f.estado !== "SIN_VENTAS" && f.diasHistoria < 60);

  return (
    <div>
      <PageTitle>Ventas</PageTitle>
      <PestaniasVentas activa="/ventas/forecast" forecast={can(user, "forecast")} />
      <Flash ok={sp.ok} error={sp.error} />

      <p className="mb-4 text-sm text-soft">
        Con lo que se viene vendiendo, calcula hasta cuándo alcanza el stock libre de cada producto (stock menos lo reservado, más lo que viene en órdenes de
        compra pendientes) y cuándo y cuánto conviene pedir. Es una estimación: revisala antes de comprar.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(["AGOTADO", "FALTA", "PEDIR_YA", "PRONTO", "OK"] as Estado[]).map((e) => (
          <Link key={e} href={`/ventas/forecast?estado=${e}`} className="block">
            <Card className={sp.estado === e ? "ring-2 ring-rose-deep" : ""}>
              <div className="text-sm text-soft">{ESTADOS[e].label}</div>
              <div className="mt-1 font-display text-4xl leading-none">{cuenta(e)}</div>
              <div className="text-xs text-soft">producto(s)</div>
            </Card>
          </Link>
        ))}
      </div>

      {sinVincular.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {sinVincular.length} ítem(s) de órdenes de compra abiertas no tienen el producto vinculado, así que no se cuentan en &quot;En camino&quot;:{" "}
          {sinVincular.slice(0, 6).join(", ")}
          {sinVincular.length > 6 ? "…" : ""}. Vinculalos en{" "}
          <Link href="/compras" className="font-medium underline">
            Órdenes de compra
          </Link>{" "}
          → abrir la orden → Editar orden, y cargá la entrega estimada.
        </div>
      )}

      {poca && (
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Hay poca historia de ventas (desde el {fmtDate(inicio)}): el ritmo se calcula con pocas semanas y no se tiene en cuenta la temporada.
          {hist.lineas === 0 && " Traé el historial de Wix (abajo) para mejorar la estimación."}
        </div>
      )}

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-4">
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado" className={input}>
          {FILTROS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select name="cat" defaultValue={sp.cat ?? ""} aria-label="Categoría" className={input}>
          <option value="">Todas las categorías</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar producto o SKU" className={input} />
        <button type="submit" className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
          Ver
        </button>
      </form>

      {lista.length === 0 ? (
        <Card>
          <p className="text-sm text-soft">
            {!sp.estado && !sp.cat && !q ? "No hay productos para comprar por ahora. " : "No hay productos con estos filtros. "}
            <Link href="/ventas/forecast?estado=todos" className="font-medium text-rose-deep hover:underline">
              Ver todos
            </Link>
          </p>
        </Card>
      ) : (
        <>
          {propios.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-soft">Fabricación propia ({propios.length})</h2>
              <p className="mb-2 text-xs text-soft">Lo que fabricamos nosotros: se muestran siempre, aunque estén bien de stock.</p>
              <Lista lista={propios} hoy={hoy} />
            </section>
          )}
          {comprados.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-soft">Productos que compramos ({comprados.length})</h2>
              <Lista lista={comprados} hoy={hoy} />
            </section>
          )}
        </>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-lg font-semibold text-ink">Cómo calcula</h2>
          <p className="mb-3 text-sm text-soft">
            Ritmo de venta: promedio de los últimos 28 días (pesa más) y de los últimos 84. Cuenta ventas minoristas y mayoristas, regalos, muestras, uso
            interno y lo usado para armar kits. Si hay más de un año de historial, ajusta por temporada (cómo se vendió cada mes el año anterior). La cantidad
            sugerida cubre la demora del proveedor más los días a cubrir y el colchón, menos el stock libre y lo que está en camino. Lo prevendido (Preventa) se descuenta primero: se paga con lo que llega.
          </p>
          <form action={guardarConfigForecast} className="grid grid-cols-3 gap-2">
            <div>
              <label className={label} htmlFor="demora">
                Demora proveedor (días)
              </label>
              <input id="demora" name="demora" defaultValue={cfg.demora} inputMode="numeric" className={input} />
            </div>
            <div>
              <label className={label} htmlFor="colchon">
                Colchón (días)
              </label>
              <input id="colchon" name="colchon" defaultValue={cfg.colchon} inputMode="numeric" className={input} />
            </div>
            <div>
              <label className={label} htmlFor="cubrir">
                Comprar para (días)
              </label>
              <input id="cubrir" name="cubrir" defaultValue={cfg.cubrir} inputMode="numeric" className={input} />
            </div>
            <div className="col-span-3 flex justify-end">
              <SubmitButton className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush">
                Guardar
              </SubmitButton>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-semibold text-ink">Ventas por semana a mano</h2>
          <p className="mb-3 text-sm text-soft">
            Si sabés que un producto se va a vender distinto de lo que muestra la historia (por ejemplo, faltó stock y se vendió menos), cargá cuánto
            esperás vender por semana y el Forecast usa ese número en lugar del calculado.
          </p>
          {conRitmo.length > 0 && (
            <ul className="mb-3 divide-y divide-blush-100 text-sm">
              {conRitmo.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">{f.name}</span>
                  <span className="flex items-center gap-3 whitespace-nowrap">
                    <span className="font-medium">{fmtQty(cfg.ritmos[f.id])} u./semana</span>
                    <form action={guardarRitmo}>
                      <input type="hidden" name="producto" value={f.id} />
                      <input type="hidden" name="ritmo" value="" />
                      <SubmitButton className="text-xs font-medium text-rose-deep hover:underline">Quitar</SubmitButton>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form action={guardarRitmo} className="grid grid-cols-3 gap-2">
            <select name="producto" aria-label="Producto" className={`${input} col-span-3 sm:col-span-2`} defaultValue="">
              <option value="" disabled>
                Elegí un producto
              </option>
              {[...filas]
                .sort((a, b) => a.name.localeCompare(b.name, "es"))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
            <input name="ritmo" inputMode="decimal" placeholder="u. por semana" aria-label="Unidades por semana" className={`${input} col-span-2 sm:col-span-1`} />
            <div className="flex justify-end sm:col-span-3">
              <SubmitButton className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush">
                Guardar
              </SubmitButton>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-semibold text-ink">Historial de Wix</h2>
          <p className="mb-2 text-sm text-soft">
            Las ventas de la web anteriores al {fmtDate(hist.corte)} (cuando arrancó la app) se traen de Wix y se pasan a nuestros productos con las
            equivalencias. Lo posterior ya está en la app, así que no se cuenta dos veces.
          </p>
          {hist.lineas > 0 ? (
            <p className="mb-2 text-sm text-ink">
              {fmtQty(hist.lineas)} productos vendidos del {fmtDate(hist.desde)} al {fmtDate(hist.hasta)} · actualizado{" "}
              {hist.importado ? fmtDateTime(hist.importado) : "—"}
            </p>
          ) : (
            <p className="mb-2 text-sm text-ink">Todavía no se trajo el historial.</p>
          )}
          {wixConfigurado() ? (
            <form action={importarHistorialWix}>
              <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
                Traer historial de Wix
              </SubmitButton>
            </form>
          ) : (
            <p className="text-xs text-soft">Wix no está conectado en este entorno: el botón aparece en producción.</p>
          )}
          {hist.sin_equivalencia.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-amber-800">
                {hist.sin_equivalencia.length} SKU(s) del historial sin equivalencia: esas ventas no se cuentan
              </summary>
              <ul className="mt-2 space-y-1">
                {hist.sin_equivalencia.map((s) => (
                  <li key={s.sku} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {s.nombre ?? s.sku} <span className="text-xs text-soft">{s.sku}</span>
                    </span>
                    <span className="whitespace-nowrap text-soft">{fmtQty(s.unidades)} u.</span>
                  </li>
                ))}
              </ul>
              <Link href="/equivalencias" className="mt-2 inline-block font-medium text-rose-deep hover:underline">
                Cargar equivalencias
              </Link>
            </details>
          )}
        </Card>
      </div>
    </div>
  );
}
