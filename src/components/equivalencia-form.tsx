import { guardarEquivalencia } from "@/lib/equivalencias-actions";
import type { Equivalencia } from "@/lib/equivalencias";
import { LineasEquivalencia } from "@/components/lineas-equivalencia";
import { SubmitButton } from "@/components/submit-button";
import type { OpcionBuscador } from "@/components/buscador-producto";
import { input, label, button } from "@/components/ui";

// alta/edición de una equivalencia: SKU de Wix → productos y cantidades
export function EquivalenciaForm({ e, productos }: { e?: Equivalencia; productos: OpcionBuscador[] }) {
  return (
    <form action={guardarEquivalencia} className="space-y-4">
      {e && <input type="hidden" name="id" value={e.id} />}
      {e && <input type="hidden" name="activa" value={e.active ? "si" : "no"} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label}>SKU en Wix *</label>
          <input
            type="text"
            name="sku"
            required
            maxLength={40}
            defaultValue={e?.external_sku ?? ""}
            placeholder="ej. MEL-MOUSS-60ML-MAY"
            className={`${input} font-mono`}
          />
          <p className="mt-1 text-xs text-soft">Tiene que ser idéntico al SKU cargado en el producto o variante de Wix.</p>
        </div>
        <div>
          <label className={label}>Producto en Wix</label>
          <input type="text" name="nombre" defaultValue={e?.label ?? ""} placeholder="ej. MAYORISTA PRO MOUSSE 60ML" className={input} />
        </div>
        <div>
          <label className={label}>Variante en Wix</label>
          <input type="text" name="opcion" defaultValue={e?.option_label ?? ""} placeholder="ej. Talle M (si tiene)" className={input} />
        </div>
        <div>
          <label className={label}>Notas</label>
          <input type="text" name="notas" defaultValue={e?.notes ?? ""} className={input} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="publicar" value="si" defaultChecked={e ? e.publish_stock : true} className="mt-1 h-4 w-4 accent-rose-deep" />
        <span>
          <b>Publicar stock en Wix</b>
          <span className="block text-xs text-soft">
            Destildalo en los productos MAYORISTA u ocultos que se usan solo como referencia interna: no se les manda stock.
          </span>
        </span>
      </label>
      <div>
        <label className={label}>Por cada unidad vendida en Wix, descuenta *</label>
        <LineasEquivalencia
          productos={productos}
          inicial={e?.lines.map((l) => ({ producto: l.product.id, cantidad: Number(l.quantity) }))}
        />
        <p className="mt-1 text-xs text-soft">
          Producto simple: 1 producto × 1. Pack: 1 producto × la cantidad (ej. 10). Combo: varios productos.
        </p>
      </div>
      <SubmitButton className={`${button} w-full sm:w-auto`}>{e ? "Guardar cambios" : "Crear equivalencia"}</SubmitButton>
    </form>
  );
}
