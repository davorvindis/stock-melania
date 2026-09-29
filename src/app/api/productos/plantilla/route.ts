import { getSessionUser, can } from "@/lib/auth";
import { plantillaProductosWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "productos")) return new Response("No autorizado", { status: 401 });
  const buf = await plantillaProductosWorkbook();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-productos-melania.xlsx"',
    },
  });
}
