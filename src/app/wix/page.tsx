import Link from "next/link";
import { requireRole, requireSection } from "@/lib/auth";
import { getWixSettings } from "@/lib/wix/processor";
import { wixConfigurado } from "@/lib/wix/client";
import { contarEventos, getEventosWix, resumenEquivalenciasWix } from "@/lib/wix/queries";
import { cambiarOpcionesWix, cambiarPulsador, mapearCatalogoWix, probarConexionWix, publicarTodoElStock, reintentarEvento, sincronizarAhora } from "@/lib/wix/actions";
import { fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, Stat, input, label, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

const btn = "rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium hover:bg-blush-50";

export default async function WixPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireSection("wix");
  await requireRole("ADMIN");
  const sp = await searchParams;
  const [s, eventos, conteo, eq] = await Promise.all([getWixSettings(), getEventosWix(), contarEventos(), resumenEquivalenciasWix()]);
  const configurado = wixConfigurado();
  const pausados = conteo.PAUSED ?? 0;

  return (
    <div>
      <PageTitle>Integración Wix</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />

      <Card className={`border-2 ${s.enabled ? "border-emerald-300" : "border-red-300"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">{s.enabled ? "🟢 Conectado a Wix" : "🔴 Desconectado de Wix"}</p>
            <p className="mt-1 max-w-xl text-sm text-soft">
              {s.enabled
                ? "Los pedidos pagados se reservan solos, las ventas del POS se descuentan del Store y el disponible se publica en Wix."
                : "Nada entra ni sale de Wix. Los eventos que lleguen quedan guardados; al reconectar elegís si se procesan o se descartan. Mientras tanto, las ventas del local se cargan a mano (Store → Venta)."}
            </p>
            {!s.enabled && s.paused_at && (
              <p className="mt-1 text-xs text-soft">Desconectado por {s.paused_by} el {fmtDateTime(s.paused_at)}: {s.paused_reason}</p>
            )}
            {s.activated_at && <p className="mt-1 text-xs text-soft">Activado por primera vez el {fmtDateTime(s.activated_at)} (pedidos anteriores se ignoran).</p>}
            {!configurado && <p className="mt-2 text-sm font-medium text-red-700">Faltan las variables WIX_* en el servidor: la conexión no va a funcionar.</p>}
          </div>
          <form action={cambiarPulsador} className="w-full max-w-sm space-y-2">
            {s.enabled ? (
              <>
                <input type="hidden" name="accion" value="desconectar" />
                <label className={label}>Motivo (obligatorio)</label>
                <input name="motivo" className={input} placeholder="Ej. está descontando mal el Mousse" required />
                <SubmitButton className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
                  ⏻ Desconectar de Wix (emergencia)
                </SubmitButton>
              </>
            ) : (
              <>
                <input type="hidden" name="accion" value="conectar" />
                {pausados > 0 && (
                  <div className="rounded-lg bg-amber-50 p-2 text-sm">
                    <p className="mb-1 font-medium text-amber-900">{pausados} evento(s) llegaron mientras estaba desconectado:</p>
                    <label className="block"><input type="radio" name="pausados" value="procesar" defaultChecked /> Procesarlos ahora (reserva/descuenta lo que falte)</label>
                    <label className="block"><input type="radio" name="pausados" value="descartar" /> Descartarlos (ya lo cargué a mano)</label>
                  </div>
                )}
                <SubmitButton className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
                  ⏻ Conectar con Wix
                </SubmitButton>
              </>
            )}
          </form>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Eventos pendientes" value={(conteo.PENDING ?? 0) + pausados} alert={(conteo.PENDING ?? 0) + pausados > 0} />
        <Stat label="Eventos con error" value={conteo.ERROR ?? 0} alert={(conteo.ERROR ?? 0) > 0} />
        <Stat label="SKU mapeados en Wix" value={`${eq.mapeadas}/${eq.total}`} alert={eq.mapeadas < eq.total} />
        <Stat label="Último sondeo" value={s.last_poll_at ? fmtDateTime(s.last_poll_at) : "—"} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Herramientas</h2>
          <div className="flex flex-wrap gap-2">
            <form action={probarConexionWix}><SubmitButton className={btn}>Probar conexión</SubmitButton></form>
            <form action={mapearCatalogoWix}><SubmitButton className={btn}>Mapear catálogo de Wix</SubmitButton></form>
            <form action={sincronizarAhora}><SubmitButton className={btn}>Sincronizar ahora</SubmitButton></form>
            <form action={publicarTodoElStock}><SubmitButton className={btn}>Publicar todo el disponible</SubmitButton></form>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-soft">
            <li><b>Probar conexión</b>: verifica credenciales y versión de catálogo.</li>
            <li><b>Mapear catálogo</b>: vincula cada SKU de <Link href="/equivalencias" className="text-rose-deep hover:underline">Equivalencias</Link> con su producto/variante en Wix. Hacelo al principio y cada vez que Joel cree productos nuevos.</li>
            <li><b>Sincronizar ahora</b>: procesa pendientes, sondea pedidos nuevos, manda fulfillments y publica stock (lo mismo que hace el cron).</li>
            <li><b>Publicar todo</b>: manda el disponible de Depósito de todos los SKU a Wix.</li>
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Opciones</h2>
          <form action={cambiarOpcionesWix} className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="sync_inventory" value="si" defaultChecked={!!s.sync_inventory} className="mt-1" />
              <span>
                <b>Publicar el disponible a Wix</b>
                <span className="block text-xs text-soft">Stock Melania manda a Wix el disponible de Depósito (físico − reservado) por cada SKU. Packs = disponible ÷ unidades del pack; combos = el componente que menos alcanza.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="enable_tracking" value="si" defaultChecked={!!s.enable_tracking} className="mt-1" />
              <span>
                <b>Activar seguimiento de inventario en Wix a los productos que no lo tienen</b>
                <span className="block text-xs text-soft">Hoy {eq.sinSeguimiento} SKU están sin seguimiento (Wix solo muestra "hay / no hay"). Si no se activa, esos no se publican.</span>
              </span>
            </label>
            <SubmitButton className={btn}>Guardar opciones</SubmitButton>
          </form>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-soft">
            <dt>Catálogo Wix</dt><dd>{s.catalog_version ?? "sin mapear"}</dd>
            <dt>Última publicación</dt><dd>{eq.ultimaSync ? fmtDateTime(eq.ultimaSync) : "—"}{eq.conError > 0 && <span className="text-red-700"> · {eq.conError} SKU con error</span>}</dd>
            <dt>Depósito / Store</dt><dd>{s.location_deposito ? "configurados" : <span className="text-red-700">falta configurar</span>}</dd>
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="mb-2 font-semibold">Últimos eventos</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Recibido</th>
                <th className={th}>Evento</th>
                <th className={th}>Pedido</th>
                <th className={th}>Origen</th>
                <th className={th}>Estado</th>
                <th className={th}>Resultado</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((e) => (
                <tr key={e.id} className="border-b border-blush-100 align-top">
                  <td className={`${td} whitespace-nowrap text-xs`}>{fmtDateTime(e.received_at)}</td>
                  <td className={`${td} text-xs`}>{e.event_type.replace("wix.ecom.v1.", "")}</td>
                  <td className={`${td} font-mono text-xs`}>{e.entity_id?.slice(0, 8) ?? "—"}</td>
                  <td className={`${td} text-xs`}>{e.source}</td>
                  <td className={`${td} text-xs`}>
                    <span className={e.status === "ERROR" ? "font-medium text-red-700" : e.status === "DONE" ? "text-emerald-800" : "text-amber-800"}>{e.status}</span>
                    {e.attempts > 1 && <span className="text-soft"> ×{e.attempts}</span>}
                  </td>
                  <td className={`${td} max-w-sm text-xs`}>{e.error ? <span className="text-red-700">{e.error}</span> : e.result}</td>
                  <td className={td}>
                    {(e.status === "ERROR" || e.status === "PAUSED" || e.status === "SKIPPED") && (
                      <form action={reintentarEvento}>
                        <input type="hidden" name="id" value={e.id} />
                        <SubmitButton className="text-xs text-rose-deep hover:underline">Reintentar</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {eventos.length === 0 && <tr><td className={td} colSpan={7}>Todavía no llegó ningún evento de Wix.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
