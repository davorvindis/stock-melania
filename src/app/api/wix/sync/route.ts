import { corridaSync } from "@/lib/wix/processor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Corrida de mantenimiento: procesa eventos pendientes, sondea pedidos en Wix
// (por si se perdió un webhook), manda fulfillments pendientes y publica el
// disponible. La llama un cron externo (pg_cron o Vercel) con WIX_SYNC_SECRET.
export async function GET(request: Request) {
  const secreto = process.env.WIX_SYNC_SECRET;
  const auth = request.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) return new Response("No autorizado", { status: 401 });
  try {
    const r = await corridaSync();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const POST = GET;
