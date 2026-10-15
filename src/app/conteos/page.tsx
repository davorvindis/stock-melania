import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { getCounts, getLocations } from "@/lib/queries";
import { abrirConteo } from "@/lib/actions";
import { fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

const ESTADOS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "Abierto", cls: "bg-blue-100 text-blue-800" },
  CLOSED: { label: "Cerrado — a revisar", cls: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Aprobado", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Rechazado", cls: "bg-stone-200 text-stone-700" },
  CANCELLED: { label: "Cerrado sin contar", cls: "bg-stone-200 text-stone-700" },
};

const TIPOS: [string, string][] = [
  ["TERMINADO", "Producto terminado"],
  ["MONODOSIS", "Monodosis"],
  ["KIT", "Kits"],
  ["PACKAGING", "Packaging"],
  ["ACCESORIO", "Accesorios"],
  ["GRANEL", "Granel"],
];
const nombreTipo = new Map(TIPOS);

export default async function Conteos({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("conteos");
  const { ok, error } = await searchParams;
  const [counts, locations] = await Promise.all([getCounts(), getLocations()]);

  return (
    <div className="max-w-3xl">
      <PageTitle>Conteos físicos</PageTitle>
      <Flash ok={ok} error={error} />

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold">Abrir conteo ciego</h2>
        <p className="mb-3 text-sm text-soft">
          Quien cuenta no ve el stock teórico. Las diferencias solo ajustan el stock si un
          responsable las aprueba.
        </p>
        <form action={abrirConteo} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Ubicación *</label>
            <select name="ubicacion" required className={input}>
              <option value="">Elegir…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className={label}>¿Qué tipos de producto vas a contar?</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {TIPOS.map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="tipos" value={v} className="h-4 w-4 accent-rose-deep" />
                  {l}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-soft">
              Si no marcás ninguno, entran todos. Igual podés cerrar el conteo aunque no cuentes todo: lo que no
              cargues queda “sin contar” y no se toca.
            </p>
          </fieldset>
          <div className="flex items-end sm:col-span-2">
            <SubmitButton className={`${button} w-full sm:w-auto`}>
              Abrir conteo
            </SubmitButton>
          </div>
        </form>
      </Card>

      <div className="space-y-2">
        {counts.map((c) => {
          const e = ESTADOS[c.status];
          return (
            <Link
              key={c.id}
              href={`/conteos/${c.id}`}
              className="block rounded-lg border border-blush-100 bg-white p-3 hover:border-blush"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.location.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.cls}`}>
                  {e.label}
                </span>
              </div>
              <div className="mt-1 text-xs text-soft">
                {c.product_types?.length ? `${c.product_types.map((t) => nombreTipo.get(t) ?? t).join(", ")} · ` : ""}
                Abierto por {c.opened_by} · {fmtDateTime(c.opened_at)}
                {c.reviewed_by ? ` · revisó ${c.reviewed_by}` : ""}
              </div>
            </Link>
          );
        })}
        {counts.length === 0 && (
          <Card>
            <p className="text-sm text-soft">Todavía no hay conteos. Abrí el primero arriba.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
