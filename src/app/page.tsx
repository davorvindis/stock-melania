import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getBalances, getMovements, getDailyFlow, getCounts, isAvailable } from "@/lib/queries";
import { MOVEMENT_LABELS, fmtQty, fmtDateTime } from "@/lib/types";
import { Card, PageTitle, Stat, th, td } from "@/components/ui";
import { MovementCard, OrigenDestino } from "@/components/movement-card";
import { HBarChart, DailyFlowChart } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireUser();
  const [balances, movements, dailyFlow, counts] = await Promise.all([
    getBalances(),
    getMovements(8),
    getDailyFlow(14),
    getCounts(),
  ]);
  const conteosARevisar = counts.filter((c) => c.status === "CLOSED");

  const fisico = balances.reduce((s, b) => s + Number(b.quantity), 0);
  const disponible = balances.filter(isAvailable).reduce((s, b) => s + Number(b.quantity), 0);
  const enCuarentena = balances
    .filter((b) => b.location.is_quarantine || (b.lot && b.lot.status !== "ACTIVE"))
    .reduce((s, b) => s + Number(b.quantity), 0);

  // bajo mínimo: suma disponible por producto vs stock mínimo
  const porProducto = new Map<string, { sku: string; name: string; min: number; qty: number }>();
  for (const b of balances) {
    const cur = porProducto.get(b.product.id) ?? {
      sku: b.product.sku,
      name: b.product.name,
      min: Number(b.product.min_stock),
      qty: 0,
    };
    if (isAvailable(b)) cur.qty += Number(b.quantity);
    porProducto.set(b.product.id, cur);
  }
  const bajoMinimo = [...porProducto.values()].filter((p) => p.min > 0 && p.qty < p.min);

  // lotes próximos a vencer (90 días)
  const limite = new Date();
  limite.setDate(limite.getDate() + 90);
  const porVencer = balances.filter(
    (b) => b.lot?.expires_on && new Date(b.lot.expires_on) <= limite
  );

  return (
    <div>
      <PageTitle>Dashboard</PageTitle>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Unidades físicas" value={fmtQty(fisico)} />
        <Stat label="Disponibles para venta" value={fmtQty(disponible)} />
        <Stat label="En cuarentena / bloqueado" value={fmtQty(enCuarentena)} alert={enCuarentena > 0} />
        <Stat label="Productos bajo mínimo" value={bajoMinimo.length} alert={bajoMinimo.length > 0} />
      </div>

      {conteosARevisar.length > 0 && (
        <Card className="mt-4 border-amber-200">
          <h2 className="mb-1 font-semibold text-amber-800">
            {conteosARevisar.length} conteo(s) esperando revisión
          </h2>
          <p className="text-sm">
            Hay diferencias de conteo sin aprobar ni rechazar.{" "}
            <Link href="/conteos" className="font-medium text-rose-deep hover:underline">
              Ir a conteos →
            </Link>
          </p>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Disponible por producto</h2>
          <HBarChart
            items={[...porProducto.values()]
              .sort((a, b) => b.qty - a.qty)
              .slice(0, 8)
              .map((p) => ({ label: p.name, value: p.qty }))}
          />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Entradas vs salidas — últimos 14 días</h2>
          <DailyFlowChart days={dailyFlow} />
        </Card>
      </div>

      {bajoMinimo.length > 0 && (
        <Card className="mt-4 border-red-200">
          <h2 className="mb-2 font-semibold text-red-800">⚠ Bajo stock mínimo</h2>
          <ul className="space-y-1 text-sm">
            {bajoMinimo.map((p) => (
              <li key={p.sku}>
                <span className="font-medium">{p.name}</span> ({p.sku}): disponible{" "}
                <span className="font-semibold text-red-700">{fmtQty(p.qty)}</span> / mínimo {fmtQty(p.min)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {porVencer.length > 0 && (
        <Card className="mt-4 border-amber-200">
          <h2 className="mb-2 font-semibold text-amber-800">Lotes que vencen en los próximos 90 días</h2>
          <ul className="space-y-1 text-sm">
            {porVencer.map((b) => (
              <li key={b.id}>
                {b.product.name} — lote {b.lot!.code} en {b.location.name}: {fmtQty(b.quantity)} u., vence{" "}
                {new Date(b.lot!.expires_on!).toLocaleDateString("es-AR")}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Últimos movimientos</h2>
          <Link href="/movimientos" className="text-sm text-rose-deep hover:underline">
            Ver todos →
          </Link>
        </div>
        <div className="space-y-2 sm:hidden">
          {movements.map((m) => (
            <MovementCard key={m.id} movement={m} />
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Fecha</th>
                <th className={th}>Tipo</th>
                <th className={th}>Producto</th>
                <th className={th}>Cant.</th>
                <th className={th}>Origen → Destino</th>
                <th className={th}>Quién</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-blush-100">
                  <td className={td}>{fmtDateTime(m.occurred_at)}</td>
                  <td className={td}>{MOVEMENT_LABELS[m.type] ?? m.type}</td>
                  <td className={td}>
                    {m.product.name}
                    {m.lot ? <span className="text-soft"> · {m.lot.code}</span> : null}
                  </td>
                  <td className={`${td} font-medium`}>{fmtQty(m.quantity)}</td>
                  <td className={td}>
                    <OrigenDestino m={m} />
                  </td>
                  <td className={td}>{m.actor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
