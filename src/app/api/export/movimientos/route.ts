import { movementsWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const buf = await movementsWorkbook();
  const fecha = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="movimientos-melania-${fecha}.xlsx"`,
    },
  });
}
