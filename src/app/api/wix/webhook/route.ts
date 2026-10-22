import { after } from "next/server";
import { verificarWebhook } from "@/lib/wix/client";
import { procesarEvento, registrarEvento } from "@/lib/wix/processor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Webhooks de Wix (pedidos). El cuerpo es un JWT firmado por Wix. Hay que
// responder rápido (< 1,25 s): se guarda el evento y se procesa después.
export async function POST(request: Request) {
  const raw = await request.text();
  let ev;
  try {
    ev = verificarWebhook(raw);
  } catch (e) {
    return new Response((e as Error).message, { status: 401 });
  }
  const entidad = ev.entityId ?? (ev.data.orderId as string | undefined) ?? null;
  const eventId = ev.id || `${ev.eventType}:${entidad}:${ev.eventTime ?? Date.now()}`;
  try {
    const { id, nuevo } = await registrarEvento(eventId, ev.eventType, entidad, { slug: ev.slug, eventTime: ev.eventTime }, "webhook");
    if (nuevo) after(() => procesarEvento(id).catch(() => {}));
    return Response.json({ ok: true, nuevo });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
