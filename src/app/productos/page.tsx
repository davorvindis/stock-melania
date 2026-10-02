import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { getProducts, getLocations } from "@/lib/queries";
import { randomUUID } from "crypto";
import { crearProducto } from "@/lib/actions";
import { fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, SortTh, cmp, input, label, button, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

const TIPOS = [
  ["TERMINADO", "Producto terminado"],
  ["MONODOSIS", "Monodosis"],
  ["INSUMO", "Insumo"],
  ["PACKAGING", "Packaging"],
  ["GRANEL", "Granel / materia prima"],
  ["ACCESORIO", "Accesorio"],
  ["KIT", "Kit (combo: descuenta sus componentes)"],
] as const;

type SP = {
  ok?: string;
  error?: string;
  q?: string;
  tipo?: string;
  categoria?: string;
  estado?: string;
  sort?: string;
  dir?: string;
};

export default async function Productos({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireSection("productos");
  const sp = await searchParams;
  const { ok, error } = sp;
  const [todos, ubicaciones] = await Promise.all([getProducts(), getLocations()]);
  const categorias = [...new Set(todos.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b, "es")
  );

  let products = todos;
  if (sp.q) {
    const needle = sp.q.toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.sku.toLowerCase().includes(needle) ||
        (p.category ?? "").toLowerCase().includes(needle)
    );
  }
  if (sp.tipo) products = products.filter((p) => p.type === sp.tipo);
  if (sp.categoria) products = products.filter((p) => p.category === sp.categoria);
  if (sp.estado === "activo") products = products.filter((p) => p.active);
  if (sp.estado === "inactivo") products = products.filter((p) => !p.active);

  const key = (p: (typeof todos)[number], col: string): string | number => {
    switch (col) {
      case "sku":
        return p.sku;
      case "nombre":
        return p.name;
      case "tipo":
        return TIPOS.find(([v]) => v === p.type)?.[1] ?? p.type;
      case "unidad":
        return p.unit;
      case "minimo":
        return Number(p.min_stock);
      case "estado":
        return p.active ? 0 : 1;
      default:
        return 0;
    }
  };
  if (sp.sort) products = [...products].sort((a, b) => cmp(key(a, sp.sort!), key(b, sp.sort!), sp.dir));
  const hayFiltros = !!(sp.q || sp.tipo || sp.categoria || sp.estado);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Productos</PageTitle>
        <div className="flex flex-wrap gap-2">
        <Link
          href="/productos/kits/nuevo"
          className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
        >
          🎁 Armar kit
        </Link>
        <Link
          href="/productos/importar"
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
        >
          Importar desde Excel
        </Link>
        </div>
      </div>
      <Flash ok={ok} error={error} />

      <Card className="mb-4">
        <details open={!!error}>
        <summary className="cursor-pointer font-semibold text-rose-deep">+ Nuevo producto</summary>
        <form action={crearProducto} className="mt-3 grid gap-3 sm:grid-cols-6">
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
          <details className="rounded-lg border border-blush-100 bg-blush-50/60 p-3 sm:col-span-6">
            <summary className="cursor-pointer text-sm font-medium text-rose-deep">
              + Cargar stock inicial (opcional)
            </summary>
            <input type="hidden" name="idem" value={randomUUID()} />
            <p className="mt-2 text-xs text-soft">
              Las unidades que ya tenés quedan registradas como ingreso. No aplica a kits: esos se
              arman desde &ldquo;Armar kit&rdquo;.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div>
                <label className={label}>Cantidad</label>
                <input type="number" name="cantidad_inicial" min="0" step="any" placeholder="0" className={input} />
              </div>
              <div>
                <label className={label}>Ubicación</label>
                <select name="ubicacion_inicial" className={input}>
                  <option value="">Elegir…</option>
                  {ubicaciones.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>N° de lote</label>
                <input type="text" name="lote_inicial" className={input} />
              </div>
              <div>
                <label className={label}>Vencimiento</label>
                <input type="date" name="vencimiento_inicial" className={input} />
              </div>
            </div>
          </details>
          <div className="sm:col-span-6">
            <SubmitButton className={button}>
              Crear producto
            </SubmitButton>
          </div>
        </form>
        </details>
      </Card>

      <form method="get" className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
        {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar por nombre, SKU o categoría…"
          className={`${input} sm:col-span-2`}
        />
        <select name="tipo" defaultValue={sp.tipo ?? ""} aria-label="Tipo" className={input}>
          <option value="">Todos los tipos</option>
          {TIPOS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select name="categoria" defaultValue={sp.categoria ?? ""} aria-label="Categoría" className={input}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado" className={input}>
          <option value="">Activos e inactivos</option>
          <option value="activo">Solo activos</option>
          <option value="inactivo">Solo inactivos</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper"
        >
          Filtrar
        </button>
      </form>
      <p className="mb-3 text-sm text-soft">
        {products.length} de {todos.length} producto(s)
        {hayFiltros && (
          <>
            {" · "}
            <Link href="/productos" className="font-medium text-rose-deep hover:underline">
              Limpiar filtros
            </Link>
          </>
        )}
      </p>

      <div className="space-y-2 md:hidden">
        {products.length === 0 && (
          <Card>
            <p className="text-sm text-soft">Ningún producto coincide con la búsqueda o filtros.</p>
          </Card>
        )}
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
                <SortTh col="sku" sp={sp} path="/productos">SKU</SortTh>
                <SortTh col="nombre" sp={sp} path="/productos">Nombre</SortTh>
                <SortTh col="tipo" sp={sp} path="/productos">Tipo</SortTh>
                <SortTh col="unidad" sp={sp} path="/productos">Unidad</SortTh>
                <SortTh col="minimo" sp={sp} path="/productos">Stock mínimo</SortTh>
                <SortTh col="estado" sp={sp} path="/productos">Estado</SortTh>
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
              {products.length === 0 && (
                <tr>
                  <td className={td} colSpan={7}>
                    Ningún producto coincide con la búsqueda o filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
