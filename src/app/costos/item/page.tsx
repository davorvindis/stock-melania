import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { COMPONENTES, getHistorialItem, margen, nombreMes, variacion } from "@/lib/compras";
import { fmtMoney } from "@/lib/types";
import { Card, PageTitle, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

const pct = (n: number | null) =>
  n == null ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

const COSTO = "#A85751"; // marca (rose-deep)
const PRECIO = "#2B6CB0"; // azul validado en charts.tsx

// líneas de costo y precio por mes (SVG simple, sin librerías)
function Grafico({ puntos }: { puntos: { label: string; costo: number; precio: number | null }[] }) {
  if (puntos.length < 2) return <p className="text-sm text-soft">Hace falta más de un mes para ver la evolución.</p>;
  const W = 640, H = 220, pl = 64, pr = 16, pt = 16, pb = 32;
  const max = Math.max(...puntos.flatMap((p) => [p.costo, p.precio ?? 0])) * 1.1 || 1;
  const x = (i: number) => pl + (i * (W - pl - pr)) / (puntos.length - 1);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / max);
  const linea = (vals: (number | null)[]) =>
    vals.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evolución de costo y precio">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="#EDDBD8" strokeWidth="1" />
            <text x={pl - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#6F6260">
              ${Math.round(t).toLocaleString("es-AR")}
            </text>
          </g>
        ))}
        {puntos.map((p, i) => (
          <text key={p.label} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#6F6260">
            {p.label}
          </text>
        ))}
        <polyline points={linea(puntos.map((p) => p.precio))} fill="none" stroke={PRECIO} strokeWidth="2.5" />
        <polyline points={linea(puntos.map((p) => p.costo))} fill="none" stroke={COSTO} strokeWidth="2.5" />
        {puntos.map((p, i) => (
          <g key={i}>
            {p.precio != null && <circle cx={x(i)} cy={y(p.precio)} r="3.5" fill={PRECIO} />}
            <circle cx={x(i)} cy={y(p.costo)} r="3.5" fill={COSTO} />
          </g>
        ))}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-soft">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PRECIO }} /> Precio de venta
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COSTO }} /> Costo
        </span>
      </div>
    </div>
  );
}

export default async function HistorialItem({ searchParams }: { searchParams: Promise<{ nombre?: string }> }) {
  await requireSection("costos");
  const { nombre } = await searchParams;
  const filas = nombre ? await getHistorialItem(nombre) : [];
  const corto = (p: string) => {
    const [yy, mm] = p.split("-");
    return `${mm}/${yy.slice(2)}`;
  };
  const primera = filas[0];
  const ultima = filas[filas.length - 1];

  return (
    <div className="max-w-5xl">
      <div className="mb-1 text-sm">
        <Link href="/costos" className="text-soft hover:text-rose-deep">
          ← Costos
        </Link>
      </div>
      <PageTitle>{nombre ?? "Ítem"}</PageTitle>
      {filas.length === 0 ? (
        <Card>
          <p className="text-sm text-soft">No hay costos cargados para este ítem.</p>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card>
              <div className="text-sm text-soft">
                Costo: {nombreMes(primera.period)} → {nombreMes(ultima.period)}
              </div>
              <div className="mt-1 font-display text-3xl leading-none">
                {pct(variacion(Number(ultima.total_cost), Number(primera.total_cost)))}
              </div>
            </Card>
            <Card>
              <div className="text-sm text-soft">Precio de venta en el mismo período</div>
              <div className="mt-1 font-display text-3xl leading-none">
                {pct(variacion(ultima.sale_price, primera.sale_price))}
              </div>
            </Card>
            <Card>
              <div className="text-sm text-soft">Margen actual</div>
              <div className="mt-1 font-display text-3xl leading-none">
                {pct(margen(ultima.sale_price, Number(ultima.total_cost)))}
              </div>
            </Card>
          </div>

          <Card className="mb-4">
            <Grafico
              puntos={filas.map((f) => ({
                label: corto(f.period),
                costo: Number(f.total_cost),
                precio: f.sale_price != null ? Number(f.sale_price) : null,
              }))}
            />
          </Card>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Mes</th>
                    {COMPONENTES.map(([, l]) => (
                      <th key={l} className={th}>
                        {l}
                      </th>
                    ))}
                    <th className={th}>Costo total</th>
                    <th className={th}>Var.</th>
                    <th className={th}>Precio</th>
                    <th className={th}>Var.</th>
                    <th className={th}>Margen</th>
                    <th className={th}>Cotización / notas</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => {
                    const p = filas[i - 1];
                    return (
                      <tr key={f.id} className="border-b border-blush-100">
                        <td className={`${td} whitespace-nowrap capitalize`}>
                          <Link href={`/costos?mes=${f.period.slice(0, 7)}`} className="hover:text-rose-deep hover:underline">
                            {nombreMes(f.period)}
                          </Link>
                        </td>
                        {COMPONENTES.map(([k]) => (
                          <td key={k} className={`${td} whitespace-nowrap text-soft`}>
                            {f[k] != null ? fmtMoney(f[k]) : ""}
                          </td>
                        ))}
                        <td className={`${td} whitespace-nowrap font-semibold`}>{fmtMoney(f.total_cost)}</td>
                        <td className={td}>{p ? pct(variacion(Number(f.total_cost), Number(p.total_cost))) : ""}</td>
                        <td className={`${td} whitespace-nowrap`}>{fmtMoney(f.sale_price)}</td>
                        <td className={td}>{p ? pct(variacion(f.sale_price, p.sale_price)) : ""}</td>
                        <td className={td}>{pct(margen(f.sale_price, Number(f.total_cost)))}</td>
                        <td className={`${td} text-xs text-soft`}>
                          {[f.quote_note, f.notes].filter(Boolean).join(" · ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
