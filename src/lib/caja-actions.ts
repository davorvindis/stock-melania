"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { requireSection } from "./auth";
import { respaldarMes } from "./caja-excel";

const monto = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : NaN;
});
const texto = z.string().max(500).optional().nullable();

const datosSchema = z.object({
  opening_cash: monto,
  surplus: monto,
  counters: z.record(z.string(), z.string().max(100)).default({}),
  tasks: z.string().max(5000).optional().nullable(),
  notes: texto,
  lines: z
    .array(
      z.object({
        kind: z.enum(["MINORISTA", "MAYORISTA"]),
        order_ref: texto, customer: texto, description: texto,
        cash: monto, money_in: monto, posnet: monto, mp_link: monto, transfer: monto, usd: monto,
        account: texto, invoice: texto,
      })
    )
    .max(300),
  expenses: z
    .array(z.object({ amount: monto, currency: z.enum(["ARS", "USD"]), description: texto, from_petty_cash: z.boolean() }))
    .max(100),
});

// guarda el cierre del día (borrador) o lo envía (aviso a Joel y Mel + respaldo Excel del mes)
export async function guardarCierre(formData: FormData) {
  const user = await requireSection("caja");
  const fecha = String(formData.get("fecha") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) redirect("/caja?error=" + encodeURIComponent("Fecha inválida"));
  const back = `/caja/${fecha}`;
  const fallar: (msg: string) => never = (msg) => redirect(`${back}?error=${encodeURIComponent(msg)}`);
  const enviar = formData.get("accion") === "enviar";

  let crudo: unknown;
  try {
    crudo = JSON.parse(String(formData.get("datos") ?? "{}"));
  } catch {
    fallar("No se pudieron leer los datos del cierre");
  }
  const parsed = datosSchema.safeParse(crudo);
  if (!parsed.success) fallar("Revisá los datos: " + parsed.error.issues[0].message);
  const d = parsed.data;
  // renglones totalmente vacíos no se guardan
  const lines = d.lines.filter((l) =>
    [l.order_ref, l.customer, l.description, l.account, l.invoice].some((v) => v && v.trim()) ||
    [l.cash, l.money_in, l.posnet, l.mp_link, l.transfer, l.usd].some((v) => v != null)
  );
  lines.forEach((l, i) => {
    if ([l.cash, l.money_in, l.posnet, l.mp_link, l.transfer, l.usd].some((v) => Number.isNaN(v))) fallar(`Pago ${i + 1}: hay un monto que no es un número`);
  });
  if (enviar) {
    const venta = (l: (typeof lines)[number]) => (l.cash ?? 0) + (l.posnet ?? 0) + (l.mp_link ?? 0) + (l.transfer ?? 0);
    const sinCuenta = lines.filter((l) => venta(l) !== 0 && !(l.account ?? "").trim());
    if (sinCuenta.length)
      fallar(
        `Falta completar "¿Dónde ingresó el dinero?" en: ${sinCuenta
          .map((l) => l.customer || l.order_ref || "pago sin cliente")
          .join(", ")}. Si es efectivo, poné Caja fuerte o Caja chica. Podés guardar borrador y completarlo después.`
      );
  }
  const expenses = d.expenses.filter((g) => g.amount != null || (g.description ?? "").trim());
  expenses.forEach((g, i) => {
    if (g.amount == null || Number.isNaN(g.amount) || g.amount < 0) fallar(`Gasto ${i + 1}: falta el monto o no es válido`);
  });
  if ([d.opening_cash, d.surplus].some((v) => Number.isNaN(v))) fallar("La caja inicial o el sobrante no es un número");

  const { error } = await db().rpc("save_cash_closing", {
    p_date: fecha,
    p_data: { ...d, lines, expenses },
    p_submit: enviar,
    p_actor: user.alias,
  });
  if (error) fallar(error.message);

  let aviso = "";
  if (enviar) {
    try {
      await respaldarMes(fecha);
    } catch (e) {
      aviso = ` (atención: no se pudo guardar el respaldo en Excel: ${(e as Error).message})`;
    }
  }
  revalidatePath("/", "layout");
  redirect(`${back}?ok=${encodeURIComponent((enviar ? "Cierre enviado: Joel y Mel ya lo pueden ver" : "Borrador guardado") + aviso)}`);
}
