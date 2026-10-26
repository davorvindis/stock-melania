import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { getPedidosWix, type PedidoWix } from "@/lib/wix/queries";
import { badgeEstado, demorado } from "@/components/pedido-badge";
import { fmtDateTime, fmtMoney } from "@/lib/types";
import { actualizarPedidosAhora } from "@/lib/wix/actions";
import { Card, Flash, PageTitle, input, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; estado?: string; canal?: string; q?: string; desde?: string; hasta?: string; revisar?: string };

const ESTADOS: [string, string][] = [
  ["pendientes", "Para armar"],
  ["todos", "Todos"],
  ["PROCESSED", "Procesados"],
  ["RELEASED", "Liberados"],
  ["CANCELED", "Cancelados"],
  ["NEW", "Sin pagar"],
  ["IGNORED", "Ignorados"],
];

export default async function PedidosPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSection("pedidos");
  const sp = await searchParams;
  const estado = sp.estado ?? "pendientes";
  const pedidos = await getPedidosWix({
    estado: estado === "todos" ? undefined : estado,
    canal: sp.canal,
    q: sp.q,
    desde: sp.desde,
    hasta: sp.hasta,
    revisar: sp.revisar === "si",
  });
  const href = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const all = { ...sp, ...patch };
    for (const [k, v] of Object.entries(all)) if (v && k !== "ok" && k !== "error") p.set(k, v);
    return p.toString() ? `/pedidos?${p}` : "/pedidos";
  };
  const canal = (p: PedidoWix) => (p.channel_type === "POS" ? "Local (POS)" : p.channel_type === "BACKOFFICE_MERCHANT" ? "Manual Wix" : "Web");

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageTitle>Pedidos Wix</PageTitle>
        <form action={actualizarPedidosAhora}>
          <SubmitButton className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-rose-deep hover:bg-blush-50">
            ↻ Actualizar ahora
          </SubmitButton>
        </form>
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <p className="mb-4 max-w-3xl text-sm text-soft">
        Los pedidos pagados en la tienda web quedan <b>reservados</b> en Depósito. Cuando armás y despachás uno, entrá y marcalo
        como procesado: ahí sale del stock con tu usuario como responsable y Wix lo marca procesado solo. Las ventas del local
        (POS) se descuentan del Store al instante. Melania revisa Wix sola cada 5 minutos; si no ves un pedido, tocá{" "}
        <b>Actualizar ahora</b>.
      </p>

      <form method="get" className="mb-3 flex flex-wrap gap-2">
        <input type="hidden" name="estado" value={estado} />
        {sp.canal && <input type="hidden" name="canal" value={sp.canal} />}
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="N° de pedido, cliente o email…" className={`${input} max-w-xs`} />
        <input type="date" name="desde" defaultValue={sp.desde ?? ""} className={`${input} max-w-[11rem]`} />
        <input type="date" name="hasta" defaultValue={sp.hasta ?? ""} className={`${input} max-w-[11rem]`} />
        <button type="submit" className="shrink-0 rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white hover:bg-rose-deeper">
          Buscar
        </button>
      </form>
      <div className="mb-2 flex flex-wrap gap-2">
        {ESTADOS.map(([k, v]) => (
          <Link key={k} href={href({ estado: k, revisar: undefined })} className={`rounded-full px-3 py-1 text-sm ${estado === k && sp.revisar !== "si" ? "bg-blush font-semibold text-ink" : "bg-white text-soft hover:bg-blush-100"}`}>
            {v}
          </Link>
        ))}
        <Link href={href({ estado: "todos", revisar: "si" })} className={`rounded-full px-3 py-1 text-sm ${sp.revisar === "si" ? "bg-amber-200 font-semibold text-amber-900" : "bg-white text-amber-800 hover:bg-amber-50"}`}>
          ⚠ A revisar
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {[["", "Web y local"], ["WEB", "Solo web"], ["POS", "Solo local (POS)"]].map(([k, v]) => (
          <Link key={k} href={href({ canal: k || undefined })} className={`rounded-full px-3 py-1 ${(sp.canal ?? "") === k ? "bg-blush-100 font-semibold" : "text-soft hover:bg-blush-100"}`}>
            {v}
          </Link>
        ))}
      </div>

      <p className="mb-2 text-sm text-soft">{pedidos.length} pedido(s)</p>

      {/* mobile */}
      <div className="space-y-2 md:hidden">
        {pedidos.map((p) => (
          <Link key={p.id} href={`/pedidos/${p.id}`} className={`block rounded-xl border bg-white p-3 ${demorado(p) ? "border-red-300" : "border-blush-100"}`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">#{p.number ?? "—"}</span>
              {badgeEstado(p)}
            </div>
            <div className="text-sm">{p.customer ?? p.email ?? "—"}</div>
            <div className="text-xs text-soft">
              {canal(p)} · {p.ordered_at ? fmtDateTime(p.ordered_at) : "—"} · {fmtMoney(p.total)}
            </div>
            {p.processed_by && <div className="text-xs text-soft">Procesó: {p.processed_by}</div>}
            {demorado(p) && <div className="text-xs font-medium text-red-700">Pagado hace más de 3 días sin procesar</div>}
            {p.review_reason && <div className="text-xs font-medium text-amber-800">⚠ {p.review_reason}</div>}
          </Link>
        ))}
        {pedidos.length === 0 && <Card>No hay pedidos con esos filtros.</Card>}
      </div>

      {/* desktop */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>N°</th>
                <th className={th}>Fecha</th>
                <th className={th}>Canal</th>
                <th className={th}>Cliente</th>
                <th className={th}>Total</th>
                <th className={th}>Estado</th>
                <th className={th}>Responsable</th>
                <th className={th}>Aviso</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id} className={`border-b border-blush-100 ${demorado(p) ? "bg-red-50" : ""}`}>
                  <td className={`${td} font-semibold`}>
                    <Link href={`/pedidos/${p.id}`} className="text-rose-deep hover:underline">#{p.number ?? "—"}</Link>
                  </td>
                  <td className={td}>{p.ordered_at ? fmtDateTime(p.ordered_at) : "—"}</td>
                  <td className={td}>{canal(p)}</td>
                  <td className={td}>
                    {p.customer ?? "—"}
                    {p.email && <div className="text-xs text-soft">{p.email}</div>}
                  </td>
                  <td className={td}>{fmtMoney(p.total)}</td>
                  <td className={td}>
                    {badgeEstado(p)}
                    {demorado(p) && <div className="text-xs font-medium text-red-700">+3 días sin procesar</div>}
                  </td>
                  <td className={td}>{p.processed_by ?? ""}</td>
                  <td className={`${td} max-w-xs text-xs text-amber-800`}>{p.review_reason ?? ""}</td>
                </tr>
              ))}
              {pedidos.length === 0 && (
                <tr><td className={td} colSpan={8}>No hay pedidos con esos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
