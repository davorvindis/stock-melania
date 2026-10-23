import { getSessionUser, can } from "@/lib/auth";
import { excelCierres } from "@/lib/caja-excel";

export const dynamic = "force-dynamic";

// Excel de cierres de caja (mismo formato que la planilla de Yura) para el período elegido
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "caja")) return new Response("No autorizado", { status: 401 });
  const sp = new URL(request.url).searchParams;
  const f = (k: string) => {
    const v = sp.get(k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  const { buf, nombre } = await excelCierres(f("desde"), f("hasta"));
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre.replace(/[^\w .-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    },
  });
}
