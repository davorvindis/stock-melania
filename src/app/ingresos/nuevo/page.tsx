import { SubmitButton } from "@/components/submit-button";
import { requireSection, ubicacionFija } from "@/lib/auth";
import { randomUUID } from "crypto";
import { getProducts, getLocations, getSuppliers } from "@/lib/queries";
import { registrarIngreso } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";
import { LineasIngreso } from "@/components/lineas-ingreso";

export const dynamic = "force-dynamic";

export default async function NuevoIngreso({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireSection("ingresos");
  const { ok, error } = await searchParams;
  const [products, locations, suppliers] = await Promise.all([
    getProducts(),
    getLocations(),
    getSuppliers(),
  ]);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const opcionesProductos = products
    .filter((p) => p.active && p.type !== "KIT")
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.sku} · ${p.unit}` }));

  return (
    <div className="max-w-3xl">
      <PageTitle>Nuevo ingreso de stock</PageTitle>
      <Flash ok={ok} error={error} />
      <Card>
        <form action={registrarIngreso} className="space-y-4">
          <input type="hidden" name="idem" value={randomUUID()} />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Fecha de ingreso *</label>
              <input type="date" name="fecha" defaultValue={hoy} required className={input} />
            </div>

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
              <select name="ubicacion" required defaultValue={user.location_id ?? ""} className={input}>
                <option value="">Elegir ubicación…</option>
                {locations
                  .filter((l) => !ubicacionFija(user) || l.id === ubicacionFija(user))
                  .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>Productos *</label>
            <LineasIngreso productos={opcionesProductos} />
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
