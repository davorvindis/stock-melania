import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BUCKET, generarBackup, hoyAR } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Solo ADMIN. Sin ?archivo= genera una copia al momento; con ?archivo= baja una guardada.
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return new Response("No autorizado", { status: 401 });

  const archivo = new URL(request.url).searchParams.get("archivo");
  let cuerpo: Buffer;
  let nombre: string;
  if (archivo) {
    if (!/^backup-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(archivo)) return new Response("Archivo inválido", { status: 400 });
    const { data, error } = await db().storage.from(BUCKET).download(archivo);
    if (error || !data) return new Response("No se encontró la copia", { status: 404 });
    cuerpo = Buffer.from(await data.arrayBuffer());
    nombre = `stock-melania-${archivo}`;
  } else {
    cuerpo = await generarBackup();
    nombre = `stock-melania-backup-${hoyAR()}.json.gz`;
  }
  await db().from("audit_logs").insert({
    actor: user.alias, action: "backup:download", entity: "backups", entity_id: null,
    detail: { archivo: archivo ?? "al momento" },
  });
  return new Response(new Uint8Array(cuerpo), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${nombre}"`,
    },
  });
}
