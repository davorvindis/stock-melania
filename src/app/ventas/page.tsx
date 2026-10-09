import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLocations, getProducts } from "@/lib/queries";
import { CANALES, agruparPedidos, getVentas, porPersona, porProducto, rangoMesActual } from "@/lib/ventas";
import { MOVEMENT_LABELS, fmtDate, fmtDateTime, fmtQty } from "@/lib/types";
import { Card, PageTitle, input, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = {
  desde?: string;
  hasta?: string;
  persona?: string;
  producto?: string;
  ubicacion?: string;
  canal?: string;
  vista?: string;
};

const VISTAS = [
  ["resumen", "Resumen"],
  ["productos", "Por producto"],
  ["pedidos", "Por pedido"],
] as const;

const canalClass = (t: string) =>
  t === "WHOLESALE_SALE" ? "bg-violet-100 text-violet-800" : t === "SALE" ? "bg-blush-100 text-rose-deeper" : "bg-stone-200 text-stone-700";

export default async function Ventas({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSection("ventas");
  const sp = await searchParams;
  const def = rangoMesActual();
  const f = { ...sp, desde: sp.desde ?? def.desde, hasta: sp.hasta ?? def.hasta };
  const vista = VISTAS.some(([v]) => v === sp.vista) ? sp.vista! : "resumen";

  const [lineas, productos, ubicaciones, { data: perfiles }] = await Promise.all([
    getVentas(f),
    getProducts(),
    getLocations(),
    db().from("profiles").select("alias").order("alias"),
  ]);
  const pedidos = agruparPedidos(lineas);
  const prods = porProducto(lineas);
  const personas = porPersona(pedidos);
  const uMin = prods.reduce((s, p) => s + p.minorista, 0);
  const uMay = prods.reduce((s, p) => s + p.mayorista, 0);
  const uOtras = prods.reduce((s, p) => s + p.otras, 0);
  const pMin = pedidos.filter((p) => p.tipo === "SALE").length;
  const pMay = pedidos.filter((p) => p.tipo === "WHOLESALE_SALE").length;

  const qs = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) params.set(k, v);
    return `?${params.toString()}`;
  };
  const exportQs = qs({ vista: undefined });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Ventas</PageTitle>
        <a
          href={`/api/export/ventas${exportQs}`}
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
        >
          Descargar Excel
        </a>
      </div>

      <form method="get" className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        <input type="hidden" name="vista" value={vista} />
        <label className="flex items-center gap-2 text-sm text-soft">
          Desde
          <input type="date" name="desde" defaultValue={f.desde} className={input} />
        </label>
        <label className="flex items-center gap-2 text-sm text-soft">
          Hasta
          <input type="date" name="hasta" defaultValue={f.hasta} className={input} />
        </label>
        <select name="canal" defaultValue={sp.canal ?? ""} aria-label="Canal" className={input}>
          {Object.entries(CANALES).map(([v, c]) => (
            <option key={v} value={v}>
              {c.label}
            </option>
          ))}
        </select>
        <select name="persona" defaultValue={sp.persona ?? ""} aria-label="Persona" className={input}>
          <option value="">Todas las personas</option>
          {(perfiles ?? []).map((p) => (
            <option key={p.alias} value={p.alias}>
              {p.alias}
            </option>
          ))}
        </select>
        <select name="ubicacion" defaultValue={sp.ubicacion ?? ""} aria-label="Ubicación" className={input}>
          <option value="">Todas las ubicaciones</option>
          {ubicaciones.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select name="producto" defaultValue={sp.producto ?? ""} aria-label="Producto" className={input}>
          <option value="">Todos los productos</option>
          {productos
            .filter((p) => p.active)
            .sort((a, b) => a.name.localeCompare(b.name, "es"))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <button type="submit" className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
          Ver
        </button>
      </form>
      <p className="mb-4 text-sm text-soft">
        Del {fmtDate(f.desde)} al {fmtDate(f.hasta)}
        {sp.persona ? ` · ${sp.persona}` : ""} · las ventas revertidas no se cuentan ·{" "}
        <Link href="/ventas" className="font-medium text-rose-deep hover:underline">
          Este mes
        </Link>
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <div className="text-sm text-soft">Minorista</div>
          <div className="mt-1 font-display text-4xl leading-none">{fmtQty(uMin)} u.</div>
          <div className="text-xs text-soft">{pMin} pedido(s)</div>
        </Card>
        <Card>
          <div className="text-sm text-soft">Mayorista</div>
          <div className="mt-1 font-display text-4xl leading-none">{fmtQty(uMay)} u.</div>
          <div className="text-xs text-soft">{pMay} pedido(s)</div>
        </Card>
        <Card>
          <div className="text-sm text-soft">Total vendido</div>
          <div className="mt-1 font-display text-4xl leading-none">{fmtQty(uMin + uMay)} u.</div>
          <div className="text-xs text-soft">{prods.filter((p) => p.minorista + p.mayorista > 0).length} producto(s) distintos</div>
        </Card>
        <Card>
          <div className="text-sm text-soft">Otras salidas</div>
          <div className="mt-1 font-display text-4xl leading-none">{fmtQty(uOtras)} u.</div>
          <div className="text-xs text-soft">{sp.canal === "otras" ? "regalo, muestra, uso interno" : "elegí el canal “Otras salidas”"}</div>
        </Card>
      </div>

      <div className="mb-4 inline-flex rounded-lg border border-line bg-white p-1 text-sm">
        {VISTAS.map(([v, l]) => (
          <Link
            key={v}
            href={`/ventas${qs({ vista: v })}`}
            className={`rounded-md px-3 py-1.5 font-medium ${vista === v ? "bg-rose-deep text-white" : "text-soft hover:text-ink"}`}
          >
            {l}
          </Link>
        ))}
      </div>

      {lineas.length === 0 && (
        <Card>
          <p className="text-sm text-soft">No hay ventas con estos filtros.</p>
        </Card>
      )}

      {lineas.length > 0 && vista === "resumen" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-2 font-semibold">Por persona</h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Persona</th>
                  <th className={th}>Pedidos</th>
                  <th className={th}>Minorista</th>
                  <th className={th}>Mayorista</th>
                  <th className={th}>Total u.</th>
                </tr>
              </thead>
              <tbody>
                {personas.map((r) => (
                  <tr key={r.persona} className="border-b border-blush-100">
                    <td className={td}>
                      <Link href={`/ventas${qs({ persona: r.persona, vista: "pedidos" })}`} className="font-medium hover:text-rose-deep hover:underline">
                        {r.persona}
                      </Link>
                    </td>
                    <td className={td}>{r.pedidos}</td>
                    <td className={td}>{fmtQty(r.minorista)}</td>
                    <td className={td}>{fmtQty(r.mayorista)}</td>
                    <td className={`${td} font-semibold`}>{fmtQty(r.unidades)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Los 10 más vendidos</h2>
            <ol className="space-y-1.5 text-sm">
              {prods.slice(0, 10).map((p, i) => (
                <li key={p.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="text-soft">{i + 1}.</span> {p.name}
                  </span>
                  <span className="shrink-0 font-semibold">{fmtQty(p.total)}</span>
                </li>
              ))}
            </ol>
            <Link href={`/ventas${qs({ vista: "productos" })}`} className="mt-3 inline-block text-sm font-medium text-rose-deep hover:underline">
              Ver todos los productos →
            </Link>
          </Card>
        </div>
      )}

      {lineas.length > 0 && vista === "productos" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Producto</th>
                  <th className={th}>SKU</th>
                  <th className={th}>Minorista</th>
                  <th className={th}>Mayorista</th>
                  {uOtras > 0 && <th className={th}>Otras salidas</th>}
                  <th className={th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {prods.map((p) => (
                  <tr key={p.id} className="border-b border-blush-100">
                    <td className={td}>
                      <Link href={`/ventas${qs({ producto: p.id, vista: "pedidos" })}`} className="hover:text-rose-deep hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className={`${td} font-mono text-xs text-soft`}>{p.sku}</td>
                    <td className={td}>{p.minorista ? fmtQty(p.minorista) : "—"}</td>
                    <td className={td}>{p.mayorista ? fmtQty(p.mayorista) : "—"}</td>
                    {uOtras > 0 && <td className={td}>{p.otras ? fmtQty(p.otras) : "—"}</td>}
                    <td className={`${td} font-semibold`}>
                      {fmtQty(p.total)} <span className="text-xs font-normal text-soft">{p.unit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {lineas.length > 0 && vista === "pedidos" && (
        <div className="space-y-2">
          {pedidos.map((p) => (
            <details key={p.key} className="rounded-xl border border-line bg-white p-3">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${canalClass(p.tipo)}`}>
                      {MOVEMENT_LABELS[p.tipo] ?? p.tipo}
                    </span>
                    <span className="font-semibold">{p.numero ?? "Sin N° de pedido"}</span>
                    <span className="text-sm text-soft">
                      {fmtDateTime(p.fecha)} · {p.actor ?? "—"} · {p.ubicacion ?? "—"}
                    </span>
                  </div>
                  <span className="text-sm">
                    <b>{fmtQty(p.unidades)} u.</b> · {p.lineas.length} producto(s) <span className="text-rose-deep">▾</span>
                  </span>
                </div>
                {p.notas && <p className="mt-1 whitespace-pre-line text-sm text-soft">📝 {p.notas}</p>}
              </summary>
              <ul className="mt-3 divide-y divide-blush-100 border-t border-blush-100 text-sm">
                {p.lineas.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2 py-1.5">
                    <span>
                      {l.product.name}
                      {l.lot ? <span className="text-soft"> · lote {l.lot.code}</span> : null}
                    </span>
                    <span className="shrink-0 font-medium">
                      {fmtQty(l.quantity)} {l.product.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
