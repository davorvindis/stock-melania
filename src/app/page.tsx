import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { agruparPedidos, diasRecientes, getVentas, rangoMesActual } from "@/lib/ventas";
import { contarPendientesVacaciones } from "@/lib/personal";
import { getBalances, getMovements, getCounts, isAvailable } from "@/lib/queries";
import { MOVEMENT_LABELS, fmtQty, fmtDateTime } from "@/lib/types";
import { Card, PageTitle, Stat, th, td } from "@/components/ui";
import { MovementCard, OrigenDestino } from "@/components/movement-card";
import { HBarChart, DailyFlowChart } from "@/components/charts";

export const dynamic = "force-dynamic";

const TIPOS_PRODUCTO: [string, string][] = [
  ["", "Todos"],
  ["TERMINADO", "Terminado"],
  ["MONODOSIS", "Monodosis"],
  ["KIT", "Kits"],
  ["PACKAGING", "Packaging"],
  ["INSUMO", "Insumos"],
  ["ACCESORIO", "Accesorios"],
  ["GRANEL", "Granel"],
];

const diaClave = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const user = await requireUser();
  const { tipo } = await searchParams;
  const tipoSel = TIPOS_PRODUCTO.some(([v]) => v === tipo) ? tipo! : "";
  // ventas: el reporte completo para quien tiene la pestaña Ventas; el resto ve las suyas
  const verTodas = can(user, "ventas");
  const mes = rangoMesActual();
  const ultimos14 = diasRecientes(14);
  const hace14 = ultimos14[0].clave;
  const desdeVentas = hace14 < mes.desde ? hace14 : mes.desde;
  const apruebaVacaciones = user.role === "ADMIN" && can(user, "vacaciones");
  const [balances, movements, counts, ventas, vacPendientes] = await Promise.all([
    getBalances(),
    getMovements(8),
    getCounts(),
    getVentas({ desde: desdeVentas, hasta: mes.hasta, persona: verTodas ? undefined : user.alias }),
    apruebaVacaciones ? contarPendientesVacaciones() : Promise.resolve(0),
  ]);
  const conteosARevisar = counts.filter((c) => c.status === "CLOSED");

  const fisico = balances.reduce((s, b) => s + Number(b.quantity), 0);
  const disponible = balances.filter(isAvailable).reduce((s, b) => s + Number(b.quantity), 0);
  const enCuarentena = balances
    .filter((b) => b.location.is_quarantine || (b.lot && b.lot.status !== "ACTIVE"))
    .reduce((s, b) => s + Number(b.quantity), 0);

  // bajo mínimo: suma disponible por producto vs stock mínimo
  const porProducto = new Map<string, { sku: string; name: string; type: string; min: number; qty: number }>();
  for (const b of balances) {
    const cur = porProducto.get(b.product.id) ?? {
      sku: b.product.sku,
      name: b.product.name,
      type: b.product.type,
      min: Number(b.product.min_stock),
      qty: 0,
    };
    if (isAvailable(b)) cur.qty += Number(b.quantity);
    porProducto.set(b.product.id, cur);
  }
  const bajoMinimo = [...porProducto.values()].filter((p) => p.min > 0 && p.qty < p.min);

  // disponible por tipo de producto (para los filtros del gráfico)
  const totalPorTipo = new Map<string, { qty: number; productos: number }>();
  for (const p of porProducto.values()) {
    if (p.qty <= 0) continue;
    const t = totalPorTipo.get(p.type) ?? { qty: 0, productos: 0 };
    t.qty += p.qty;
    t.productos += 1;
    totalPorTipo.set(p.type, t);
  }
  const delTipo = [...porProducto.values()]
    .filter((p) => p.qty > 0 && (!tipoSel || p.type === tipoSel))
    .sort((a, b) => b.qty - a.qty);
  const totalTipo = delTipo.reduce((s, p) => s + p.qty, 0);

  // ventas: últimos 14 días por día + resumen del mes
  const dias = new Map(ultimos14.map((d) => [d.clave, { label: d.label, inQty: 0, outQty: 0 }]));
  for (const v of ventas) {
    const b = dias.get(diaClave.format(new Date(v.occurred_at)));
    if (!b) continue;
    if (v.type === "SALE") b.inQty += Number(v.quantity);
    if (v.type === "WHOLESALE_SALE") b.outQty += Number(v.quantity);
  }
  const delMes = ventas.filter((v) => diaClave.format(new Date(v.occurred_at)) >= mes.desde);
  const pedidosMes = agruparPedidos(delMes);
  const resumenMes = (t: string) => ({
    u: delMes.filter((v) => v.type === t).reduce((s, v) => s + Number(v.quantity), 0),
    p: pedidosMes.filter((x) => x.tipo === t).length,
  });
  const vMin = resumenMes("SALE");
  const vMay = resumenMes("WHOLESALE_SALE");

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

      {vacPendientes > 0 && (
        <Card className="mt-4 border-amber-200">
          <p className="text-sm">
            <b className="text-amber-800">
              {vacPendientes} solicitud(es) de vacaciones para aprobar.
            </b>{" "}
            <Link href="/vacaciones" className="font-medium text-rose-deep hover:underline">
              Revisar →
            </Link>
          </p>
        </Card>
      )}

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
        <Card className="min-w-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Disponible por producto</h2>
            <span className="text-sm text-soft">
              {fmtQty(totalTipo)} u. en {delTipo.length} producto(s)
            </span>
          </div>
          <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {TIPOS_PRODUCTO.filter(([v]) => !v || totalPorTipo.has(v)).map(([v, l]) => (
              <Link
                key={v || "todos"}
                href={v ? `/?tipo=${v}` : "/"}
                scroll={false}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                  tipoSel === v ? "border-rose-deep bg-rose-deep text-white" : "border-line bg-white text-soft hover:border-blush"
                }`}
              >
                {l}
                {v && <span className="ml-1 opacity-75">{fmtQty(totalPorTipo.get(v)!.qty)}</span>}
              </Link>
            ))}
          </div>
          <HBarChart items={delTipo.slice(0, 10).map((p) => ({ label: p.name, value: p.qty }))} />
          {delTipo.length > 10 && (
            <Link href="/stock" className="mt-3 inline-block text-sm text-rose-deep hover:underline">
              y {delTipo.length - 10} producto(s) más: ver en Stock →
            </Link>
          )}
        </Card>
        <Card className="min-w-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{verTodas ? "Ventas" : "Mis ventas"} — últimos 14 días</h2>
            {verTodas && (
              <Link href="/ventas" className="text-sm text-rose-deep hover:underline">
                Ver reporte →
              </Link>
            )}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-blush-50 px-3 py-2">
              <div className="text-xs text-soft">Minorista este mes</div>
              <div className="font-display text-2xl leading-none">{fmtQty(vMin.u)} u.</div>
              <div className="text-xs text-soft">{vMin.p} pedido(s)</div>
            </div>
            <div className="rounded-lg bg-blush-50 px-3 py-2">
              <div className="text-xs text-soft">Mayorista este mes</div>
              <div className="font-display text-2xl leading-none">{fmtQty(vMay.u)} u.</div>
              <div className="text-xs text-soft">{vMay.p} pedido(s)</div>
            </div>
          </div>
          <DailyFlowChart
            days={[...dias.values()]}
            leyenda={["Minorista", "Mayorista"]}
            vacio="Sin ventas en los últimos 14 días."
          />
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
