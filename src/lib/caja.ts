import "server-only";
import { db } from "./db";
import { totalesCierre, type GastoCaja, type LineaCaja } from "./caja-calc";

export type Cierre = {
  id: string;
  closing_date: string;
  status: "BORRADOR" | "ENVIADO";
  opening_cash: number;
  surplus: number;
  counters: Record<string, string>;
  tasks: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  updated_at: string;
  lines: (LineaCaja & { id: string; position: number })[];
  expenses: (GastoCaja & { id: string; position: number })[];
};

const SELECT =
  "id, closing_date, status, opening_cash, surplus, counters, tasks, notes, created_by, updated_by, submitted_by, submitted_at, updated_at, " +
  "lines:cash_closing_lines(id, kind, position, order_ref, customer, description, cash, money_in, posnet, mp_link, transfer, account, usd, invoice), " +
  "expenses:cash_closing_expenses(id, position, amount, currency, description, from_petty_cash)";

const ordenar = (c: Cierre): Cierre => ({
  ...c,
  opening_cash: Number(c.opening_cash),
  surplus: Number(c.surplus),
  lines: [...c.lines].sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === "MINORISTA" ? -1 : 1)),
  expenses: [...c.expenses].sort((a, b) => a.position - b.position),
});

export async function getCierre(fecha: string): Promise<Cierre | null> {
  const { data, error } = await db().from("cash_closings").select(SELECT).eq("closing_date", fecha).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? ordenar(data as unknown as Cierre) : null;
}

export async function getCierres(desde?: string, hasta?: string): Promise<Cierre[]> {
  let q = db().from("cash_closings").select(SELECT).order("closing_date", { ascending: false });
  if (desde) q = q.gte("closing_date", desde);
  if (hasta) q = q.lte("closing_date", hasta);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Cierre[]).map(ordenar);
}

export const totalesDe = (c: Cierre) => totalesCierre(c.lines, c.expenses, c.opening_cash, c.surplus);

// caja inicial sugerida = caja chica del último cierre anterior a esa fecha
export async function cajaInicialSugerida(fecha: string): Promise<{ monto: number; desde: string | null }> {
  const { data } = await db()
    .from("cash_closings")
    .select("closing_date")
    .lt("closing_date", fecha)
    .order("closing_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { monto: 0, desde: null };
  const anterior = await getCierre(data.closing_date);
  return { monto: anterior ? totalesDe(anterior).cajaChica : 0, desde: data.closing_date };
}

// cierres enviados que esta persona todavía no abrió (aviso para Joel y Mel)
export async function cierresSinVer(profileId: string) {
  const desde = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [{ data: enviados }, { data: vistos }] = await Promise.all([
    db()
      .from("cash_closings")
      .select("id, closing_date, submitted_by, submitted_at")
      .eq("status", "ENVIADO")
      .gte("closing_date", desde)
      .order("closing_date", { ascending: false }),
    db().from("cash_closing_views").select("closing_id").eq("profile_id", profileId),
  ]);
  const ya = new Set((vistos ?? []).map((v) => v.closing_id));
  return (enviados ?? []).filter((c) => !ya.has(c.id));
}

export async function marcarVisto(closingId: string, profileId: string) {
  await db().from("cash_closing_views").upsert({ closing_id: closingId, profile_id: profileId }, { onConflict: "closing_id,profile_id", ignoreDuplicates: true });
}
