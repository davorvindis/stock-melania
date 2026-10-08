import { SubmitButton } from "@/components/submit-button";
import { guardarCosto, eliminarCosto } from "@/lib/compras-actions";
import { COMPONENTES, type FilaCosto } from "@/lib/compras";

const campo =
  "w-full rounded-lg border border-line bg-white px-2.5 py-2 text-sm focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";
const etiqueta = "mb-1 block text-xs font-medium text-soft";

// Alta/edición de un ítem de costo en un mes. El costo total es la suma de los componentes.
export function CostoForm({
  periodo,
  fila,
  productos,
  proveedores,
}: {
  periodo: string;
  fila?: FilaCosto;
  productos: { id: string; name: string }[];
  proveedores: { id: string; name: string }[];
}) {
  return (
    <div className="space-y-3">
      <form action={guardarCosto} className="space-y-3">
        <input type="hidden" name="periodo" value={periodo} />
        {fila && <input type="hidden" name="costo" value={fila.id} />}
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className={etiqueta}>Ítem *</label>
            <input type="text" name="item" required defaultValue={fila?.item ?? ""} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Producto del sistema</label>
            <select name="producto" defaultValue={fila?.product_id ?? ""} className={campo}>
              <option value="">Sin vincular</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Proveedor</label>
            <select name="proveedor" defaultValue={fila?.supplier_id ?? ""} className={campo}>
              <option value="">—</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COMPONENTES.map(([k, l]) => (
            <div key={k}>
              <label className={etiqueta}>{l} ($)</label>
              <input
                type="number"
                name={k}
                min="0"
                step="0.01"
                defaultValue={fila?.[k] ?? ""}
                className={campo}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className={etiqueta}>Precio de venta minorista ($)</label>
            <input type="number" name="precio" min="0" step="0.01" defaultValue={fila?.sale_price ?? ""} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Cotización (fecha o mes)</label>
            <input type="text" name="cotizacion" defaultValue={fila?.quote_note ?? ""} placeholder="ej. 10/2026" className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Notas</label>
            <input type="text" name="notas" defaultValue={fila?.notes ?? ""} placeholder="ej. subió el envase" className={campo} />
          </div>
        </div>
        <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
          {fila ? "Guardar" : "Agregar ítem"}
        </SubmitButton>
      </form>
      {fila && (
        <form action={eliminarCosto}>
          <input type="hidden" name="costo" value={fila.id} />
          <input type="hidden" name="periodo" value={periodo} />
          <SubmitButton className="text-xs font-medium text-red-700 hover:underline">
            Quitar este ítem de este mes
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
