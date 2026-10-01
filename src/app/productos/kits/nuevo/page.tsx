import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { KitBuilder } from "@/components/kit-builder";
import { requireSection } from "@/lib/auth";
import { getProducts, getLocations } from "@/lib/queries";
import { randomUUID } from "crypto";
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
  const [todos, ubicaciones] = await Promise.all([getProducts(), getLocations()]);
  const productos = todos.filter((p) => p.active && p.type !== "KIT");

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

        <Card>
          <h3 className="mb-1 font-semibold">¿Ya tenés kits armados? (opcional)</h3>
          <p className="mb-3 text-sm text-soft">
            Se suman al stock del kit y se descuentan sus componentes de esa ubicación (primero los
            lotes que vencen antes).
          </p>
          <input type="hidden" name="idem" value={randomUUID()} />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={label}>Kits armados</label>
              <input type="number" name="armados" min="0" step="any" placeholder="0" className={`${input} w-32`} />
            </div>
            <div className="min-w-48">
              <label className={label}>Ubicación</label>
              <select name="ubicacion_armados" className={input}>
                <option value="">Elegir…</option>
                {ubicaciones.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className={button}>Crear kit</SubmitButton>
          <span className="text-sm text-soft">
            Las cantidades del contenido son por cada kit.
          </span>
        </div>
      </form>
    </div>
  );
}
