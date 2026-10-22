import { ESTADOS_PEDIDO, type PedidoWix } from "@/lib/wix/queries";

export function badgeEstado(p: PedidoWix) {
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
