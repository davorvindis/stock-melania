import { db } from "./db";
import type { LotStatus } from "./types";

export type BalanceRow = {
  id: string;
  quantity: number;
  product: { id: string; sku: string; name: string; unit: string; min_stock: number };
  lot: { id: string; code: string; status: LotStatus; expires_on: string | null } | null;
  location: { id: string; name: string; is_quarantine: boolean };
};

export async function getBalances(): Promise<BalanceRow[]> {
  const { data, error } = await db()
    .from("stock_balances")
    .select(
      "id, quantity, product:products(id, sku, name, unit, min_stock), lot:lots(id, code, status, expires_on), location:locations(id, name, is_quarantine)"
    )
    .gt("quantity", 0)
    .order("quantity", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BalanceRow[];
}

export type MovementRow = {
  id: string;
  occurred_at: string;
  type: string;
  quantity: number;
  actor: string | null;
  reason: string | null;
  reversal_of: string | null;
  product: { sku: string; name: string; unit: string };
  lot: { code: string } | null;
  from_location: { name: string } | null;
  to_location: { name: string } | null;
};

export async function getMovements(limit = 100): Promise<MovementRow[]> {
  const { data, error } = await db()
    .from("inventory_movements")
    .select(
      "id, occurred_at, type, quantity, actor, reason, reversal_of, product:products(sku, name, unit), lot:lots(code), from_location:locations!inventory_movements_from_location_id_fkey(name), to_location:locations!inventory_movements_to_location_id_fkey(name)"
    )
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MovementRow[];
}

export async function getProducts() {
  const { data, error } = await db()
    .from("products")
    .select("id, sku, name, category, unit, type, min_stock, active")
    .order("sku");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getLocations() {
  const { data, error } = await db()
    .from("locations")
    .select("id, name, is_quarantine")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSuppliers() {
  const { data, error } = await db()
    .from("suppliers")
    .select("id, name, cuit, contact, active")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

// disponible = stock en lotes liberados fuera de cuarentena
export function isAvailable(b: BalanceRow): boolean {
  const lotOk = !b.lot || b.lot.status === "ACTIVE";
  return lotOk && !b.location.is_quarantine;
}
