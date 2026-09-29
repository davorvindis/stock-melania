import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { getProducts } from "@/lib/queries";
import { crearProducto } from "@/lib/actions";
import { fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

const TIPOS = [
  ["TERMINADO", "Producto terminado"],
  ["MONODOSIS", "Monodosis"],
  ["INSUMO", "Insumo"],
  ["PACKAGING", "Packaging"],
  ["GRANEL", "Granel / materia prima"],
  ["ACCESORIO", "Accesorio"],
] as const;

export default async function Productos({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("productos");
  const { ok, error } = await searchParams;
  const products = await getProducts();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Productos</PageTitle>
        <Link
          href="/productos/importar"
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
        >
          Importar desde Excel
        </Link>
      </div>
      <Flash ok={ok} error={error} />

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">Nuevo producto</h2>
        <form action={crearProducto} className="grid gap-3 sm:grid-cols-6">
          <div>
            <label className={label}>SKU *</label>
            <input type="text" name="sku" required placeholder="MEL-…" className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Nombre *</label>
            <input type="text" name="nombre" required className={input} />
          </div>
          <div>
            <label className={label}>Tipo *</label>
            <select name="tipo" required className={input}>
              {TIPOS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Unidad *</label>
            <input type="text" name="unidad" defaultValue="unidad" required className={input} />
          </div>
          <div>
            <label className={label}>Stock mínimo</label>
            <input type="number" name="stock_minimo" min="0" step="any" defaultValue="0" className={input} />
          </div>
          <div className="sm:col-span-6">
            <SubmitButton className={button}>
              Crear producto
            </SubmitButton>
          </div>
        </form>
      </Card>

      <div className="space-y-2 md:hidden">
        {products.map((p) => (
          <Link key={p.id} href={`/productos/${p.id}`} className="block rounded-lg border border-blush-100 bg-white p-3 hover:border-blush">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-xs text-soft">{p.active ? "Activo" : "Inactivo"}</span>
            </div>
            <div className="mt-0.5 font-mono text-xs text-soft">{p.sku}</div>
            <div className="mt-1 text-xs text-soft">
              {TIPOS.find(([v]) => v === p.type)?.[1] ?? p.type} · {p.unit} · mínimo{" "}
              {fmtQty(p.min_stock)} · tocá para editar
            </div>
          </Link>
        ))}
      </div>

      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>SKU</th>
                <th className={th}>Nombre</th>
                <th className={th}>Tipo</th>
                <th className={th}>Unidad</th>
                <th className={th}>Stock mínimo</th>
                <th className={th}>Estado</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-blush-100">
                  <td className={`${td} font-mono text-xs`}>{p.sku}</td>
                  <td className={td}>{p.name}</td>
                  <td className={td}>{TIPOS.find(([v]) => v === p.type)?.[1] ?? p.type}</td>
                  <td className={td}>{p.unit}</td>
                  <td className={td}>{fmtQty(p.min_stock)}</td>
                  <td className={td}>{p.active ? "Activo" : "Inactivo"}</td>
                  <td className={td}>
                    <Link href={`/productos/${p.id}`} className="text-xs font-medium text-rose-deep hover:underline">
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
