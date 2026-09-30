import { requireSection } from "@/lib/auth";
import { db } from "@/lib/db";
import { crearUbicacion, editarUbicacion, eliminarUbicacion } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function Ubicaciones({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("ubicaciones");
  const { ok, error } = await searchParams;
  const { data } = await db().from("locations").select("*").order("name");
  const ubicaciones = data ?? [];

  return (
    <div className="max-w-2xl">
      <PageTitle>Ubicaciones</PageTitle>
      <Flash ok={ok} error={error} />
      <p className="mb-4 text-sm text-soft">
        Depósitos, locales y también laboratorios/proveedores donde haya mercadería tuya: lo que
        se envía a un proveedor no desaparece, cambia de ubicación.
      </p>

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">Nueva ubicación</h2>
        <form action={crearUbicacion} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className={label}>Nombre *</label>
            <input type="text" name="nombre" required placeholder="ej. Lab Victoria" className={input} />
          </div>
          <label className="flex items-center gap-2 pb-2.5 text-sm">
            <input type="checkbox" name="es_cuarentena" className="h-4 w-4 accent-rose-deep" />
            Es cuarentena
          </label>
          <SubmitButton className="rounded-lg bg-rose-deep px-5 py-2.5 font-semibold text-white hover:bg-rose-deeper">
            Crear
          </SubmitButton>
        </form>
      </Card>

      <div className="space-y-3">
        {ubicaciones.map((u) => (
          <Card key={u.id} className={u.active ? "" : "opacity-60"}>
            <form action={editarUbicacion} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="ubicacion" value={u.id} />
              <div className="min-w-40 flex-1">
                <label className={label}>Nombre</label>
                <input type="text" name="nombre" defaultValue={u.name} required className={input} />
              </div>
              <label className="flex items-center gap-2 pb-2.5 text-sm">
                <input
                  type="checkbox"
                  name="es_cuarentena"
                  defaultChecked={u.is_quarantine}
                  className="h-4 w-4 accent-rose-deep"
                />
                Cuarentena
              </label>
              <label className="flex items-center gap-2 pb-2.5 text-sm">
                <input type="checkbox" name="activo" defaultChecked={u.active} className="h-4 w-4 accent-rose-deep" />
                Activa
              </label>
              <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
                Guardar
              </SubmitButton>
              <SubmitButton
                formAction={eliminarUbicacion}
                className="rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Eliminar
              </SubmitButton>
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
