"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";
import { ESTADOS_CON_ESPERA } from "./pedidos-espera";

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// "Poner en espera": el pedido no se despacha a propósito. No mueve stock; deja de contar
// como demorado y aparece en la tarjeta "Pedidos en espera" del Dashboard.
export async function ponerEnEspera(formData: FormData) {
  const user = await requireSection("pedidos");
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) redirect("/pedidos?error=" + encodeURIComponent("Pedido inválido"));
  const back = `/pedidos/${id.data}`;
  const fallar = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}#espera`);
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (motivo.length < 3) fallar("Escribí el motivo de la espera (ej. espera ingreso de Paso 1 y 2)");
  if (motivo.length > 300) fallar("El motivo es muy largo");

  // productos que se esperan: se eligen por nombre (lista con sugerencias)
  const nombres = formData.getAll("producto").map((v) => String(v).trim()).filter(Boolean);
  let productos: string[] = [];
  if (nombres.length) {
    const { data, error } = await db().from("products").select("id, name").eq("active", true);
    if (error) fallar(error.message);
    const porNombre = new Map((data ?? []).map((p) => [sinAcentos(p.name as string), p.id as string]));
    for (const n of nombres) {
      const pid = porNombre.get(sinAcentos(n));
      if (!pid) fallar(`No encontré el producto "${n}": elegilo de la lista de sugerencias`);
      productos.push(pid!);
    }
    productos = [...new Set(productos)];
  }

  const antes = await db().from("channel_orders").select("hold_since, hold_reason, hold_by").eq("id", id.data).maybeSingle();
  const nuevo = !antes.data?.hold_since;
  const { data, error } = await db()
    .from("channel_orders")
    .update({
      hold_reason: motivo,
      hold_products: productos,
      // si ya estaba en espera y solo se edita, se mantiene desde cuándo y quién la puso
      hold_since: nuevo ? new Date().toISOString() : antes.data!.hold_since,
      hold_by: nuevo ? user.alias : antes.data!.hold_by,
    })
    .eq("id", id.data)
    .in("state", [...ESTADOS_CON_ESPERA])
    .is("delivery_status", null)
    .neq("channel_type", "POS")
    .select("id");
  if (error) fallar(error.message);
  if (!data?.length) fallar("Este pedido ya salió o no se puede poner en espera");
  await db().from("audit_logs").insert({
    actor: user.alias,
    action: nuevo ? "order:hold" : "order:hold_edit",
    entity: "channel_orders",
    entity_id: id.data,
    detail: { motivo, productos, antes: nuevo ? null : antes.data?.hold_reason },
  });
  revalidatePath("/", "layout");
  redirect(`${back}?ok=${encodeURIComponent(nuevo ? "Pedido en espera: ya no figura como demorado" : "Espera actualizada")}`);
}

export async function quitarEspera(formData: FormData) {
  const user = await requireSection("pedidos");
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) redirect("/pedidos?error=" + encodeURIComponent("Pedido inválido"));
  const back = `/pedidos/${id.data}`;
  const antes = await db().from("channel_orders").select("hold_reason, hold_since").eq("id", id.data).maybeSingle();
  if (!antes.data?.hold_since) redirect(`${back}?error=${encodeURIComponent("El pedido no estaba en espera")}`);
  const { error } = await db()
    .from("channel_orders")
    .update({ hold_reason: null, hold_since: null, hold_by: null, hold_products: [] })
    .eq("id", id.data);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await db().from("audit_logs").insert({
    actor: user.alias, action: "order:hold_release", entity: "channel_orders", entity_id: id.data,
    detail: { motivo: antes.data!.hold_reason, desde: antes.data!.hold_since },
  });
  revalidatePath("/", "layout");
  redirect(`${back}?ok=${encodeURIComponent("Espera quitada: el pedido vuelve a la lista normal para despachar")}`);
}
