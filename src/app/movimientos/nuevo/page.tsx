import { randomUUID } from "crypto";
import { getBalances, getLocations, isAvailable } from "@/lib/queries";
import { registrarMovimiento } from "@/lib/actions";
import { MOVEMENT_LABELS, OPERABLE_TYPES, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NuevoMovimiento({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const [balances, locations] = await Promise.all([getBalances(), getLocations()]);

  return (
    <div className="max-w-2xl">
      <PageTitle>Nuevo movimiento</PageTitle>
      <Flash ok={ok} error={error} />
      <Card>
        <form action={registrarMovimiento} className="space-y-4">
          <input type="hidden" name="idem" value={randomUUID()} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Tipo de movimiento *</label>
              <select name="tipo" required className={input}>
                {OPERABLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MOVEMENT_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-stone-500">
                Transferencia, cuarentena y envío a proveedor necesitan destino.
              </p>
            </div>
            <div>
              <label className={label}>Quién lo realiza *</label>
              <input type="text" name="actor" placeholder="Tu nombre" required className={input} />
            </div>
          </div>

          <div>
            <label className={label}>Stock de origen *</label>
            <select name="origen" required className={input}>
              <option value="">Elegir producto / lote / ubicación…</option>
              {balances.map((b) => (
                <option key={b.id} value={`${b.product.id}|${b.lot?.id ?? ""}|${b.location.id}`}>
                  {b.product.name}
                  {b.lot ? ` · lote ${b.lot.code}` : ""} · {b.location.name} ({fmtQty(b.quantity)}{" "}
                  {b.product.unit}){!isAvailable(b) ? " ⚠ no disponible" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Cantidad *</label>
              <input type="number" name="cantidad" min="0.001" step="any" required className={input} />
            </div>
            <div>
              <label className={label}>Ubicación destino</label>
              <select name="destino" className={input}>
                <option value="">Sin destino (egreso)</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>Motivo</label>
            <input
              type="text"
              name="motivo"
              placeholder="ej. venta mostrador, rotura en depósito…"
              className={input}
            />
          </div>

          <div>
            <label className={label}>Observaciones</label>
            <textarea name="notas" rows={2} className={input} />
          </div>

          <button type="submit" className={`${button} w-full sm:w-auto`}>
            Confirmar movimiento
          </button>
        </form>
      </Card>
    </div>
  );
}
