import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSection } from "@/lib/auth";
import { getProducts } from "@/lib/queries";
import { getEquivalencia } from "@/lib/equivalencias";
import { cambiarEstadoEquivalencia } from "@/lib/equivalencias-actions";
import { fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { EquivalenciaForm } from "@/components/equivalencia-form";

export const dynamic = "force-dynamic";

export default async function EquivalenciaDetalle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("wix");
  const { id } = await params;
  const { ok, error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [e, productos] = await Promise.all([getEquivalencia(id), getProducts()]);
  if (!e) notFound();

  // los productos ya elegidos se muestran aunque estén desactivados
  const elegidos = new Set(e.lines.map((l) => l.product.id));
  const opciones = productos
    .filter((p) => p.active || elegidos.has(p.id))
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.sku}${p.type === "KIT" ? " · kit" : ""}${p.active ? "" : " · desactivado"}` }));

  return (
    <div className="max-w-3xl">
      <Link href="/equivalencias" className="text-sm text-rose-deep hover:underline">
        ← Equivalencias Wix
      </Link>
      <PageTitle>
        <span className="break-all font-mono">{e.external_sku}</span>
      </PageTitle>
      <Flash ok={ok} error={error} />
      <p className="mb-3 text-sm text-soft">
        {e.label ?? "—"}
        {e.option_label ? ` · ${e.option_label}` : ""} · actualizada {fmtDateTime(e.updated_at)}
        {e.updated_by ? ` por ${e.updated_by}` : ""}
      </p>

      <Card>
        <EquivalenciaForm e={e} productos={opciones} />
      </Card>

      <Card className={`mt-4 ${e.active ? "" : "border-amber-300 bg-amber-50"}`}>
        <h2 className="mb-1 font-semibold">{e.active ? "Activa" : "Desactivada"}</h2>
        <p className="mb-3 text-sm text-soft">
          {e.active
            ? "Las ventas de Wix con este SKU descuentan del stock. Si ya no se vende o está mal, desactivala (no se borra)."
            : "Las ventas de Wix con este SKU no descuentan nada hasta que la actives."}
        </p>
        <form action={cambiarEstadoEquivalencia}>
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="activa" value={e.active ? "no" : "si"} />
          <SubmitButton className="rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-medium text-rose-deep hover:border-blush">
            {e.active ? "Desactivar" : "Activar"}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
