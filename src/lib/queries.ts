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

// ── Lotes ───────────────────────────────────────────────────────────

export type LotRow = {
  id: string;
  code: string;
  status: LotStatus;
  manufactured_on: string | null;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
  product: { id: string; sku: string; name: string; unit: string };
};

export async function getLots(): Promise<LotRow[]> {
  const { data, error } = await db()
    .from("lots")
    .select("id, code, status, manufactured_on, expires_on, notes, created_at, product:products(id, sku, name, unit)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LotRow[];
}

export async function getLotDetail(id: string) {
  const cli = db();
  const [lot, movements, balances, entryLines] = await Promise.all([
    cli
      .from("lots")
      .select("id, code, status, manufactured_on, expires_on, notes, created_at, product:products(id, sku, name, unit)")
      .eq("id", id)
      .single(),
    cli
      .from("inventory_movements")
      .select(
        "id, occurred_at, type, quantity, actor, reason, reversal_of, product:products(sku, name, unit), lot:lots(code), from_location:locations!inventory_movements_from_location_id_fkey(name), to_location:locations!inventory_movements_to_location_id_fkey(name)"
      )
      .eq("lot_id", id)
      .order("occurred_at", { ascending: false }),
    cli
      .from("stock_balances")
      .select("quantity, location:locations(name, is_quarantine)")
      .eq("lot_id", id)
      .gt("quantity", 0),
    cli
      .from("stock_entry_lines")
      .select("quantity, unit_cost, total_cost, entry:stock_entries(entry_date, remito, invoice, actor, supplier:suppliers(name))")
      .eq("lot_id", id),
  ]);
  if (lot.error) throw new Error(lot.error.message);
  return {
    lot: lot.data as unknown as LotRow,
    movements: (movements.data ?? []) as unknown as MovementRow[],
    balances: (balances.data ?? []) as unknown as { quantity: number; location: { name: string; is_quarantine: boolean } }[],
    entryLines: (entryLines.data ?? []) as unknown as {
      quantity: number;
      unit_cost: number | null;
      total_cost: number | null;
      entry: { entry_date: string; remito: string | null; invoice: string | null; actor: string | null; supplier: { name: string } | null };
    }[],
  };
}

// ── Conteos ─────────────────────────────────────────────────────────

export type CountRow = {
  id: string;
  status: "OPEN" | "CLOSED" | "APPROVED" | "REJECTED";
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  location: { id: string; name: string };
};

export type CountLine = {
  id: string;
  expected: number;
  counted: number | null;
  product: { sku: string; name: string; unit: string };
  lot: { code: string } | null;
};

export async function getCounts(): Promise<CountRow[]> {
  const { data, error } = await db()
    .from("inventory_counts")
    .select("id, status, opened_by, opened_at, closed_by, closed_at, reviewed_by, reviewed_at, review_reason, location:locations(id, name)")
    .order("opened_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CountRow[];
}

export async function getCountDetail(id: string) {
  const cli = db();
  const [count, lines] = await Promise.all([
    cli
      .from("inventory_counts")
      .select("id, status, opened_by, opened_at, closed_by, closed_at, reviewed_by, reviewed_at, review_reason, location:locations(id, name)")
      .eq("id", id)
      .single(),
    cli
      .from("inventory_count_lines")
      .select("id, expected, counted, product:products(sku, name, unit), lot:lots(code)")
      .eq("count_id", id)
      .order("id"),
  ]);
  if (count.error) throw new Error(count.error.message);
  return {
    count: count.data as unknown as CountRow,
    lines: (lines.data ?? []) as unknown as CountLine[],
  };
}

// ── Auditoría ───────────────────────────────────────────────────────

export type AuditRow = {
  id: string;
  at: string;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
};

export async function getAuditLogs(limit = 200): Promise<AuditRow[]> {
  const { data, error } = await db()
    .from("audit_logs")
    .select("id, at, actor, action, entity, entity_id, detail")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AuditRow[];
}

// entradas (ingreso externo) vs salidas (egreso externo) por día — transferencias internas no cuentan
export async function getDailyFlow(days = 14) {
  // buckets por día calendario argentino, terminando en HOY (el server corre en UTC)
  const since = new Date(Date.now() - days * 86400000);
  const { data, error } = await db()
    .from("inventory_movements")
    .select("occurred_at, quantity, from_location_id, to_location_id")
    .gte("occurred_at", since.toISOString())
    .neq("type", "LOT_ASSIGNMENT"); // reclasificación de lote: no es entrada ni salida
  if (error) throw new Error(error.message);
  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
  });
  const buckets = new Map<string, { label: string; inQty: number; outQty: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const label = fmt.format(new Date(Date.now() - i * 86400000));
    buckets.set(label, { label, inQty: 0, outQty: 0 });
  }
  for (const m of data ?? []) {
    const label = fmt.format(new Date(m.occurred_at));
    const b = buckets.get(label);
    if (!b) continue;
    if (!m.from_location_id && m.to_location_id) b.inQty += Number(m.quantity);
    if (m.from_location_id && !m.to_location_id) b.outQty += Number(m.quantity);
  }
  return [...buckets.values()];
}

export async function getKits() {
  const { data, error } = await db()
    .from("products")
    .select("id, sku, name")
    .eq("type", "KIT")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getKitComponents(kitId: string) {
  const { data, error } = await db()
    .from("kit_components")
    .select("id, quantity, component:products!kit_components_component_id_fkey(id, sku, name, unit)")
    .eq("kit_id", kitId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as {
    id: string;
    quantity: number;
    component: { id: string; sku: string; name: string; unit: string };
  }[];
}
