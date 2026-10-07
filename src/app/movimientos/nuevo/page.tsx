import { SubmitButton } from "@/components/submit-button";
import { requireSection, ubicacionFija } from "@/lib/auth";
import { randomUUID } from "crypto";
import { getBalances, getLocations, isAvailable } from "@/lib/queries";
import { registrarMovimiento } from "@/lib/actions";
import { fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label } from "@/components/ui";
import { LineasMovimiento } from "@/components/lineas-movimiento";
import { TipoDestino } from "@/components/tipo-destino";

export const dynamic = "force-dynamic";

export default async function NuevoMovimiento({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireSection("movimientos");
  const { ok, error } = await searchParams;
  const [balances, locations] = await Promise.all([getBalances(), getLocations()]);

  // stock del usuario: si está atado a una ubicación, solo esa; si no, la suya primero
  const fija = ubicacionFija(user);
  const miUbicacion = locations.find((l) => l.id === user.location_id);
  const visibles = (fija ? balances.filter((b) => b.location.id === fija) : balances)
    .slice()
    .sort((a, b) => Number(b.location.id === user.location_id) - Number(a.location.id === user.location_id));

  const opciones = visibles.map((b) => ({
    value: `${b.product.id}|${b.lot?.id ?? ""}|${b.location.id}`,
    label: `${b.product.name}${b.lot ? ` · lote ${b.lot.code}` : ""} · ${b.location.name} (${fmtQty(
      b.quantity
    )} ${b.product.unit})${!isAvailable(b) ? " ⚠ no disponible" : ""}`,
  }));

  return (
    <div className="max-w-2xl">
      <PageTitle>Nuevo movimiento</PageTitle>
      <Flash ok={ok} error={error} />
      {miUbicacion && (
        <p className="mb-3 rounded-lg border border-blush-100 bg-white px-3 py-2 text-sm">
          📍 Operás desde <b>{miUbicacion.name}</b>
          {fija
            ? ": los productos salen de acá (ej. venta = " + miUbicacion.name + " → Venta)."
            : ". Su stock aparece primero en la lista."}
        </p>
      )}
      <Card>
        <form action={registrarMovimiento} className="space-y-4">
          <input type="hidden" name="idem" value={randomUUID()} />

          <TipoDestino ubicaciones={locations} />

          <div>
            <label className={label}>Productos *</label>
            <LineasMovimiento
              opciones={opciones}
              kits={[]}
              ubicaciones={fija ? locations.filter((l) => l.id === fija) : locations}
            />
            <p className="mt-1 text-xs text-soft">
              Los kits armados aparecen acá como cualquier producto con stock. Se arman desde su
              página en Productos.
            </p>
          </div>

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
