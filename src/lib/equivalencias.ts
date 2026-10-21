import "server-only";
import { db } from "./db";

// Equivalencias SKU de Wix → productos nuestros (qué descuenta cada venta de Wix)
export type Equivalencia = {
  id: string;
  channel: string;
  external_sku: string;
  label: string | null;
  option_label: string | null;
  active: boolean;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
  lines: { id: string; quantity: number; product: { id: string; sku: string; name: string; unit: string; type: string; active: boolean } }[];
};

const SELECT =
  "id, channel, external_sku, label, option_label, active, notes, updated_by, updated_at, lines:channel_sku_lines(id, quantity, product:products(id, sku, name, unit, type, active))";

export async function getEquivalencias(): Promise<Equivalencia[]> {
  const { data, error } = await db().from("channel_skus").select(SELECT).order("external_sku");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Equivalencia[];
}

export async function getEquivalencia(id: string): Promise<Equivalencia | null> {
  const { data, error } = await db().from("channel_skus").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as Equivalencia | null;
}

// combo/pack: descuenta más de un producto o más de una unidad
export const esCombo = (e: Equivalencia) => e.lines.length > 1 || e.lines.some((l) => Number(l.quantity) !== 1);
