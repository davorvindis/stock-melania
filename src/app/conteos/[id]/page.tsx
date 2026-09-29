import { getCountDetail } from "@/lib/queries";
import { guardarConteo, revisarConteo } from "@/lib/actions";
import { fmtQty, fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button, th, td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ConteoDetalle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error } = await searchParams;
  const { count, lines } = await getCountDetail(id);

  const diffs = lines.map((l) => ({ ...l, diff: (l.counted ?? 0) - l.expected }));
  const conDiferencia = diffs.filter((l) => l.diff !== 0);

  return (
    <div className="max-w-3xl">
      <PageTitle>Conteo — {count.location.name}</PageTitle>
      <Flash ok={ok} error={error} />

      <p className="mb-4 text-sm text-soft">
        Abierto por {count.opened_by} · {fmtDateTime(count.opened_at)}
        {count.closed_by ? ` · cerrado por ${count.closed_by}` : ""}
        {count.reviewed_by ? ` · revisado por ${count.reviewed_by}` : ""}
      </p>

      {count.status === "OPEN" && (
        <Card>
          <h2 className="mb-1 font-semibold">Cargar cantidades físicas</h2>
          <p className="mb-4 text-sm text-soft">
            Contá lo que hay físicamente. El sistema no te muestra cuánto “debería” haber.
          </p>
          <form action={guardarConteo} className="space-y-4">
            <input type="hidden" name="conteo" value={count.id} />
            <div className="max-w-xs">
              <label className={label}>Quién cuenta *</label>
              <input type="text" name="actor" placeholder="Tu nombre" required className={input} />
            </div>
            <div className="space-y-3">
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-blush-100 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{l.product.name}</div>
                    <div className="text-xs text-soft">
                      {l.lot ? `Lote ${l.lot.code} · ` : ""}
                      {l.product.unit}
                      {l.counted !== null ? " · ya contado" : ""}
                    </div>
                  </div>
                  <input
                    type="number"
                    name={`linea_${l.id}`}
                    min="0"
                    step="any"
                    defaultValue={l.counted ?? ""}
                    placeholder="Cant."
                    className="w-24 rounded-lg border border-line px-3 py-2.5 text-center text-lg font-semibold focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="submit" className={`${button} bg-ink hover:bg-stone-700`}>
                Guardar avance
              </button>
              <button type="submit" name="cerrar" value="1" className={button}>
                Cerrar conteo
              </button>
            </div>
            <p className="text-xs text-soft">
              Cerrar exige todas las líneas contadas y no permite modificaciones posteriores.
            </p>
          </form>
        </Card>
      )}

      {count.status !== "OPEN" && (
        <>
          <Card>
            <h2 className="mb-3 font-semibold">Teórico vs físico</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Producto</th>
                    <th className={th}>Lote</th>
                    <th className={th}>Teórico</th>
                    <th className={th}>Físico</th>
                    <th className={th}>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((l) => (
                    <tr key={l.id} className="border-b border-blush-100">
                      <td className={td}>{l.product.name}</td>
                      <td className={td}>{l.lot?.code ?? "—"}</td>
                      <td className={td}>{fmtQty(l.expected)}</td>
                      <td className={td}>{fmtQty(l.counted ?? 0)}</td>
                      <td
                        className={`${td} font-semibold ${
                          l.diff === 0 ? "text-emerald-700" : "text-red-700"
                        }`}
                      >
                        {l.diff > 0 ? "+" : ""}
                        {fmtQty(l.diff)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm">
              {conDiferencia.length === 0
                ? "Sin diferencias: el stock físico coincide con el teórico. ✓"
                : `${conDiferencia.length} línea(s) con diferencia.`}
            </p>
          </Card>

          {count.status === "CLOSED" && (
            <Card className="mt-4 border-amber-200">
              <h2 className="mb-1 font-semibold">Revisión</h2>
              <p className="mb-3 text-sm text-soft">
                Aprobar genera movimientos de ajuste trazables por cada diferencia. Rechazar no
                toca el stock.
              </p>
              <form action={revisarConteo} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="conteo" value={count.id} />
                <div>
                  <label className={label}>Quién revisa *</label>
                  <input type="text" name="actor" required className={input} placeholder="Tu nombre" />
                </div>
                <div>
                  <label className={label}>Motivo de la decisión *</label>
                  <input
                    type="text"
                    name="motivo"
                    required
                    className={input}
                    placeholder="ej. diferencias verificadas físicamente"
                  />
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <button type="submit" name="decision" value="aprobar" className={button}>
                    Aprobar y ajustar stock
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="rechazar"
                    className={`${button} bg-ink hover:bg-stone-700`}
                  >
                    Rechazar
                  </button>
                </div>
              </form>
            </Card>
          )}

          {count.review_reason && (
            <p className="mt-3 text-sm text-soft">
              Decisión: {count.status === "APPROVED" ? "aprobado" : "rechazado"} —{" "}
              {count.review_reason}
            </p>
          )}
        </>
      )}
    </div>
  );
}
