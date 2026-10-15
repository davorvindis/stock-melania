import { getSessionUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { BUCKET_COMPROBANTES } from "@/lib/comprobantes";

export const dynamic = "force-dynamic";

// muestra la foto del remito (?tipo=remito) o de la factura (?tipo=factura) de un ingreso
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "ingresos")) return new Response("No autorizado", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Inválido", { status: 400 });
  const tipo = new URL(req.url).searchParams.get("tipo") === "factura" ? "invoice_path" : "remito_path";
  const { data: e } = await db().from("stock_entries").select(tipo).eq("id", id).maybeSingle();
  const path = (e as Record<string, string | null> | null)?.[tipo];
  if (!path) return new Response("Sin archivo", { status: 404 });
  const { data, error } = await db().storage.from(BUCKET_COMPROBANTES).download(path);
  if (error || !data) return new Response("No se encontró el archivo", { status: 404 });
  return new Response(new Uint8Array(await data.arrayBuffer()), {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${path.split("/").pop()}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
