import { getSessionUser, can } from "@/lib/auth";
import { ventasWorkbook } from "@/lib/export";
import { rangoMesActual } from "@/lib/ventas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "ventas")) return new Response("No autorizado", { status: 401 });
  const sp = new URL(request.url).searchParams;
  const def = rangoMesActual();
  const filtros = {
    desde: sp.get("desde") ?? def.desde,
    hasta: sp.get("hasta") ?? def.hasta,
    persona: sp.get("persona") ?? undefined,
    producto: sp.get("producto") ?? undefined,
    ubicacion: sp.get("ubicacion") ?? undefined,
    canal: sp.get("canal") ?? undefined,
  };
  const buf = await ventasWorkbook(filtros);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ventas-melania-${filtros.desde}-a-${filtros.hasta}.xlsx"`,
    },
  });
}
