import Link from "next/link";
import { getLots } from "@/lib/queries";
import { LOT_STATUS_LABELS, fmtDate, lotBadgeClass } from "@/lib/types";
import { Card, Flash, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Lotes({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; q?: string }>;
}) {
  const { ok, error, q } = await searchParams;
  let lots = await getLots();
  if (q) {
    const needle = q.toLowerCase();
    lots = lots.filter(
      (l) =>
        l.code.toLowerCase().includes(needle) ||
        l.product.name.toLowerCase().includes(needle) ||
        l.product.sku.toLowerCase().includes(needle)
    );
  }

  return (
    <div className="max-w-3xl">
      <PageTitle>Lotes</PageTitle>
      <Flash ok={ok} error={error} />

      <form method="get" className="mb-4">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar por lote, producto o SKU…"
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
        />
      </form>

      <div className="space-y-2">
        {lots.map((l) => (
          <Link
            key={l.id}
            href={`/lotes/${l.id}`}
            className="block rounded-lg border border-blush-100 bg-white p-3 hover:border-blush"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {l.code} <span className="font-normal text-soft">· {l.product.name}</span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${lotBadgeClass(l.status)}`}
              >
                {LOT_STATUS_LABELS[l.status]}
              </span>
            </div>
            <div className="mt-1 text-xs text-soft">
              {l.product.sku}
              {l.expires_on ? ` · vence ${fmtDate(l.expires_on)}` : " · sin vencimiento"}
            </div>
          </Link>
        ))}
        {lots.length === 0 && (
          <Card>
            <p className="text-sm text-soft">
              {q ? "Ningún lote coincide con la búsqueda." : "Todavía no hay lotes registrados."}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
