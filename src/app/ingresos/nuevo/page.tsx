import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { randomUUID } from "crypto";
import { getProducts, getLocations, getSuppliers } from "@/lib/queries";
import { registrarIngreso } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NuevoIngreso({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("ingresos");
  const { ok, error } = await searchParams;
  const [products, locations, suppliers] = await Promise.all([
    getProducts(),
    getLocations(),
    getSuppliers(),
  ]);
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-2xl">
      <PageTitle>Nuevo ingreso de stock</PageTitle>
      <Flash ok={ok} error={error} />
      <Card>
        <form action={registrarIngreso} className="space-y-4">
          <input type="hidden" name="idem" value={randomUUID()} />

          <div>
            <label className={label}>Fecha de ingreso *</label>
            <input type="date" name="fecha" defaultValue={hoy} required className={input} />
          </div>

          <div>
            <label className={label}>Producto *</label>
            <select name="producto" required className={input}>
              <option value="">Elegir producto…</option>
              {products
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name} ({p.unit})
                  </option>
                ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Cantidad *</label>
              <input type="number" name="cantidad" min="0.001" step="any" required className={input} />
            </div>
            <div>
              <label className={label}>Lote</label>
              <input type="text" name="lote" placeholder="ej. L-2026-02" className={input} />
            </div>
            <div>
              <label className={label}>Vencimiento</label>
              <input type="date" name="vencimiento" className={input} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Costo total ($)</label>
              <input type="number" name="costo_total" min="0" step="0.01" className={input} />
              <p className="mt-1 text-xs text-soft">Si lo cargás, el unitario se calcula solo.</p>
            </div>
            <div>
              <label className={label}>Costo unitario ($)</label>
              <input type="number" name="costo_unitario" min="0" step="0.01" className={input} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>N° remito</label>
              <input type="text" name="remito" className={input} />
            </div>
            <div>
              <label className={label}>N° factura</label>
              <input type="text" name="factura" className={input} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Proveedor</label>
              <select name="proveedor" className={input}>
                <option value="">Sin proveedor</option>
                {suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className={label}>Ubicación destino *</label>
              <select name="ubicacion" required className={input}>
                <option value="">Elegir ubicación…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>Observaciones</label>
            <textarea name="notas" rows={2} className={input} />
          </div>

          <SubmitButton className={`${button} w-full sm:w-auto`}>
            Confirmar ingreso
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
