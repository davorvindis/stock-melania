import "server-only";
import { db } from "../db";
import { getWixSettings } from "./processor";

// Panel de salud de la integración con Wix: lo que tiene que pasar solo, ¿está pasando?
// Si algo se traba, se ve el primer día (en Integración Wix y con una franja en el Dashboard).

export type EstadoSalud = "ok" | "alerta" | "error";
export type ControlSalud = { titulo: string; estado: EstadoSalud; detalle: string; nombres?: string[] };
export type SaludWix = { estado: EstadoSalud; controles: ControlSalud[]; conectado: boolean };

const minutos = (iso: string | null | undefined) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60_000) : null);
const hace = (m: number) => (m < 1 ? "recién" : m < 60 ? `hace ${m} min` : m < 48 * 60 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`);
const peor = (es: EstadoSalud[]): EstadoSalud => (es.includes("error") ? "error" : es.includes("alerta") ? "alerta" : "ok");

export async function getSaludWix(): Promise<SaludWix> {
  const s = await getWixSettings();
  if (!s.enabled) {
    return { estado: "alerta", conectado: false, controles: [{ titulo: "Conexión", estado: "alerta", detalle: "Desconectado de Wix: no se sincroniza nada." }] };
  }
  const cli = db();
  const hace30 = new Date(Date.now() - 30 * 60_000).toISOString();
  const [cola, colaVieja, eventos, skus, envios] = await Promise.all([
    cli.from("wix_sync_queue").select("product_id", { count: "exact", head: true }),
    cli.from("wix_sync_queue").select("queued_at, product:products(name)").order("queued_at").limit(5),
    cli.from("integration_events").select("event_type, error", { count: "exact" }).eq("status", "ERROR").limit(5),
    cli.from("channel_skus").select("external_sku, wix_sync_error", { count: "exact" }).eq("active", true).not("wix_sync_error", "is", null).limit(5),
    cli.from("channel_order_fulfillments").select("order:channel_orders(number)", { count: "exact" }).eq("wix_synced", false).lt("created_at", hace30).limit(5),
  ]);
  const controles: ControlSalud[] = [];

  // 1) la corrida automática (cada 5 min)
  const mSync = minutos(s.last_sync_at);
  controles.push(
    mSync == null
      ? { titulo: "Sincronización automática", estado: "alerta", detalle: "Sin datos todavía (se registra desde la próxima corrida)." }
      : { titulo: "Sincronización automática", estado: mSync > 15 ? "error" : "ok", detalle: `Última corrida ${hace(mSync)}${mSync > 15 ? ": tendría que correr cada 5 min" : ""}.` }
  );

  // 2) stock pendiente de mandar a la web
  const nCola = cola.count ?? 0;
  const vieja = (colaVieja.data ?? []) as unknown as { queued_at: string; product: { name: string } | null }[];
  const mCola = minutos(vieja[0]?.queued_at);
  controles.push(
    nCola === 0
      ? { titulo: "Stock pendiente de mandar a la web", estado: "ok", detalle: "Nada en espera." }
      : {
          titulo: "Stock pendiente de mandar a la web",
          estado: (mCola ?? 0) > 30 ? "error" : "ok",
          detalle: `${nCola} producto(s) en cola, el más viejo ${hace(mCola ?? 0)}${(mCola ?? 0) > 30 ? ": la web no está recibiendo esos cambios" : ""}.`,
          nombres: (mCola ?? 0) > 30 ? vieja.filter((v) => (minutos(v.queued_at) ?? 0) > 30).map((v) => v.product?.name ?? "?") : undefined,
        }
  );

  // 3) control web contra sistema (cada 30 min)
  const mRec = minutos(s.last_reconcile_at);
  const rev = s.last_reconcile_revisados;
  controles.push(
    mRec == null
      ? { titulo: "Control web contra sistema", estado: "error", detalle: "Nunca corrió." }
      : rev === 0
        ? { titulo: "Control web contra sistema", estado: "error", detalle: `Corrió ${hace(mRec)} pero no revisó ningún SKU: no está comparando nada.` }
        : {
            titulo: "Control web contra sistema",
            estado: mRec > 60 ? "error" : "ok",
            detalle: `${hace(mRec).replace(/^h/, "H")}${rev != null ? `: revisó ${rev} SKU` : ""}, ${s.last_reconcile_diffs ?? 0} diferencia(s) corregida(s)${mRec > 60 ? ". Tendría que correr cada 30 min" : ""}.`,
          }
  );

  // 4) errores
  const nEv = eventos.count ?? 0;
  const nSku = skus.count ?? 0;
  const nEnv = envios.count ?? 0;
  const nombres = [
    ...(skus.data ?? []).map((x) => `SKU ${x.external_sku}: ${String(x.wix_sync_error).slice(0, 80)}`),
    ...((envios.data ?? []) as unknown as { order: { number: string | null } | null }[]).map((x) => `Envío del pedido ${x.order?.number ?? "?"} sin avisar a Wix`),
    ...(eventos.data ?? []).map((x) => `Evento ${x.event_type}: ${String(x.error ?? "").slice(0, 80)}`),
  ];
  controles.push(
    nEv + nSku + nEnv === 0
      ? { titulo: "Errores", estado: "ok", detalle: "Ninguno." }
      : {
          titulo: "Errores",
          estado: "error",
          detalle: [nSku && `${nSku} SKU que Wix rechazó`, nEnv && `${nEnv} envío(s) sin avisar a Wix`, nEv && `${nEv} evento(s) con error`].filter(Boolean).join(" · "),
          nombres,
        }
  );

  return { estado: peor(controles.map((c) => c.estado)), controles, conectado: true };
}
