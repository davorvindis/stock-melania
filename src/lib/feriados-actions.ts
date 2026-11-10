"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "./db";
import { requireSection } from "./auth";
import { getFeriadosDetalle, guardarExtras } from "./feriados";

const BACK = "/configuracion";
function volver(tipo: "ok" | "error", msg: string): never {
  revalidatePath("/", "layout");
  redirect(`${BACK}?${tipo}=${encodeURIComponent(msg)}#feriados`);
}

// feriado cargado a mano (ej. feriado solo en CABA): no cuenta como día hábil para los avisos de pedidos
export async function agregarFeriado(formData: FormData) {
  const user = await requireSection("configuracion");
  const fecha = String(formData.get("fecha") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim().slice(0, 80);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) volver("error", "Elegí la fecha del feriado");
  if (!nombre) volver("error", "Poné el motivo del feriado");
  const { extra } = await getFeriadosDetalle();
  await guardarExtras([...extra.filter((f) => f.fecha !== fecha), { fecha, nombre }], user.alias);
  await db().from("audit_logs").insert({ actor: user.alias, action: "feriado:add", entity: "app_settings", detail: { fecha, nombre } });
  volver("ok", `Feriado del ${fecha.split("-").reverse().join("/")} agregado`);
}

export async function quitarFeriado(formData: FormData) {
  const user = await requireSection("configuracion");
  const fecha = String(formData.get("fecha") ?? "");
  const { extra } = await getFeriadosDetalle();
  await guardarExtras(extra.filter((f) => f.fecha !== fecha), user.alias);
  await db().from("audit_logs").insert({ actor: user.alias, action: "feriado:remove", entity: "app_settings", detail: { fecha } });
  volver("ok", "Feriado quitado");
}

export async function actualizarFeriados() {
  await requireSection("configuracion");
  const r = await getFeriadosDetalle(true);
  volver("ok", `Feriados nacionales actualizados (${Object.keys(r.nacionales).sort().join(" y ")})`);
}
