import { getSessionUser, can } from "@/lib/auth";
import { stockWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "stock")) return new Response("No autorizado", { status: 401 });
  // mismos filtros que la pantalla de Stock
  const sp = new URL(request.url).searchParams;
  const f = Object.fromEntries(
    (["q", "lote", "ubicacion", "tipo", "disp"] as const).map((k) => [k, sp.get(k) ?? undefined])
  );
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const pedida = sp.get("fecha");
  const historica = pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) && pedida < hoy ? pedida : null;
  if (historica) delete f.disp;
  const buf = await stockWorkbook(f, historica);
  const fecha = historica ?? hoy;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stock-melania-${fecha}.xlsx"`,
    },
  });
}
