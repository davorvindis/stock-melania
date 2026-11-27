import { can, requireSection } from "@/lib/auth";
import { CANAL_LABEL, getResumenCampania, ultimaCampania, veMontosCampania, type Canal } from "@/lib/black-friday";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/types";
import { Card, PageTitle, th, td } from "@/components/ui";
import { Versus } from "@/components/campania";
import { PestaniasVentas } from "../pestanias";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pesos = (n: number) => fmtMoney(Math.round(n)).replace(/,00$/, "");
const fmtFecha = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

export default async function CampaniaPage() {
  const user = await requireSection("ventas");
  const c = ultimaCampania();
  const montos = veMontosCampania(user);
  if (!c) {
    return (
      <div>
        <PestaniasVentas activa="/ventas/campania" forecast={can(user, "forecast")} />
        <PageTitle>Campañas</PageTitle>
        <Card>Todavía no hubo ninguna campaña de descuentos.</Card>
      </div>
    );
  }
  const r = await getResumenCampania(c);
  const descuento = r.promoTotales.montoLista - r.promoTotales.monto;
  const margen = r.promoTotales.montoConCosto - r.promoTotales.costoConocido;

  return (
    <div>
      <PestaniasVentas activa="/ventas/campania" forecast={can(user, "forecast")} />
      <PageTitle>{c.nombre}</PageTitle>
      <p className="mb-4 text-sm text-soft">
        Del {fmtFecha(c.desde)} al {fmtFecha(c.hasta)} · {r.estado === "EN_CURSO" ? "en curso" : "terminado"} (actualizado {fmtDateTime(r.actualizado)}) · Pedidos pagados de
        Wix (web, Store por el POS y mayoristas). &quot;Normal&quot; es el promedio de los mismos días de las {c.semanasBase} semanas anteriores
        {r.estado === "EN_CURSO" ? ", hasta el mismo día y hora que ahora" : ""}.
      </p>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold">Resumen</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-line">
                <th className={th}></th>
                <th className={th}>Pedidos</th>
                <th className={th}>Unidades</th>
                {montos && <th className={th}>Facturado (sin envío)</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-blush-100 font-medium">
                <td className={td}>Minorista (web + Store)</td>
                <td className={td}>
                  {fmtQty(r.minorista.pedidos)} <Versus actual={r.minorista.pedidos} base={r.baseMinorista.pedidos} />
                  <div className="text-xs font-normal text-soft">normal: {fmtQty(Math.round(r.baseMinorista.pedidos))}</div>
                </td>
                <td className={td}>
                  {fmtQty(r.minorista.unidades)} <Versus actual={r.minorista.unidades} base={r.baseMinorista.unidades} />
                  <div className="text-xs font-normal text-soft">normal: {fmtQty(Math.round(r.baseMinorista.unidades))}</div>
                </td>
                {montos && (
                  <td className={td}>
                    {pesos(r.minorista.monto)} <Versus actual={r.minorista.monto} base={r.baseMinorista.monto} />
                    <div className="text-xs font-normal text-soft">normal: {pesos(r.baseMinorista.monto)}</div>
                  </td>
                )}
              </tr>
              <tr className="border-b border-blush-100">
                <td className={td}>Total con mayoristas</td>
                <td className={td}>
                  {fmtQty(r.total.pedidos)} <Versus actual={r.total.pedidos} base={r.base.pedidos} />
                  <div className="text-xs font-normal text-soft">normal: {fmtQty(Math.round(r.base.pedidos))}</div>
                </td>
                <td className={td}>
                  {fmtQty(r.total.unidades)} <Versus actual={r.total.unidades} base={r.base.unidades} />
                  <div className="text-xs font-normal text-soft">normal: {fmtQty(Math.round(r.base.unidades))}</div>
                </td>
                {montos && (
                  <td className={td}>
                    {pesos(r.total.monto)} <Versus actual={r.total.monto} base={r.base.monto} />
                    <div className="text-xs font-normal text-soft">normal: {pesos(r.base.monto)}</div>
                  </td>
                )}
              </tr>
              {(Object.keys(CANAL_LABEL) as Canal[]).map((k) => (
                <tr key={k} className="border-b border-blush-100">
                  <td className={td}>{CANAL_LABEL[k]}</td>
                  <td className={td}>
                    {fmtQty(r.porCanal[k].pedidos)} <Versus actual={r.porCanal[k].pedidos} base={r.basePorCanal[k].pedidos} />
                  </td>
                  <td className={td}>
                    {fmtQty(r.porCanal[k].unidades)} <Versus actual={r.porCanal[k].unidades} base={r.basePorCanal[k].unidades} />
                  </td>
                  {montos && (
                    <td className={td}>
                      {pesos(r.porCanal[k].monto)} <Versus actual={r.porCanal[k].monto} base={r.basePorCanal[k].monto} />
                    </td>
                  )}
                </tr>
              ))}
              {r.porDia.map((d) => (
                <tr key={d.fecha} className="border-b border-blush-100 text-soft">
                  <td className={td}>{d.label} (minorista)</td>
                  <td className={td}>
                    {fmtQty(d.totales.pedidos)} <Versus actual={d.totales.pedidos} base={d.base.pedidos} />
                  </td>
                  <td className={td}>
                    {fmtQty(d.totales.unidades)} <Versus actual={d.totales.unidades} base={d.base.unidades} />
                  </td>
                  {montos && (
                    <td className={td}>
                      {pesos(d.totales.monto)} <Versus actual={d.totales.monto} base={d.base.monto} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.aCobrar.pedidos > 0 && (
          <p className="mt-2 text-xs text-soft">
            Hay {r.aCobrar.pedidos} pedido(s) esperando el pago{montos ? ` (${pesos(r.aCobrar.monto)})` : ""}: se suman cuando se paguen.
          </p>
        )}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold">Productos en promo (web + Store)</h2>
        <p className="mb-3 text-sm text-soft">
          Los que se cobraron por debajo del precio de lista de Wix. {fmtQty(r.promoTotales.unidades)} u. vendidas
          {montos && (
            <>
              {" "}
              · cobrado {pesos(r.promoTotales.monto)} · descuento dado {pesos(descuento)}
              {r.promoTotales.montoConCosto > 0 && (
                <>
                  {" "}
                  · margen sobre costo {pesos(margen)} ({Math.round((margen / r.promoTotales.montoConCosto) * 100)}%)
                </>
              )}
            </>
          )}
          .
        </p>
        {r.promo.length === 0 ? (
          <p className="text-sm text-soft">Todavía no se vendió ningún producto con descuento.</p>
        ) : (
          <>
            {/* mobile: tarjetas */}
            <ul className="divide-y divide-line md:hidden">
              {r.promo.map((p) => (
                <li key={p.sku} className="py-2 text-sm">
                  <div className="font-medium">{p.nombre}</div>
                  <div className="text-soft">
                    {fmtQty(p.unidades)} u. <Versus actual={p.unidades} base={p.baseUnidades} /> · normal {fmtQty(Math.round(p.baseUnidades * 10) / 10)} · -{Math.round(p.descuentoPct)}%
                  </div>
                  {montos && (
                    <div className="text-soft">
                      Cobrado {pesos(p.monto)} · descuento {pesos(p.montoLista - p.monto)}
                      {p.costo !== null ? ` · margen ${pesos(p.monto - p.costo)} (${p.monto > 0 ? Math.round(((p.monto - p.costo) / p.monto) * 100) : 0}%)` : " · sin costo cargado"}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {/* desktop: tabla */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Producto</th>
                    <th className={th}>Desc.</th>
                    <th className={th}>Unidades</th>
                    <th className={th}>Normal</th>
                    {montos && (
                      <>
                        <th className={th}>Cobrado</th>
                        <th className={th}>Descuento dado</th>
                        <th className={th}>Costo</th>
                        <th className={th}>Margen</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {r.promo.map((p) => (
                    <tr key={p.sku} className="border-b border-blush-100">
                      <td className={td}>
                        {p.nombre}
                        <div className="text-xs text-soft">{p.sku}</div>
                      </td>
                      <td className={td}>-{Math.round(p.descuentoPct)}%</td>
                      <td className={td}>
                        {fmtQty(p.unidades)} <Versus actual={p.unidades} base={p.baseUnidades} />
                      </td>
                      <td className={`${td} text-soft`}>{fmtQty(Math.round(p.baseUnidades * 10) / 10)}</td>
                      {montos && (
                        <>
                          <td className={td}>{pesos(p.monto)}</td>
                          <td className={td}>{pesos(p.montoLista - p.monto)}</td>
                          <td className={td}>{p.costo !== null ? pesos(p.costo) : <span className="text-soft">sin cargar</span>}</td>
                          <td className={td}>
                            {p.costo !== null ? (
                              <>
                                {pesos(p.monto - p.costo)}{" "}
                                <span className="text-xs text-soft">({p.monto > 0 ? Math.round(((p.monto - p.costo) / p.monto) * 100) : 0}%)</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {montos && r.promoTotales.sinCosto > 0 && (
          <p className="mt-2 text-xs text-soft">
            {r.promoTotales.sinCosto} producto(s) no tienen costo cargado en Costos (o alguno de sus componentes): el margen se calcula solo con los que sí.
          </p>
        )}
      </Card>

      {r.otros.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Otros productos vendidos sin descuento (web + Store)</h2>
          <ul className="divide-y divide-line text-sm">
            {r.otros.slice(0, 15).map((p) => (
              <li key={p.sku} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
                <span className="whitespace-nowrap">
                  {fmtQty(p.unidades)} u.{montos && <span className="ml-2 text-soft">{pesos(p.monto)}</span>}
                </span>
              </li>
            ))}
          </ul>
          {r.otros.length > 15 && <p className="mt-2 text-xs text-soft">y {r.otros.length - 15} producto(s) más.</p>}
        </Card>
      )}
    </div>
  );
}
