import { backupDiario } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Lo llama el cron de Vercel una vez por día (vercel.json). Si CRON_SECRET está
// configurado se exige; igual, como máximo genera un backup por día.
export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET;
  if (secreto && request.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new Response("No autorizado", { status: 401 });
  }
  try {
    const r = await backupDiario();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
