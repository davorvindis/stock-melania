import { db } from "./db";
import type { LotStatus } from "./types";

export type BalanceRow = {
  id: string;
  quantity: number;
  product: { id: string; sku: string; name: string; unit: string; min_stock: number; type: string };
  lot: { id: string; code: string; status: LotStatus; expires_on: string | null } | null;
  location: { id: string; name: string; is_quarantine: boolean };
};

export async function getBalances(): Promise<BalanceRow[]> {
  const { data, error } = await db()
    .from("stock_balances")
    .select(
      "id, quantity, product:products(id, sku, name, unit, min_stock, type), lot:lots(id, code, status, expires_on), location:locations(id, name, is_quarantine)"
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

// ── Historial de movimientos con filtros y paginado (en la base, no en memoria) ──

export type FiltrosMovimientos = {
  q?: string;
  tipo?: string;
  desde?: string; // YYYY-MM-DD (día argentino)
  hasta?: string;
  ubicacion?: string;
  sort?: string;
  dir?: string;
};

const MOV_SELECT =
  "id, occurred_at, type, quantity, actor, reason, reversal_of, product:products(sku, name, unit), lot:lots(code), from_location:locations!inventory_movements_from_location_id_fkey(name), to_location:locations!inventory_movements_to_location_id_fkey(name)";

const esFecha = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const esUuid = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

// (async: devuelve el resultado ya ejecutado, con el rango pedido)
async function consultaMovimientos(f: FiltrosMovimientos, desde: number, hasta: number, opts: { count?: boolean } = {}) {
  let q = db()
    .from("inventory_movements")
    .select(MOV_SELECT, opts.count ? { count: "exact" } : undefined);
  if (f.tipo) q = q.eq("type", f.tipo);
  if (esFecha(f.desde)) q = q.gte("occurred_at", `${f.desde}T00:00:00-03:00`);
  if (esFecha(f.hasta)) q = q.lte("occurred_at", `${f.hasta}T23:59:59.999-03:00`);
  if (esUuid(f.ubicacion)) q = q.or(`from_location_id.eq.${f.ubicacion},to_location_id.eq.${f.ubicacion}`);
  const texto = (f.q ?? "").replace(/[,()*%\\]/g, " ").trim();
  if (texto) {
    // producto/lote por nombre, SKU o código; motivo y persona directo
    const [prods, lotes] = await Promise.all([
      db().from("products").select("id").or(`name.ilike.%${texto}%,sku.ilike.%${texto}%`).limit(500),
      db().from("lots").select("id").ilike("code", `%${texto}%`).limit(500),
    ]);
    const condiciones = [`reason.ilike.%${texto}%`, `actor.ilike.%${texto}%`];
    const pIds = (prods.data ?? []).map((p) => p.id);
    const lIds = (lotes.data ?? []).map((l) => l.id);
    if (pIds.length) condiciones.push(`product_id.in.(${pIds.join(",")})`);
    if (lIds.length) condiciones.push(`lot_id.in.(${lIds.join(",")})`);
    q = q.or(condiciones.join(","));
  }
  const col = f.sort === "cantidad" ? "quantity" : f.sort === "tipo" ? "type" : "occurred_at";
  const asc = f.sort ? f.dir !== "desc" : false;
  q = q.order(col, { ascending: asc });
  if (col !== "occurred_at") q = q.order("occurred_at", { ascending: false });
  return await q.range(desde, hasta);
}

export async function buscarMovimientos(f: FiltrosMovimientos, pagina: number, porPagina: number) {
  const desde = (pagina - 1) * porPagina;
  const { data, error, count } = await consultaMovimientos(f, desde, desde + porPagina - 1, { count: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as MovementRow[];
  // cuáles de esta página ya fueron revertidos
  const ids = rows.map((m) => m.id);
  const { data: rev } = ids.length
    ? await db().from("inventory_movements").select("reversal_of").in("reversal_of", ids)
    : { data: [] };
  return {
    rows,
    total: count ?? 0,
    revertidos: new Set((rev ?? []).map((r) => r.reversal_of as string)),
  };
}

// todos los que coinciden (para el Excel), en tandas de 1000
export async function todosLosMovimientos(f: FiltrosMovimientos): Promise<MovementRow[]> {
  const out: MovementRow[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consultaMovimientos(f, desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as MovementRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

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

// categorías de la auditoría → prefijos de acción
export const CATEGORIAS_AUDITORIA: Record<string, { label: string; prefijos: string[] }> = {
  movimientos: { label: "Movimientos de stock", prefijos: ["movement:"] },
  ingresos: { label: "Ingresos", prefijos: ["stock_entry:"] },
  productos: { label: "Productos y kits", prefijos: ["product:", "kit:"] },
  lotes: { label: "Lotes", prefijos: ["lot:"] },
  conteos: { label: "Conteos", prefijos: ["count:"] },
  usuarios: { label: "Usuarios y PIN", prefijos: ["user:"] },
  compras: { label: "Compras, costos y proveedores", prefijos: ["purchase_order:", "cost:", "supplier:", "import:"] },
  sistema: { label: "Ubicaciones, backups y sistema", prefijos: ["location:", "backup:", "system:"] },
};

export type MovimientoAuditado = {
  id: string;
  type: string;
  quantity: number;
  reason: string | null;
  notes: string | null;
  product: { name: string; sku: string; unit: string } | null;
  lot: { code: string } | null;
  from_location: { name: string } | null;
  to_location: { name: string } | null;
};

export async function getAuditoria(
  f: { persona?: string; categoria?: string; desde?: string; hasta?: string; q?: string },
  pagina: number,
  porPagina: number
) {
  let q = db()
    .from("audit_logs")
    .select("id, at, actor, action, entity, entity_id, detail", { count: "exact" })
    .order("at", { ascending: false });
  if (f.persona) q = q.eq("actor", f.persona);
  const cat = f.categoria ? CATEGORIAS_AUDITORIA[f.categoria] : null;
  if (cat) q = q.or(cat.prefijos.map((p) => `action.like.${p}*`).join(","));
  if (f.desde && /^\d{4}-\d{2}-\d{2}$/.test(f.desde)) q = q.gte("at", `${f.desde}T00:00:00-03:00`);
  if (f.hasta && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) q = q.lte("at", `${f.hasta}T23:59:59.999-03:00`);
  const desde = (pagina - 1) * porPagina;
  const { data, error, count } = await q.range(desde, desde + porPagina - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as AuditRow[];

  // detalle de los movimientos de esta página (producto, ubicaciones, N° de pedido…)
  const movIds = rows.filter((r) => r.action.startsWith("movement:") && r.entity_id).map((r) => r.entity_id!);
  const movimientos = new Map<string, MovimientoAuditado>();
  if (movIds.length) {
    const { data: movs } = await db()
      .from("inventory_movements")
      .select(
        "id, type, quantity, reason, notes, product:products(name, sku, unit), lot:lots(code), from_location:locations!inventory_movements_from_location_id_fkey(name), to_location:locations!inventory_movements_to_location_id_fkey(name)"
      )
      .in("id", movIds);
    for (const m of (movs ?? []) as unknown as MovimientoAuditado[]) movimientos.set(m.id, m);
  }
  return { rows, total: count ?? 0, movimientos };
}

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
