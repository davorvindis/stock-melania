import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { importarProductos } from "@/lib/actions";
import { Card, Flash, PageTitle, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ImportarProductos({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("productos");
  const { ok, error } = await searchParams;

  return (
    <div className="max-w-2xl">
      <PageTitle>Importar productos desde Excel</PageTitle>
      <Flash ok={ok} error={error} />

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold">1. Descargá la plantilla</h2>
        <p className="mb-3 text-sm text-soft">
          Completala en Excel o Google Sheets. La hoja &ldquo;Instrucciones&rdquo; explica los
          valores válidos.
        </p>
        <a
          href="/api/productos/plantilla"
          className="inline-block rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
        >
          Descargar plantilla .xlsx
        </a>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">2. Subí el archivo completado</h2>
        <p className="mb-3 text-sm text-soft">
          Se valida todo antes de importar: si hay errores, no se carga nada y te decimos qué
          corregir. Los SKU que ya existen se saltean, nunca se pisan.
        </p>
        <form action={importarProductos} className="space-y-4">
          <div>
            <label className={label}>Archivo Excel *</label>
            <input
              type="file"
              name="archivo"
              accept=".xlsx"
              required
              className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blush-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-rose-deeper"
            />
          </div>
          <SubmitButton className={button}>
            Importar productos
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
