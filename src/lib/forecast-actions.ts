"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "./db";
import { requireSection } from "./auth";
import { esServicio, searchOrdersCreados, wixConfigurado } from "./wix/client";
import { getConfigForecast, getResumenHistorial } from "./forecast";

const BACK = "/ventas/forecast";
function volver(tipo: "ok" | "error", msg: string): never {
  revalidatePath(BACK);
  redirect(`${BACK}?${tipo}=${encodeURIComponent(msg)}`);
}

export async function guardarConfigForecast(formData: FormData) {
  const user = await requireSection("forecast");
  const n = (k: string, min: number, max: number) => {
    const v = Number(String(formData.get(k) ?? "").trim());
    if (!Number.isInteger(v) || v < min || v > max) volver("error", `Revisá "${k}": tiene que ser un número de días entre ${min} y ${max}`);
    return v;
  };
  const actual = await getConfigForecast();
  const value = { ...actual, demora: n("demora", 1, 365), colchon: n("colchon", 0, 180), cubrir: n("cubrir", 7, 365) };
  const { error } = await db().from("app_settings").upsert({ key: "forecast", value, updated_at: new Date().toISOString(), updated_by: user.alias }, { onConflict: "key" });
  if (error) volver("error", error.message);
  await db().from("audit_logs").insert({ actor: user.alias, action: "forecast:config", entity: "app_settings", detail: value });
  volver("ok", "Configuración guardada");
}

// trae de Wix los pedidos desde 2025 hasta el día en que arrancó la app (lo posterior ya está
// en el ledger). Va por tandas: si quedan más, se vuelve a tocar y sigue desde donde quedó.
export async function importarHistorialWix() {
  const user = await requireSection("forecast");
  if (!wixConfigurado()) volver("error", "Wix no está conectado en este entorno (las claves están solo en producción)");
  const r = await getResumenHistorial();
  const corte = r.corte ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const hasta = `${corte}T03:00:00.000Z`; // medianoche argentina del día de corte
  const desde = r.hasta ? new Date(Date.parse(r.hasta) + 1).toISOString() : "2025-01-01T03:00:00.000Z";
  const t0 = Date.now();
  let cursor: string | undefined;
  let pedidos = 0;
  let lineas = 0;
  let quedan = false;
  try {
    for (;;) {
      const pag = await searchOrdersCreados(desde, hasta, cursor);
      const filas = pag.orders.flatMap((o) =>
        (o.lineItems ?? [])
          .filter((li) => !esServicio(li) && Number(li.quantity) > 0)
          .map((li) => ({
            order_id: o.id,
            line_id: li.id,
            number: o.number != null ? String(o.number) : null,
            ordered_at: o.createdDate!,
            channel_type: o.channelInfo?.type ?? null,
            wix_status: o.status ?? null,
            payment_status: o.paymentStatus ?? null,
            external_sku: li.physicalProperties?.sku?.trim() || null,
            wix_product_id: li.catalogReference?.catalogItemId ?? null,
            wix_variant_id: li.catalogReference?.options?.variantId ?? null,
            name: li.productName?.original ?? li.productName?.translated ?? null,
            quantity: Number(li.quantity),
            imported_at: new Date().toISOString(),
          }))
      ).filter((f) => f.ordered_at);
      if (filas.length) {
        const { error } = await db().from("wix_sales_history").upsert(filas, { onConflict: "order_id,line_id" });
        if (error) throw new Error(error.message);
      }
      pedidos += pag.orders.length;
      lineas += filas.length;
      cursor = pag.next;
      if (!cursor) break;
      if (Date.now() - t0 > 48_000) {
        quedan = true;
        break;
      }
    }
  } catch (e) {
    volver("error", `Se cortó la importación (${pedidos} pedidos ya guardados, tocá de nuevo para seguir): ${(e as Error).message.slice(0, 200)}`);
  }
  await db().from("audit_logs").insert({ actor: user.alias, action: "forecast:importar_wix", entity: "wix_sales_history", detail: { pedidos, lineas, desde } });
  volver(
    "ok",
    quedan
      ? `Se trajeron ${pedidos} pedidos de Wix. Quedan más: tocá "Traer historial de Wix" de nuevo para seguir.`
      : `Historial de Wix al día: se trajeron ${pedidos} pedidos (${lineas} productos vendidos).`
  );
}

// ventas por semana a mano para un producto (vacío = volver a lo calculado)
export async function guardarRitmo(formData: FormData) {
  const user = await requireSection("forecast");
  const producto = String(formData.get("producto") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(producto)) volver("error", "Elegí un producto");
  const txt = String(formData.get("ritmo") ?? "").trim().replace(/\./g, "").replace(",", ".");
  const ritmo = txt ? Number(txt) : null;
  if (ritmo !== null && !(Number.isFinite(ritmo) && ritmo > 0)) volver("error", "Las ventas por semana tienen que ser un número mayor a 0");
  const actual = await getConfigForecast();
  const ritmos = { ...actual.ritmos };
  if (ritmo === null) delete ritmos[producto];
  else ritmos[producto] = Math.round(ritmo * 10) / 10;
  const value = { ...actual, ritmos };
  const { error } = await db().from("app_settings").upsert({ key: "forecast", value, updated_at: new Date().toISOString(), updated_by: user.alias }, { onConflict: "key" });
  if (error) volver("error", error.message);
  await db().from("audit_logs").insert({ actor: user.alias, action: "forecast:ritmo", entity: "products", entity_id: producto, detail: { ritmo } });
  volver("ok", ritmo === null ? "Vuelve a usar el ritmo calculado" : "Ritmo guardado");
}
