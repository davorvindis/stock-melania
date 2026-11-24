import { can, getSessionUser } from "@/lib/auth";
import { getPreventa } from "@/lib/preventa";
import { armarComprobantePreventa, nombreArchivoComprobante } from "@/lib/comprobante-preventa";

export const dynamic = "force-dynamic";

async function logo(req: Request): Promise<Uint8Array | null> {
  try {
    const r = await fetch(new URL("/logo-melania.png", req.url));
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

// comprobante de pago de la preventa en PDF (descarga)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "preventa")) return new Response("No autorizado", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Inválido", { status: 400 });
  const pv = await getPreventa(id);
  if (!pv) return new Response("Preventa inexistente", { status: 404 });
  if (pv.status === "CANCELADA") return new Response("La preventa está cancelada", { status: 409 });
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const bytes = await armarComprobantePreventa(pv, await logo(req), hoy);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombreArchivoComprobante(pv)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
