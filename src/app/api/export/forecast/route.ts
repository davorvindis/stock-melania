import { getSessionUser, can } from "@/lib/auth";
import { filtrarForecast, getConfigForecast, getForecast, hoyAR } from "@/lib/forecast";
import { forecastWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

// planilla de lo que hay que pedir (mismos filtros que la pantalla); tipo = propios | comprados
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "forecast")) return new Response("No autorizado", { status: 401 });
  const sp = new URL(request.url).searchParams;
  const tipo = sp.get("tipo");
  const { filas } = await getForecast(await getConfigForecast());
  const lista = filtrarForecast(filas, { estado: sp.get("estado") ?? undefined, cat: sp.get("cat") ?? undefined, q: sp.get("q") ?? undefined }).filter(
    (f) => (tipo === "propios" ? f.propio : tipo === "comprados" ? !f.propio : true)
  );
  const hoy = hoyAR();
  const nombre = tipo === "propios" ? "fabricacion-propia" : tipo === "comprados" ? "compras" : "forecast";
  const titulo = `Melania · ${tipo === "propios" ? "Fabricación propia" : "Para pedir"} · ${hoy.split("-").reverse().join("/")}`;
  const buf = await forecastWorkbook(lista, titulo);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}-melania-${hoy}.xlsx"`,
    },
  });
}
