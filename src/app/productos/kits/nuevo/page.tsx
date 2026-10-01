import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { KitBuilder } from "@/components/kit-builder";
import { requireSection } from "@/lib/auth";
import { getProducts } from "@/lib/queries";
import { crearKit } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NuevoKit({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("productos");
  const { ok, error } = await searchParams;
  const productos = (await getProducts()).filter((p) => p.active && p.type !== "KIT");

  return (
    <div className="max-w-5xl">
      <div className="mb-1 text-sm">
        <Link href="/productos" className="text-soft hover:text-rose-deep">
          ← Productos
        </Link>
      </div>
      <PageTitle>Armar kit nuevo</PageTitle>
      <Flash ok={ok} error={error} />

      <form action={crearKit} className="space-y-4">
        <Card>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label className={label}>SKU *</label>
              <input type="text" name="sku" required placeholder="KIT-…" className={input} />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>Nombre del kit *</label>
              <input type="text" name="nombre" required placeholder="Ej: Kit alisado completo" className={input} />
            </div>
            <div>
              <label className={label}>Stock mínimo</label>
              <input type="number" name="stock_minimo" min="0" step="any" defaultValue="0" className={input} />
            </div>
            <div className="sm:col-span-6">
              <label className={label}>Descripción</label>
              <input type="text" name="descripcion" className={input} />
            </div>
          </div>
        </Card>

        <KitBuilder productos={productos} />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className={button}>Crear kit</SubmitButton>
          <span className="text-sm text-soft">
            Las cantidades son por cada kit. Después lo armás físicamente desde la ficha del kit.
          </span>
        </div>
      </form>
    </div>
  );
}
