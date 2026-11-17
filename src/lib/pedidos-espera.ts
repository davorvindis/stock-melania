import "server-only";
import { db } from "./db";

// Pedidos "en espera": no se despachan a propósito (ej. mayorista que espera otro producto para
// mandar todo junto). Para cada producto que se espera se mira si entró al lugar de donde sale
// el pedido (Depósito) desde que se puso en espera.

export const ESTADOS_CON_ESPERA = ["RESERVED", "PARTIAL", "PROCESSED"] as const;

// movimientos que traen producto al lugar: ingreso, transferencia, armado de kit, liberación de cuarentena
const TIPOS_INGRESO = ["RECEIPT", "TRANSFER", "KIT_ASSEMBLY", "QUARANTINE_RELEASE", "RETURN_IN"];

export type ProductoEsperado = { id: string; name: string; ingreso: number; disponible: number };
export type PedidoEnEspera = {
  id: string;
  number: string | null;
  customer: string | null;
  wholesale: boolean;
  state: string;
  hold_reason: string | null;
  hold_since: string;
  hold_by: string | null;
  location: { id: string; name: string } | null;
  esperados: ProductoEsperado[];
  yaIngreso: boolean; // entró al menos uno de los productos esperados
};

export async function getPedidosEnEspera(): Promise<PedidoEnEspera[]> {
  const cli = db();
  const { data, error } = await cli
    .from("channel_orders")
    .select("id, number, customer, wholesale, state, hold_reason, hold_since, hold_by, hold_products, location:locations(id, name)")
    .not("hold_since", "is", null)
    .is("delivery_status", null)
    .in("state", [...ESTADOS_CON_ESPERA])
    .order("hold_since");
  if (error) throw new Error(error.message);
  const pedidos = (data ?? []) as unknown as (Omit<PedidoEnEspera, "esperados" | "yaIngreso"> & { hold_products: string[] })[];
  const ids = [...new Set(pedidos.flatMap((p) => p.hold_products ?? []))];
  if (ids.length === 0) return pedidos.map((p) => ({ ...p, esperados: [], yaIngreso: false }));

  const desde = pedidos.reduce((m, p) => (p.hold_since < m ? p.hold_since : m), pedidos[0].hold_since);
  const [prods, movs, disp] = await Promise.all([
    cli.from("products").select("id, name").in("id", ids),
    cli
      .from("inventory_movements")
      .select("product_id, to_location_id, quantity, occurred_at")
      .in("product_id", ids)
      .in("type", TIPOS_INGRESO)
      .not("to_location_id", "is", null)
      .gte("occurred_at", desde),
    cli.from("v_stock_disponible").select("product_id, location_id, available").in("product_id", ids),
  ]);
  for (const r of [prods, movs, disp]) if (r.error) throw new Error(r.error.message);
  const nombre = new Map((prods.data ?? []).map((p) => [p.id as string, p.name as string]));

  return pedidos.map((p) => {
    const loc = p.location?.id;
    const esperados = (p.hold_products ?? []).map((pid) => {
      const ingreso = (movs.data ?? [])
        .filter((m) => m.product_id === pid && m.to_location_id === loc && m.occurred_at >= p.hold_since)
        .reduce((s, m) => s + Number(m.quantity), 0);
      const disponible = (disp.data ?? [])
        .filter((d) => d.product_id === pid && d.location_id === loc)
        .reduce((s, d) => s + Math.max(0, Number(d.available)), 0);
      return { id: pid, name: nombre.get(pid) ?? "Producto", ingreso, disponible };
    });
    return { ...p, esperados, yaIngreso: esperados.some((e) => e.ingreso > 0) };
  });
}
