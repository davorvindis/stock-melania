import { getSessionUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { BUCKET_CERTIFICADOS } from "@/lib/personal";

export const dynamic = "force-dynamic";

// muestra el certificado de un registro (solo quien ve Faltas y horas)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "faltas")) return new Response("No autorizado", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Inválido", { status: 400 });
  const { data: r } = await db().from("time_records").select("certificate_path").eq("id", id).maybeSingle();
  if (!r?.certificate_path) return new Response("Sin certificado", { status: 404 });
  const { data, error } = await db().storage.from(BUCKET_CERTIFICADOS).download(r.certificate_path);
  if (error || !data) return new Response("No se encontró el archivo", { status: 404 });
  const nombre = r.certificate_path.split("/").pop();
  return new Response(new Uint8Array(await data.arrayBuffer()), {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="certificado-${nombre}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
