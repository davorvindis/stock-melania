import { requireSection } from "@/lib/auth";
import { db } from "@/lib/db";
import { editarProveedor, eliminarProveedor } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function EditarProveedor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("proveedores");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const { data: s } = await db().from("suppliers").select("*").eq("id", id).maybeSingle();
  if (!s) {
    return (
      <div>
        <PageTitle>Proveedor inexistente</PageTitle>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageTitle>Editar {s.name}</PageTitle>
      <Flash ok={ok} error={error} />
      <Card>
        <form action={editarProveedor} className="space-y-4">
          <input type="hidden" name="proveedor" value={s.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Nombre *</label>
              <input type="text" name="nombre" defaultValue={s.name} required className={input} />
            </div>
            <div>
              <label className={label}>Razón social</label>
              <input type="text" name="razon_social" defaultValue={s.legal_name ?? ""} className={input} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>CUIT</label>
              <input type="text" name="cuit" defaultValue={s.cuit ?? ""} className={input} />
            </div>
            <div>
              <label className={label}>Contacto</label>
              <input type="text" name="contacto" defaultValue={s.contact ?? ""} className={input} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Email</label>
              <input type="email" name="email" defaultValue={s.email ?? ""} className={input} />
            </div>
            <div>
              <label className={label}>Teléfono</label>
              <input type="tel" name="telefono" defaultValue={s.phone ?? ""} className={input} />
            </div>
          </div>
          <div>
            <label className={label}>Notas</label>
            <textarea name="notas" rows={2} defaultValue={s.notes ?? ""} className={input} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="activo" defaultChecked={s.active} className="h-4 w-4 accent-rose-deep" />
            Activo
          </label>
          <SubmitButton className={button}>Guardar cambios</SubmitButton>
        </form>
      </Card>

      <Card className="mt-4 border-red-200">
        <details>
          <summary className="cursor-pointer font-semibold text-red-800">Eliminar proveedor</summary>
          <p className="mb-3 mt-2 text-sm text-soft">
            Solo se puede eliminar si nunca tuvo ingresos asociados. Con historial, desactivalo.
          </p>
          <form action={eliminarProveedor}>
            <input type="hidden" name="proveedor" value={s.id} />
            <SubmitButton className="rounded-lg bg-red-700 px-6 py-3 text-base font-semibold text-white hover:bg-red-800">
              Eliminar definitivamente
            </SubmitButton>
          </form>
        </details>
      </Card>
    </div>
  );
}
