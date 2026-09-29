import { getSessionUser, can } from "@/lib/auth";
import { stockWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "stock")) return new Response("No autorizado", { status: 401 });
  const buf = await stockWorkbook();
  const fecha = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stock-melania-${fecha}.xlsx"`,
    },
  });
}
