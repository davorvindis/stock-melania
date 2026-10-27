import { ESTADOS_ENTREGA, ESTADOS_PEDIDO, type PedidoWix } from "@/lib/wix/queries";

export function badgeEstado(p: PedidoWix) {
  if (p.state === "PROCESSED" && p.delivery_status) {
    const c = p.delivery_status === "PICKED_UP" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800";
    return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c}`}>{ESTADOS_ENTREGA[p.delivery_status]}</span>;
  }
  const color =
    p.state === "RESERVED" || p.state === "PARTIAL"
      ? "bg-amber-100 text-amber-800"
      : p.state === "PROCESSED"
        ? "bg-emerald-100 text-emerald-800"
        : p.state === "CANCELED" || p.state === "RELEASED"
          ? "bg-gray-100 text-gray-700"
          : "bg-blush-100 text-ink";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{ESTADOS_PEDIDO[p.state]}</span>;
}

// pagado hace más de 3 días y todavía sin procesar
export function demorado(p: PedidoWix): boolean {
  return (p.state === "RESERVED" || p.state === "PARTIAL") && !!p.paid_at && Date.now() - new Date(p.paid_at).getTime() > 3 * 86400_000;
}

// método de entrega de Wix → grupo para armar (la moto pasa ~13 h, el correo hasta 18 h)
export type Entrega = { clave: "MOTO" | "CORREO" | "RETIRO" | "OTRO" | "NINGUNA"; label: string; orden: number; color: string };
export function metodoEntrega(p: PedidoWix): Entrega {
  const t = (p.envio_titulo ?? "").toLowerCase();
  if (!t) return { clave: "NINGUNA", label: "—", orden: 9, color: "" };
  if (t.includes("moto")) return { clave: "MOTO", label: "🛵 Motomensajería", orden: 1, color: "bg-rose-100 text-rose-800" };
  if (t.includes("correo")) return { clave: "CORREO", label: "📦 Correo Argentino", orden: 2, color: "bg-sky-100 text-sky-800" };
  if (t.includes("retiro") || t.includes("sucursal")) return { clave: "RETIRO", label: "🏬 Retiro en sucursal", orden: 3, color: "bg-emerald-100 text-emerald-800" };
  return { clave: "OTRO", label: p.envio_titulo!.trim(), orden: 4, color: "bg-blush-100 text-ink" };
}

export function badgeEntrega(p: PedidoWix) {
  const e = metodoEntrega(p);
  if (e.clave === "NINGUNA") return <span className="text-soft">—</span>;
  return (
    <span title={p.envio_titulo ?? ""} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${e.color}`}>
      {e.label}
    </span>
  );
}
