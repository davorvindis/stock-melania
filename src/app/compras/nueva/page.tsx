import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { getProducts, getSuppliers } from "@/lib/queries";
import { Card, Flash, PageTitle } from "@/components/ui";
import { OrdenForm } from "@/components/orden-form";

export const dynamic = "force-dynamic";

export default async function NuevaOrden({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("compras");
  const { ok, error } = await searchParams;
  const [proveedores, productos] = await Promise.all([getSuppliers(), getProducts()]);
  const opciones = productos
    .filter((p) => p.active && p.type !== "KIT")
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.sku}` }));

  return (
    <div className="max-w-3xl">
      <div className="mb-1 text-sm">
        <Link href="/compras" className="text-soft hover:text-rose-deep">
          ← Órdenes de compra
        </Link>
      </div>
      <PageTitle>Nueva orden de compra</PageTitle>
      <Flash ok={ok} error={error} />
      <Card>
        <OrdenForm proveedores={proveedores} productos={opciones} />
      </Card>
    </div>
  );
}
