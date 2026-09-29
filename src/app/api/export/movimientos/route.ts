import { getSessionUser, can } from "@/lib/auth";
import { movementsWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "movimientos")) return new Response("No autorizado", { status: 401 });
  const buf = await movementsWorkbook();
  const fecha = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="movimientos-melania-${fecha}.xlsx"`,
    },
  });
}
