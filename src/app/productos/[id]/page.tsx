import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { db } from "@/lib/db";
import { editarProducto } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

const TIPOS = [
  ["TERMINADO", "Producto terminado"],
  ["MONODOSIS", "Monodosis"],
  ["INSUMO", "Insumo"],
  ["PACKAGING", "Packaging"],
  ["GRANEL", "Granel / materia prima"],
  ["ACCESORIO", "Accesorio"],
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
    </div>
  );
}
