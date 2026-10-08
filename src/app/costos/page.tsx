import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { getProducts, getSuppliers } from "@/lib/queries";
import {
  DESCUENTOS_MAYORISTA,
  getCostos,
  getPeriodos,
  margen,
  mesSiguiente,
  nombreMes,
  variacion,
  type FilaCosto,
} from "@/lib/compras";
import { copiarMes } from "@/lib/compras-actions";
import { fmtMoney } from "@/lib/types";
import { Card, Flash, PageTitle, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CostoForm } from "@/components/costo-form";

export const dynamic = "force-dynamic";

const pct = (n: number | null, dec = 1) =>
  n == null ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: dec, minimumFractionDigits: dec })}%`;

// pesos redondeados, para que entren en la columna: $40.800
const fmtPesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

// color del margen: rojo si pierde plata, ámbar si queda finito
const claseMargen = (m: number | null) =>
  m == null ? "text-soft" : m < 0 ? "text-red-700 font-semibold" : m < 20 ? "text-amber-700 font-medium" : "text-emerald-700";

function Variacion({ v, invertir = false }: { v: number | null; invertir?: boolean }) {
  if (v == null || Math.abs(v) < 0.05) return null;
  // costo que sube = malo (rojo); precio que sube = bueno (verde)
  const malo = invertir ? v < 0 : v > 0;
  return (
    <span className={`ml-1 text-xs font-medium ${malo ? "text-red-700" : "text-emerald-700"}`}>
      {v > 0 ? "▲" : "▼"} {pct(Math.abs(v))}
    </span>
  );
}

export default async function Costos({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; mes?: string }>;
}) {
  await requireSection("costos");
  const sp = await searchParams;
  const periodos = await getPeriodos();
  const pedido = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? `${sp.mes}-01` : null;
  const periodo = pedido ?? periodos[0] ?? null;
  const anterior = periodo ? periodos.find((p) => p < periodo) ?? null : null;
  const [filas, previas, productos, proveedores] = await Promise.all([
    periodo ? getCostos(periodo) : Promise.resolve([] as FilaCosto[]),
    anterior ? getCostos(anterior) : Promise.resolve([] as FilaCosto[]),
    getProducts(),
    getSuppliers(),
  ]);
  const prev = new Map(previas.map((f) => [f.item, f]));
  const siguiente = periodo ? mesSiguiente(periodo) : null;
  const existeSiguiente = siguiente ? periodos.includes(siguiente) : true;

  const conPrecio = filas.filter((f) => f.sale_price);
  const margenProm = conPrecio.length
    ? conPrecio.reduce((s, f) => s + (margen(f.sale_price, Number(f.total_cost)) ?? 0), 0) / conPrecio.length
    : null;
  const subieron = filas.filter((f) => (variacion(Number(f.total_cost), prev.get(f.item) ? Number(prev.get(f.item)!.total_cost) : null) ?? 0) > 0.05);
  const listaProductos = productos.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
  const listaProveedores = proveedores.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Costos de producto</PageTitle>
        {periodo && !existeSiguiente && (
          <form action={copiarMes}>
            <input type="hidden" name="periodo" value={periodo} />
            <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
              Crear {nombreMes(siguiente!)} copiando este mes
            </SubmitButton>
          </form>
        )}
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      {/* meses */}
      <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {periodos.map((p) => (
          <Link
            key={p}
            href={`/costos?mes=${p.slice(0, 7)}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm capitalize ${
              p === periodo ? "border-rose-deep bg-rose-deep font-semibold text-white" : "border-line bg-white text-soft hover:border-blush"
            }`}
          >
            {nombreMes(p)}
          </Link>
        ))}
      </div>

      {!periodo ? (
        <Card>
          <p className="mb-3 text-sm text-soft">Todavía no hay costos cargados. Agregá el primer ítem:</p>
        </Card>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card>
            <div className="text-sm text-soft">Ítems en {nombreMes(periodo)}</div>
            <div className="mt-1 font-display text-4xl leading-none">{filas.length}</div>
          </Card>
          <Card>
            <div className="text-sm text-soft">Margen promedio (minorista)</div>
            <div className={`mt-1 font-display text-4xl leading-none ${claseMargen(margenProm)}`}>{pct(margenProm)}</div>
          </Card>
          <Card>
            <div className="text-sm text-soft">
              Subieron de costo{anterior ? ` vs. ${nombreMes(anterior)}` : ""}
            </div>
            <div className={`mt-1 font-display text-4xl leading-none ${subieron.length ? "text-red-700" : ""}`}>
              {anterior ? subieron.length : "—"}
            </div>
          </Card>
        </div>
      )}

      {periodo && filas.length > 0 && (
        <Card className="mb-4">
          <p className="mb-3 text-xs text-soft">
            <b>Margen</b> = ganancia sobre el precio de venta. <b>Mayorista</b>: margen que queda aplicando cada
            descuento al precio minorista, y entre paréntesis cuánto recibís por unidad (rojo = pierde plata, ámbar = menos de 20%).
            {anterior && ` Las flechas comparan contra ${nombreMes(anterior)}.`} Tocá un ítem para ver su evolución.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Ítem</th>
                  <th className={th}>Proveedor</th>
                  <th className={th}>Costo</th>
                  <th className={th}>Precio venta</th>
                  <th className={th}>Ganancia</th>
                  <th className={th}>Margen</th>
                  {DESCUENTOS_MAYORISTA.map((d) => (
                    <th key={d} className={`${th} text-center`}>
                      −{d}%
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const costo = Number(f.total_cost);
                  const precio = f.sale_price != null ? Number(f.sale_price) : null;
                  const p = prev.get(f.item);
                  return (
                    <FilaTabla key={f.id} colSpan={6 + DESCUENTOS_MAYORISTA.length}>
                      <td className={td}>
                        <Link href={`/costos/item?nombre=${encodeURIComponent(f.item)}`} className="font-medium hover:text-rose-deep hover:underline">
                          {f.item}
                        </Link>
                        {f.notes && <div className="text-xs text-soft">{f.notes}</div>}
                      </td>
                      <td className={`${td} text-soft`}>{f.supplier?.name ?? "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {fmtMoney(costo)}
                        <Variacion v={variacion(costo, p ? Number(p.total_cost) : null)} />
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {fmtMoney(precio)}
                        <Variacion v={variacion(precio, p?.sale_price != null ? Number(p.sale_price) : null)} invertir />
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{precio != null ? fmtMoney(precio - costo) : "—"}</td>
                      <td className={`${td} ${claseMargen(margen(precio, costo))}`}>{pct(margen(precio, costo))}</td>
                      {DESCUENTOS_MAYORISTA.map((d) => {
                        const recibis = precio != null ? precio * (1 - d / 100) : null;
                        const m = recibis != null ? margen(recibis, costo) : null;
                        return (
                          <td key={d} className={`${td} whitespace-nowrap text-center text-xs`}>
                            <span className={claseMargen(m)}>{pct(m, 0)}</span>
                            {recibis != null && (
                              <span className="block text-[11px] text-soft">(recibís {fmtPesos(recibis)})</span>
                            )}
                          </td>
                        );
                      })}
                      <EditorFila>
                        <CostoForm periodo={periodo} fila={f} productos={listaProductos} proveedores={listaProveedores} />
                      </EditorFila>
                    </FilaTabla>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <details open={!periodo}>
          <summary className="cursor-pointer font-semibold text-rose-deep">
            + Agregar ítem{periodo ? ` a ${nombreMes(periodo)}` : ""}
          </summary>
          <div className="mt-3">
            <CostoForm
              periodo={periodo ?? new Date().toISOString().slice(0, 8) + "01"}
              productos={listaProductos}
              proveedores={listaProveedores}
            />
          </div>
        </details>
      </Card>
    </div>
  );
}

// fila de la tabla + fila desplegable para editar (el último hijo es el editor)
function FilaTabla({ children, colSpan }: { children: React.ReactNode[]; colSpan: number }) {
  const celdas = children.slice(0, -1);
  const editor = children[children.length - 1];
  return (
    <>
      <tr className="border-b-0 align-top">{celdas}</tr>
      <tr className="border-b border-blush-100">
        <td colSpan={colSpan} className="px-3 pb-2">
          {editor}
        </td>
      </tr>
    </>
  );
}

function EditorFila({ children }: { children: React.ReactNode }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-medium text-rose-deep hover:underline">
        Ver componentes / editar
      </summary>
      <div className="mt-2 rounded-lg bg-blush-50 p-3">{children}</div>
    </details>
  );
}
