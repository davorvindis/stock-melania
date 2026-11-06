"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";

// "Avisé a la clienta": el pedido para retirar está armado y ya se le avisó que lo puede pasar a buscar.
// No mueve stock; solo saca el pedido del recordatorio de "sin avisar".
export async function marcarAvisoCliente(formData: FormData) {
  const user = await requireSection("pedidos");
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) redirect("/pedidos?error=" + encodeURIComponent("Pedido inválido"));
  const back = `/pedidos/${id.data}`;
  const deshacer = formData.get("deshacer") === "1";
  const { data, error } = await db()
    .from("channel_orders")
    .update(deshacer ? { customer_notified_at: null, customer_notified_by: null } : { customer_notified_at: new Date().toISOString(), customer_notified_by: user.alias })
    .eq("id", id.data)
    .eq("state", "PROCESSED")
    .is("delivery_status", null)
    .select("id");
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (!data?.length) redirect(`${back}?error=${encodeURIComponent("El pedido ya no está esperando ser retirado")}`);
  await db().from("audit_logs").insert({
    actor: user.alias, action: deshacer ? "order:notify_undo" : "order:notify_customer", entity: "channel_orders", entity_id: id.data,
  });
  revalidatePath("/", "layout");
  redirect(`${back}?ok=${encodeURIComponent(deshacer ? "Aviso deshecho" : "Listo: quedó registrado que le avisaste a la clienta")}`);
}
