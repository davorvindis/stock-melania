import { redirect } from "next/navigation";

// "Cargar o ver otro día": lleva al cierre de la fecha elegida
export async function GET(request: Request) {
  const fecha = new URL(request.url).searchParams.get("fecha") ?? "";
  redirect(/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `/caja/${fecha}` : "/caja");
}
