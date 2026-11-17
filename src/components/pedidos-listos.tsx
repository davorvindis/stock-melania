import Link from "next/link";
import { Card } from "@/components/ui";
import type { ResumenListos } from "@/lib/pedidos-listos";
import type { PedidoEnEspera } from "@/lib/pedidos-espera";
import { fmtQty } from "@/lib/types";

const RETIRO = "/pedidos?estado=PROCESSED&entrega=RETIRO";
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// Dashboard: pedidos armados que todavía no salieron del local
export function TarjetaPedidosListos({ r }: { r: ResumenListos }) {
  if (r.retiro.total + r.envio.total === 0) return null;
  const alerta = r.retiro.sinAvisarDemorados + r.envio.demorados > 0;
  return (
    <Card className={alerta ? "border-amber-300 bg-amber-50" : ""}>
      <h2 className="mb-2 font-semibold">📦 Pedidos listos para salir</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href={RETIRO} className="rounded-lg border border-line bg-white p-3 hover:border-blush">
          <div className="font-display text-3xl leading-none">{r.retiro.total}</div>
          <div className="text-sm">esperando ser retirados</div>
          {r.retiro.sinAvisar > 0 ? (
            <div className={`mt-1 text-xs font-medium ${r.retiro.sinAvisarDemorados ? "text-red-700" : "text-amber-800"}`}>
              {plural(r.retiro.sinAvisar, "sin avisar a la clienta", "sin avisar a la clienta")}
              {r.retiro.sinAvisarDemorados ? ` · ${r.retiro.sinAvisarDemorados} hace más de 1 día hábil` : ""}
            </div>
          ) : (
            r.retiro.total > 0 && <div className="mt-1 text-xs text-emerald-800">Todas las clientas avisadas</div>
          )}
        </Link>
        <div className="rounded-lg border border-line bg-white p-3">
          <div className="font-display text-3xl leading-none">{r.envio.total}</div>
          <div className="text-sm">por enviar</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
            <Link href="/pedidos?estado=PROCESSED&entrega=MOTO" className="text-rose-deep hover:underline">🛵 {r.envio.moto} por moto</Link>
            <Link href="/pedidos?estado=PROCESSED&entrega=CORREO" className="text-rose-deep hover:underline">📦 {r.envio.correo} por correo</Link>
            {r.envio.otro > 0 && <Link href="/pedidos?estado=PROCESSED" className="text-rose-deep hover:underline">{r.envio.otro} otro</Link>}
          </div>
          {r.envio.demorados > 0 && <div className="mt-1 text-xs font-medium text-red-700">{r.envio.demorados} listo(s) hace más de 1 día hábil</div>}
          {r.enEspera > 0 && <div className="mt-1 text-xs font-medium text-violet-800">⏸ {r.enEspera} en espera (ver abajo)</div>}
        </div>
      </div>
      <p className="mt-2 text-xs text-soft">
        Avisale a la clienta cuando su pedido está listo para retirar y tocá <b>Avisé a la clienta</b> en el pedido.
      </p>
    </Card>
  );
}

// franja arriba de todas las pantallas: solo si hay algo de más de 1 día hábil
export function BannerPedidosListos({ r }: { r: ResumenListos }) {
  const sinAvisar = r.retiro.sinAvisarDemorados;
  const envios = r.envio.demorados;
  if (sinAvisar + envios === 0) return null;
  const partes = [
    sinAvisar ? `${plural(sinAvisar, "pedido para retirar", "pedidos para retirar")} sin avisar a la clienta` : null,
    envios ? `${plural(envios, "pedido", "pedidos")} por enviar` : null,
  ].filter(Boolean);
  return (
    <div className="border-b border-amber-300 bg-amber-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span>
          ⏰ Hay <b>{partes.join(" y ")}</b> desde hace más de 1 día hábil.
        </span>
        <Link href={sinAvisar ? RETIRO : "/pedidos?estado=PROCESSED"} className="font-semibold text-rose-deep hover:underline">
          Ver pedidos →
        </Link>
      </div>
    </div>
  );
}

const diasDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));

// Dashboard: pedidos que no se despachan a propósito (ej. esperan otro producto)
export function TarjetaPedidosEnEspera({ pedidos }: { pedidos: PedidoEnEspera[] }) {
  if (pedidos.length === 0) return null;
  const listos = pedidos.filter((p) => p.yaIngreso).length;
  return (
    <Card className={listos ? "border-emerald-300 bg-emerald-50" : "border-violet-200 bg-violet-50"}>
      <h2 className="mb-1 font-semibold">⏸ Pedidos en espera ({pedidos.length})</h2>
      <p className="mb-2 text-xs text-soft">
        No se despachan todavía a propósito, por eso no figuran como demorados.
        {listos > 0 && <b className="text-emerald-900"> {listos === 1 ? "En 1 ya ingresó" : `En ${listos} ya ingresó`} lo que esperaba.</b>}
      </p>
      <ul className="space-y-2">
        {pedidos.map((p) => {
          const dias = diasDesde(p.hold_since);
          return (
            <li key={p.id}>
              <Link href={`/pedidos/${p.id}`} className="block rounded-lg border border-line bg-white p-3 hover:border-blush">
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  <span className="font-semibold">
                    #{p.number ?? "?"} · {p.customer ?? "—"}
                    {p.wholesale && <span className="ml-2 rounded-full bg-rose-deep px-2 py-0.5 text-xs font-semibold text-white">Mayorista</span>}
                  </span>
                  <span className="text-xs text-soft">{dias === 0 ? "desde hoy" : `hace ${dias} día${dias === 1 ? "" : "s"}`} · {p.hold_by}</span>
                </div>
                <div className="text-sm">{p.hold_reason}</div>
                {p.esperados.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {p.esperados.map((e) => (
                      <span
                        key={e.id}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.ingreso > 0 ? "bg-emerald-100 text-emerald-900" : "bg-gray-100 text-gray-700"}`}
                      >
                        {e.ingreso > 0 ? `✅ Ya ingresó ${e.name} (${fmtQty(e.ingreso)})` : `Esperando ${e.name}`}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
