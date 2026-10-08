import { SubmitButton } from "@/components/submit-button";
import { LineasOrden, type LineaOrdenInicial } from "@/components/lineas-orden";
import { guardarOrden } from "@/lib/compras-actions";
import { ESTADOS_OC, type OrdenCompra } from "@/lib/compras";
import { input, label, button } from "@/components/ui";

// Formulario de alta/edición de una orden de compra (server component)
export function OrdenForm({
  orden,
  proveedores,
  productos,
}: {
  orden?: OrdenCompra;
  proveedores: { id: string; name: string; active: boolean }[];
  productos: { value: string; label: string }[];
}) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const inicial: LineaOrdenInicial[] | undefined = orden?.lines.map((l) => ({
    id: l.id,
    producto: l.product_id ?? "",
    descripcion: l.description,
    cantidad: l.quantity != null ? String(l.quantity) : "",
    unidad: l.unit ?? "u",
    tipo: l.kind ?? "",
    costo: l.unit_cost != null ? String(l.unit_cost) : "",
    recibido: Number(l.received_qty) || undefined,
  }));

  return (
    <form action={guardarOrden} className="space-y-4">
      {orden && <input type="hidden" name="orden" value={orden.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>Proveedor *</label>
          <select name="proveedor" required defaultValue={orden?.supplier.id ?? ""} className={input}>
            <option value="">Elegir…</option>
            {proveedores
              .filter((p) => p.active || p.id === orden?.supplier.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className={label}>Fecha de la orden *</label>
          <input type="date" name="fecha" required defaultValue={orden?.order_date ?? hoy} className={input} />
        </div>
        <div>
          <label className={label}>Entrega estimada</label>
          <input type="date" name="fecha_estimada" defaultValue={orden?.expected_date ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Estado</label>
          <select name="estado" defaultValue={orden?.status ?? "PENDIENTE"} className={input}>
            {Object.entries(ESTADOS_OC).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Pagado (%)</label>
          <input
            type="number"
            name="pagado"
            min="0"
            max="100"
            step="any"
            placeholder="ej. 60 si es seña"
            defaultValue={orden?.paid_pct ?? ""}
            className={input}
          />
        </div>
      </div>

      <div>
        <label className={label}>Ítems *</label>
        <LineasOrden productos={productos} inicial={inicial} />
      </div>

      <div>
        <label className={label}>Notas</label>
        <textarea name="notas" rows={2} defaultValue={orden?.notes ?? ""} className={input} />
      </div>

      <SubmitButton className={button}>{orden ? "Guardar cambios" : "Crear orden"}</SubmitButton>
    </form>
  );
}
