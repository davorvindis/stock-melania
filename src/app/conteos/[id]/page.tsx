import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { getCountDetail } from "@/lib/queries";
import { guardarConteo, revisarConteo } from "@/lib/actions";
import { fmtDate, fmtQty, fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button, th, td } from "@/components/ui";
import { BuscadorConteo } from "@/components/buscador-conteo";

export const dynamic = "force-dynamic";

const TIPO_LABEL: Record<string, string> = {
  TERMINADO: "Terminado",
  MONODOSIS: "Monodosis",
  KIT: "Kit",
  PACKAGING: "Packaging",
  ACCESORIO: "Accesorio",
  GRANEL: "Granel",
};

export default async function ConteoDetalle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; tipo?: string }>;
}) {
  const user = await requireSection("conteos");
  const { id } = await params;
  const { ok, error, tipo } = await searchParams;
  const { count, lines, ultimoConteo } = await getCountDetail(id);

  // solo lo contado se compara (y se ajusta); lo que quedó vacío es "sin contar"
  const contadas = lines.filter((l) => l.counted !== null);
  const sinContar = lines.filter((l) => l.counted === null);
  const diffs = contadas.map((l) => ({ ...l, diff: Number(l.counted) - Number(l.expected) }));
  const conDiferencia = diffs.filter((l) => l.diff !== 0);
  const tiposPresentes = [...new Set(lines.map((l) => l.product.type))];

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
          <p className="mb-2 text-right text-sm">
            Contados <b>{contadas.length}</b> de {lines.length}
          </p>
          <form action={guardarConteo} className="space-y-4">
            <input type="hidden" name="conteo" value={count.id} />
            <BuscadorConteo
              contenedorId="lineas-conteo"
              lineas={lines.map((l) => ({
                id: l.id,
                tipo: l.product.type,
                buscar: `${l.product.name} ${l.product.sku} ${l.lot?.code ?? ""}`,
              }))}
              inicialTipo={tipo && tiposPresentes.includes(tipo) ? tipo : ""}
              tipos={tiposPresentes.map((t) => ({
                value: t,
                label: TIPO_LABEL[t] ?? t,
                cantidad: lines.filter((l) => l.product.type === t).length,
              }))}
            />
            <div id="lineas-conteo" className="space-y-3">
              {lines.map((l) => (
                <div
                  key={l.id}
                  data-linea={l.id}
                  hidden={!!tipo && tiposPresentes.includes(tipo) && l.product.type !== tipo}
                  className="flex items-center justify-between gap-3 rounded-lg border border-blush-100 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{l.product.name}</div>
                    <div className="text-xs text-soft">
                      {TIPO_LABEL[l.product.type] ?? l.product.type} · {l.lot ? `Lote ${l.lot.code} · ` : ""}
                      {l.product.unit}
                      {l.counted !== null ? " · ya contado" : ""}
                    </div>
                    <div className="text-[11px] text-soft">
                      {ultimoConteo.get(l.product.id)
                        ? `Último conteo: ${fmtDate(ultimoConteo.get(l.product.id)!)}`
                        : "Nunca contado acá"}
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
            <div>
              <label className={label}>Motivo del cierre {contadas.length === 0 ? "*" : "(opcional)"}</label>
              <input
                type="text"
                name="motivo_cierre"
                placeholder="ej. prueba, no llegué con el tiempo, solo conté la línea Melania"
                className={input}
              />
              <p className="mt-1 text-xs text-soft">
                Solo se usa al cerrar. Si no contaste nada es obligatorio y el conteo queda “Cerrado sin contar”.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <SubmitButton className={`${button} bg-ink hover:bg-stone-700`}>
                Guardar avance
              </SubmitButton>
              <SubmitButton name="cerrar" value="1" className={button}>
                Cerrar conteo
              </SubmitButton>
            </div>
            <p className="text-xs text-soft">
              Podés cerrar aunque no hayas contado todo: lo que quede vacío figura como “sin contar” y su stock no se
              toca. Después de cerrar no se puede modificar.
              {sinContar.length > 0 && ` Hoy quedarían ${sinContar.length} sin contar.`}
            </p>
          </form>
        </Card>
      )}

      {count.status === "CANCELLED" && (
        <Card className="border-stone-300">
          <h2 className="mb-1 font-semibold">Cerrado sin contar</h2>
          <p className="text-sm">
            Motivo: <b>{count.notes ?? "—"}</b>
          </p>
          <p className="mt-1 text-sm text-soft">No se cargó ninguna cantidad: el stock no se modificó.</p>
        </Card>
      )}

      {count.status !== "OPEN" && count.status !== "CANCELLED" && (
        <>
          {count.notes && (
            <p className="mb-3 text-sm text-soft">
              Motivo del cierre: <span className="text-ink">{count.notes}</span>
            </p>
          )}
          <Card>
            <h2 className="mb-1 font-semibold">Teórico vs físico</h2>
            <p className="mb-3 text-sm text-soft">
              {contadas.length} producto(s) contado(s)
              {sinContar.length > 0 && ` · ${sinContar.length} sin contar (no se comparan ni se ajustan)`}
            </p>
            <div className="space-y-2 sm:hidden">
              {diffs.map((l) => (
                <div key={l.id} className="rounded-lg border border-blush-100 p-3">
                  <div className="text-sm font-medium">
                    {l.product.name}
                    {l.lot ? <span className="font-normal text-soft"> · lote {l.lot.code}</span> : null}
                  </div>
                  <div className="mt-1 flex items-baseline justify-between text-sm">
                    <span className="text-soft">
                      Teórico {fmtQty(l.expected)} · físico {fmtQty(l.counted ?? 0)}
                    </span>
                    <span
                      className={`font-display text-2xl leading-none ${
                        l.diff === 0 ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {l.diff > 0 ? "+" : ""}
                      {fmtQty(l.diff)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
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
            {sinContar.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-soft">
                  Ver los {sinContar.length} sin contar
                </summary>
                <ul className="mt-2 grid gap-1 text-sm text-soft sm:grid-cols-2">
                  {sinContar.map((l) => (
                    <li key={l.id}>
                      {l.product.name}
                      {l.lot ? ` · lote ${l.lot.code}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          {count.status === "CLOSED" && user.role !== "ADMIN" && (
            <p className="mt-4 text-sm text-soft">Esperando revisión de un admin.</p>
          )}
          {count.status === "CLOSED" && user.role === "ADMIN" && (
            <Card className="mt-4 border-amber-200">
              <h2 className="mb-1 font-semibold">Revisión</h2>
              <p className="mb-3 text-sm text-soft">
                Aprobar genera movimientos de ajuste trazables por cada diferencia. Rechazar no
                toca el stock.
              </p>
              <form action={revisarConteo} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="conteo" value={count.id} />
                <div className="sm:col-span-2">
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
                  <SubmitButton name="decision" value="aprobar" className={button}>
                    Aprobar y ajustar stock
                  </SubmitButton>
                  <SubmitButton
                  name="decision"
                    value="rechazar"
                    className={`${button} bg-ink hover:bg-stone-700`}
                  >
                    Rechazar
                  </SubmitButton>
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
