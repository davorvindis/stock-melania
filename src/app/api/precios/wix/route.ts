import { traerPreciosWix } from "@/lib/precios-wix";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron diario de Vercel (vercel.json): trae los precios publicados en Wix a la lista de precios.
// Igual que el backup: si CRON_SECRET está configurado se exige (solo lee Wix y anota diferencias).
export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET;
  if (secreto && request.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new Response("No autorizado", { status: 401 });
  }
  try {
    const r = await traerPreciosWix("Wix (automático)");
    return Response.json({ ok: true, revisados: r.revisados, cambios: r.cambios, sinPagina: r.sinPagina.length });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
