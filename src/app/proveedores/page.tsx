import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { getSuppliers } from "@/lib/queries";
import { crearProveedor } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label, button, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Proveedores({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("proveedores");
  const { ok, error } = await searchParams;
  const suppliers = await getSuppliers();

  return (
    <div className="max-w-3xl">
      <PageTitle>Proveedores</PageTitle>
      <Flash ok={ok} error={error} />

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">Nuevo proveedor</h2>
        <form action={crearProveedor} className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={label}>Nombre *</label>
            <input type="text" name="nombre" required className={input} />
          </div>
          <div>
            <label className={label}>CUIT</label>
            <input type="text" name="cuit" className={input} />
          </div>
          <div>
            <label className={label}>Contacto</label>
            <input type="text" name="contacto" className={input} />
          </div>
          <div className="sm:col-span-4">
            <SubmitButton className={button}>
              Crear proveedor
            </SubmitButton>
          </div>
        </form>
      </Card>

      <div className="space-y-2 md:hidden">
        {suppliers.map((s) => (
          <div key={s.id} className="rounded-lg border border-blush-100 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              <span className="text-xs text-soft">{s.active ? "Activo" : "Inactivo"}</span>
            </div>
            {(s.cuit || s.contact) && (
              <div className="mt-1 text-xs text-soft">
                {[s.cuit, s.contact].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        ))}
      </div>

      <Card className="hidden md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Nombre</th>
              <th className={th}>CUIT</th>
              <th className={th}>Contacto</th>
              <th className={th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="border-b border-blush-100">
                <td className={td}>{s.name}</td>
                <td className={td}>{s.cuit ?? "—"}</td>
                <td className={td}>{s.contact ?? "—"}</td>
                <td className={td}>{s.active ? "Activo" : "Inactivo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
