import { getSessionUser, can } from "@/lib/auth";
import { movementsWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "movimientos")) return new Response("No autorizado", { status: 401 });
  // mismos filtros que la pantalla de Movimientos
  const sp = new URL(request.url).searchParams;
  const buf = await movementsWorkbook({
    q: sp.get("q") ?? undefined,
    tipo: sp.get("tipo") ?? undefined,
    desde: sp.get("desde") ?? undefined,
    hasta: sp.get("hasta") ?? undefined,
    ubicacion: sp.get("ubicacion") ?? undefined,
  });
  const fecha = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="movimientos-melania-${fecha}.xlsx"`,
    },
  });
}
