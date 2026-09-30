import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { db } from "@/lib/db";
import { editarProducto, eliminarProducto, agregarComponenteKit, quitarComponenteKit } from "@/lib/actions";
import { getKitComponents, getProducts } from "@/lib/queries";
import { fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";

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

export default async function EditarProducto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("productos");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const { data: p } = await db().from("products").select("*").eq("id", id).maybeSingle();
  const esKit = p?.type === "KIT";
  const [componentes, todosProductos] = esKit
    ? await Promise.all([getKitComponents(id), getProducts()])
    : [[], []];
  if (!p) {
    return (
      <div>
        <PageTitle>Producto inexistente</PageTitle>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageTitle>Editar {p.sku}</PageTitle>
      <Flash ok={ok} error={error} />
      <Card>
        <form action={editarProducto} className="space-y-4">
          <input type="hidden" name="producto" value={p.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>SKU *</label>
              <input type="text" name="sku" defaultValue={p.sku} required className={input} />
              <p className="mt-1 text-xs text-soft">
                Cambiarlo renombra el producto en todo el historial.
              </p>
            </div>
            <div>
              <label className={label}>Nombre *</label>
              <input type="text" name="nombre" defaultValue={p.name} required className={input} />
            </div>
          </div>

          <div>
            <label className={label}>Descripción</label>
            <textarea name="descripcion" rows={2} defaultValue={p.description ?? ""} className={input} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Categoría</label>
              <input type="text" name="categoria" defaultValue={p.category ?? ""} className={input} />
            </div>
            <div>
              <label className={label}>Tipo *</label>
              <select name="tipo" defaultValue={p.type} required className={input}>
                {TIPOS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Unidad de medida *</label>
              <input type="text" name="unidad" defaultValue={p.unit} required className={input} />
            </div>
            <div>
              <label className={label}>Stock mínimo</label>
              <input
                type="number"
                name="stock_minimo"
                min="0"
                step="any"
                defaultValue={Number(p.min_stock)}
                className={input}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="maneja_lote" defaultChecked={p.tracks_lot} className="h-4 w-4 accent-rose-deep" />
              Maneja lote
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="maneja_vencimiento" defaultChecked={p.tracks_expiry} className="h-4 w-4 accent-rose-deep" />
              Maneja vencimiento
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="activo" defaultChecked={p.active} className="h-4 w-4 accent-rose-deep" />
              Activo
            </label>
          </div>
          <p className="text-xs text-soft">
            Los productos con historial no se borran: se desactivan y dejan de aparecer para operar.
          </p>

          <SubmitButton className={button}>
            Guardar cambios
          </SubmitButton>
        </form>
      </Card>

      {esKit && (
        <Card className="mt-4">
          <h2 className="mb-1 font-semibold">Componentes del kit</h2>
          <p className="mb-3 text-sm text-soft">
            Al mover o vender este kit se descuentan estos productos automáticamente (cantidad por
            cada kit). Los kits no tienen stock propio.
          </p>
          <div className="mb-4 space-y-2">
            {componentes.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-blush-100 p-3">
                <span className="text-sm">
                  <span className="font-medium">{fmtQty(c.quantity)}×</span> {c.component.name}{" "}
                  <span className="text-soft">({c.component.sku})</span>
                </span>
                <form action={quitarComponenteKit}>
                  <input type="hidden" name="componente_id" value={c.id} />
                  <input type="hidden" name="kit" value={p.id} />
                  <SubmitButton className="rounded-lg border border-line px-3 py-1.5 text-xs text-red-700 hover:bg-red-50">
                    Quitar
                  </SubmitButton>
                </form>
              </div>
            ))}
            {componentes.length === 0 && (
              <p className="text-sm font-medium text-amber-700">
                ⚠ Este kit no tiene componentes: no se va a poder mover hasta que agregues al menos uno.
              </p>
            )}
          </div>
          <form action={agregarComponenteKit} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="kit" value={p.id} />
            <div className="min-w-48 flex-1">
              <label className={label}>Producto</label>
              <select name="componente" required className={input}>
                <option value="">Elegir…</option>
                {todosProductos
                  .filter((x) => x.active && x.type !== "KIT" && x.id !== p.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.sku} — {x.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className={label}>Cant. por kit</label>
              <input type="number" name="cantidad" min="0.001" step="any" required className={`${input} w-28`} />
            </div>
            <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
              Agregar
            </SubmitButton>
          </form>
        </Card>
      )}

      <Card className="mt-4 border-red-200">
        <details>
          <summary className="cursor-pointer font-semibold text-red-800">Eliminar producto</summary>
          <p className="mb-3 mt-2 text-sm text-soft">
            Solo se puede eliminar un producto que nunca tuvo movimientos ni ingresos. Si tiene
            historial, desactivalo (destildá &ldquo;Activo&rdquo; arriba): deja de aparecer para
            operar pero su historia se conserva.
          </p>
          <form action={eliminarProducto}>
            <input type="hidden" name="producto" value={p.id} />
            <SubmitButton className="rounded-lg bg-red-700 px-6 py-3 text-base font-semibold text-white hover:bg-red-800">
              Eliminar definitivamente
            </SubmitButton>
          </form>
        </details>
      </Card>
    </div>
  );
}
