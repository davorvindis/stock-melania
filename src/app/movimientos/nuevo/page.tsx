import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import { randomUUID } from "crypto";
import { getBalances, getLocations, isAvailable } from "@/lib/queries";
import { registrarMovimiento } from "@/lib/actions";
import { MOVEMENT_LABELS, OPERABLE_TYPES, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label } from "@/components/ui";
import { LineasMovimiento } from "@/components/lineas-movimiento";

export const dynamic = "force-dynamic";

export default async function NuevoMovimiento({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireSection("movimientos");
  const { ok, error } = await searchParams;
  const [balances, locations] = await Promise.all([getBalances(), getLocations()]);

  const opciones = balances.map((b) => ({
    value: `${b.product.id}|${b.lot?.id ?? ""}|${b.location.id}`,
    label: `${b.product.name}${b.lot ? ` · lote ${b.lot.code}` : ""} · ${b.location.name} (${fmtQty(
      b.quantity
    )} ${b.product.unit})${!isAvailable(b) ? " ⚠ no disponible" : ""}`,
  }));

  return (
    <div className="max-w-2xl">
      <PageTitle>Nuevo movimiento</PageTitle>
      <Flash ok={ok} error={error} />
      <Card>
        <form action={registrarMovimiento} className="space-y-4">
          <input type="hidden" name="idem" value={randomUUID()} />

          <div>
            <label className={label}>Tipo de movimiento *</label>
            <select name="tipo" required className={input}>
              {OPERABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-soft">
              Transferencia, cuarentena y envío a proveedor necesitan destino.
            </p>
          </div>

          <div>
            <label className={label}>Productos *</label>
            <LineasMovimiento opciones={opciones} kits={[]} ubicaciones={locations} />
            <p className="mt-1 text-xs text-soft">
              Los kits armados aparecen acá como cualquier producto con stock. Se arman desde su
              página en Productos.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Motivo / N° de pedido</label>
              <input
                type="text"
                name="motivo"
                placeholder="ej. Pedido #1234, venta mostrador…"
                className={input}
              />
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
            <label className={label}>Observaciones</label>
            <textarea name="notas" rows={2} className={input} />
          </div>

          <SubmitButton className="w-full rounded-lg bg-rose-deep px-6 py-3 text-base font-semibold text-white hover:bg-rose-deeper sm:w-auto">
            Confirmar movimiento
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
