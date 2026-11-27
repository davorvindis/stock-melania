import Link from "next/link";
import { CANAL_LABEL, versusNormal, type Canal, type ResumenCampania } from "@/lib/black-friday";
import { fmtMoney, fmtQty } from "@/lib/types";
import { Card } from "@/components/ui";

const fmtFecha = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const pesos = (n: number) => fmtMoney(Math.round(n)).replace(/,00$/, "");

export function Versus({ actual, base }: { actual: number; base: number }) {
  const v = versusNormal(actual, base);
  if (!v) return null;
  const sube = actual >= base;
  return <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${sube ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{v}</span>;
}

function Dato({ label, valor, actual, base, normal, enCurso, ancho = false }: { label: string; valor: string; actual: number; base: number; normal: string; enCurso: boolean; ancho?: boolean }) {
  return (
    <div className={`rounded-lg border border-line bg-white p-3 ${ancho ? "col-span-2 sm:col-span-1" : ""}`}>
      <div className="text-xs text-soft">{label}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1">
        <span className="font-display text-3xl leading-none text-ink">{valor}</span>
        <Versus actual={actual} base={base} />
      </div>
      <div className="mt-1 text-xs text-soft">
        {enCurso ? "un finde normal a esta hora" : "un finde normal"}: {normal}
      </div>
    </div>
  );
}

export function TarjetaCampania({ r, montos }: { r: ResumenCampania; montos: boolean }) {
  const c = r.campania;
  const descuento = r.promoTotales.montoLista - r.promoTotales.monto;
  const margen = r.promoTotales.montoConCosto - r.promoTotales.costoConocido;
  const top = r.promo.slice(0, 5);
  const enCurso = r.estado === "EN_CURSO";
  return (
    <Card className="mt-4 border-rose-deep/40 bg-blush-100">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          🖤 {c.nombre} · {fmtFecha(c.desde)} al {fmtFecha(c.hasta)}{" "}
          <span className={`ml-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${r.estado === "EN_CURSO" ? "bg-rose-deep text-white" : "bg-white text-soft"}`}>
            {r.estado === "EN_CURSO" ? "en curso" : "terminado"}
          </span>
        </h2>
        <Link href="/ventas/campania" className="text-sm text-rose-deep hover:underline">
          Ver resumen completo →
        </Link>
      </div>

      <h3 className="mb-1 text-sm font-semibold">Minorista (web + Store)</h3>
      <div className={`grid grid-cols-2 gap-2 ${montos ? "sm:grid-cols-3" : ""}`}>
        <Dato label="Pedidos pagados" valor={fmtQty(r.minorista.pedidos)} actual={r.minorista.pedidos} base={r.baseMinorista.pedidos} normal={fmtQty(Math.round(r.baseMinorista.pedidos))} enCurso={enCurso} />
        <Dato label="Unidades" valor={fmtQty(r.minorista.unidades)} actual={r.minorista.unidades} base={r.baseMinorista.unidades} normal={fmtQty(Math.round(r.baseMinorista.unidades))} enCurso={enCurso} />
        {montos && (
          <Dato label="Facturado (sin envío)" valor={pesos(r.minorista.monto)} actual={r.minorista.monto} base={r.baseMinorista.monto} normal={pesos(r.baseMinorista.monto)} enCurso={enCurso} ancho />
        )}
      </div>

      <div className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
        {(Object.keys(CANAL_LABEL) as Canal[]).map((k) => (
          <div key={k} className="flex flex-wrap items-baseline gap-x-1">
            <span className="text-soft">{CANAL_LABEL[k]}:</span>
            <span className="font-medium">{fmtQty(r.porCanal[k].pedidos)} ped.</span>
            <span className="text-soft">· {fmtQty(r.porCanal[k].unidades)} u.</span>
            {montos && <span className="text-soft">· {pesos(r.porCanal[k].monto)}</span>}
          </div>
        ))}
      </div>

      <h3 className="mb-1 mt-4 text-sm font-semibold">Productos en promo más vendidos (web + Store)</h3>
      {top.length === 0 ? (
        <p className="text-sm text-soft">Todavía no se vendió ningún producto con descuento.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white text-sm">
          {top.map((p) => (
            <li key={p.sku} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">
                {p.nombre} <span className="text-xs text-soft">-{Math.round(p.descuentoPct)}%</span>
              </span>
              <span className="whitespace-nowrap">
                <span className="font-medium">{fmtQty(p.unidades)} u.</span>
                <Versus actual={p.unidades} base={p.baseUnidades} />
                {montos && <span className="ml-2 text-soft">{pesos(p.monto)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {montos && r.promo.length > 0 && (
        <p className="mt-3 text-sm">
          En promo se cobró <strong>{pesos(r.promoTotales.monto)}</strong> y se dieron <strong>{pesos(descuento)}</strong> de descuento sobre el precio de lista.
          {r.promoTotales.montoConCosto > 0 && (
            <>
              {" "}
              Margen sobre costo: <strong>{pesos(margen)}</strong> ({Math.round((margen / r.promoTotales.montoConCosto) * 100)}%)
              {r.promoTotales.sinCosto > 0 && <span className="text-soft"> · {r.promoTotales.sinCosto} producto(s) sin costo cargado</span>}.
            </>
          )}
        </p>
      )}
      {r.aCobrar.pedidos > 0 && (
        <p className="mt-2 text-xs text-soft">
          Además hay {r.aCobrar.pedidos} pedido(s) esperando el pago{montos ? ` (${pesos(r.aCobrar.monto)})` : ""}: se suman cuando se paguen.
        </p>
      )}
      <p className="mt-2 text-xs text-soft">
        Ventas de Wix (web, Store y mayoristas) de pedidos pagados. &quot;Un finde normal&quot; es el promedio de los mismos días de las {c.semanasBase} semanas anteriores
        {enCurso ? ", hasta el mismo día y hora que ahora" : ""}. Lo de cada producto se compara igual.
      </p>
    </Card>
  );
}
