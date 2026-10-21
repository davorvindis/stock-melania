import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { getProducts } from "@/lib/queries";
import { esCombo, getEquivalencias } from "@/lib/equivalencias";
import { fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, th, td } from "@/components/ui";
import { EquivalenciaForm } from "@/components/equivalencia-form";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; q?: string; tipo?: string };

const TIPOS: Record<string, string> = { "": "Todas", simple: "Producto simple", combo: "Packs y combos", inactivas: "Desactivadas" };

export default async function EquivalenciasPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSection("wix");
  const sp = await searchParams;
  const [todas, productos] = await Promise.all([getEquivalencias(), getProducts()]);

  let lista = todas;
  if (sp.tipo === "simple") lista = lista.filter((e) => e.active && !esCombo(e));
  else if (sp.tipo === "combo") lista = lista.filter((e) => e.active && esCombo(e));
  else if (sp.tipo === "inactivas") lista = lista.filter((e) => !e.active);
  if (sp.q) {
    const t = sp.q.toLowerCase();
    lista = lista.filter(
      (e) =>
        e.external_sku.toLowerCase().includes(t) ||
        (e.label ?? "").toLowerCase().includes(t) ||
        (e.option_label ?? "").toLowerCase().includes(t) ||
        e.lines.some((l) => l.product.name.toLowerCase().includes(t) || l.product.sku.toLowerCase().includes(t))
    );
  }

  const opciones = productos
    .filter((p) => p.active)
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.sku}${p.type === "KIT" ? " · kit" : ""}` }));
  // productos vendibles que ninguna venta de Wix descuenta
  const usados = new Set(todas.filter((e) => e.active).flatMap((e) => e.lines.map((l) => l.product.id)));
  const sinWix = productos.filter(
    (p) => p.active && ["TERMINADO", "MONODOSIS", "KIT", "ACCESORIO"].includes(p.type) && !usados.has(p.id)
  );

  const descuenta = (e: (typeof todas)[number]) =>
    e.lines.map((l) => `${fmtQty(l.quantity)} × ${l.product.name}`).join(" + ");
  const filtroHref = (tipo: string) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (tipo) p.set("tipo", tipo);
    return p.toString() ? `/equivalencias?${p}` : "/equivalencias";
  };

  return (
    <div>
      <PageTitle>Equivalencias Wix</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />
      <p className="mb-4 max-w-3xl text-sm text-soft">
        Qué descuenta del stock cada venta de la tienda Wix, según el SKU del producto en Wix. Wix no acepta SKU repetidos,
        por eso las versiones mayoristas, promos y combos tienen su propio SKU (ej. <span className="font-mono">-MAY</span>,{" "}
        <span className="font-mono">-X10</span>, <span className="font-mono">COMBO-…</span>). Si creás un producto o combo
        nuevo en Wix, cargalo acá con el mismo SKU.
      </p>

      <details className="mb-4 rounded-xl border border-blush-100 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-rose-deep">+ Nueva equivalencia</summary>
        <div className="mt-4">
          <EquivalenciaForm productos={opciones} />
        </div>
      </details>

      <form method="get" className="mb-3 flex gap-2">
        {sp.tipo && <input type="hidden" name="tipo" value={sp.tipo} />}
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar SKU, producto de Wix o nuestro…" className={input} />
        <button type="submit" className="shrink-0 rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
          Buscar
        </button>
      </form>
      <div className="mb-3 flex flex-wrap gap-2">
        {Object.entries(TIPOS).map(([k, v]) => (
          <Link
            key={k}
            href={filtroHref(k)}
            className={`rounded-full px-3 py-1 text-sm ${
              (sp.tipo ?? "") === k ? "bg-rose-deep text-white" : "border border-line bg-white text-soft hover:text-ink"
            }`}
          >
            {v}
          </Link>
        ))}
      </div>
      <p className="mb-3 text-sm text-soft">
        {lista.length} de {todas.length} equivalencia(s)
      </p>

      {/* mobile: tarjetas */}
      <div className="space-y-2 md:hidden">
        {lista.map((e) => (
          <Link key={e.id} href={`/equivalencias/${e.id}`} className="block rounded-lg border border-blush-100 bg-white p-3 hover:border-blush">
            <div className="flex items-start justify-between gap-2">
              <span className="break-all font-mono text-sm font-semibold">{e.external_sku}</span>
              {!e.active && <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">Desactivada</span>}
            </div>
            <div className="mt-0.5 text-sm">
              {e.label ?? "—"}
              {e.option_label ? <span className="text-soft"> · {e.option_label}</span> : null}
            </div>
            <div className="mt-1 text-xs text-soft">Descuenta: {descuenta(e)}</div>
          </Link>
        ))}
      </div>

      {/* escritorio: tabla */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>SKU en Wix</th>
                <th className={th}>Producto en Wix</th>
                <th className={th}>Descuenta de Stock Melania</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className={`border-b border-blush-100 align-top ${e.active ? "" : "opacity-60"}`}>
                  <td className={`${td} font-mono text-xs`}>{e.external_sku}</td>
                  <td className={td}>
                    {e.label ?? "—"}
                    {e.option_label ? <span className="text-soft"> · {e.option_label}</span> : null}
                    {!e.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">Desactivada</span>}
                  </td>
                  <td className={td}>
                    <ul className="space-y-0.5">
                      {e.lines.map((l) => (
                        <li key={l.id}>
                          <b>{fmtQty(l.quantity)}</b> × {l.product.name}
                          {!l.product.active && <span className="ml-1 text-xs text-amber-700">(desactivado)</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={td}>
                    <Link href={`/equivalencias/${e.id}`} className="text-sm font-medium text-rose-deep hover:underline">
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {lista.length === 0 && (
        <Card>
          <p className="text-sm text-soft">Ninguna equivalencia coincide con la búsqueda.</p>
        </Card>
      )}

      {sinWix.length > 0 && (
        <details className="mt-6 rounded-xl border border-blush-100 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Productos nuestros que ninguna venta de Wix descuenta ({sinWix.length})
          </summary>
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {sinWix.map((p) => (
              <li key={p.id}>
                {p.name} <span className="font-mono text-xs text-soft">{p.sku}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
