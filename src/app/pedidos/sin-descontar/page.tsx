import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { db } from "@/lib/db";
import { getRegularizados, getSinDescontar } from "@/lib/wix/queries";
import { descartarItemWix, descontarItemWix } from "@/lib/wix/actions";
import { fmtDateTime, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string };

const canal = (c: string | null) => (c === "POS" ? "Local (POS) → sale del Store" : "Web → sale del Depósito");

export default async function SinDescontarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireSection("pedidos");
  const sp = await searchParams;
  const puedeDescartar = user.role === "ADMIN" || user.role === "MANAGER";
  const [pendientes, historial, prods] = await Promise.all([
    getSinDescontar(),
    getRegularizados(),
    db().from("products").select("sku, name").eq("active", true).order("name"),
  ]);
  const productos = (prods.data ?? []) as { sku: string; name: string }[];

  return (
    <div>
      <div className="mb-1 text-sm">
        <Link href="/pedidos" className="text-rose-deep hover:underline">← Pedidos Wix</Link>
      </div>
      <PageTitle>Ventas sin descontar</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />
      <p className="mb-4 max-w-3xl text-sm text-soft">
        Ítems de pedidos Wix que <b>no se pudieron descontar</b>: el producto no tiene SKU en Wix, no tiene equivalencia o no
        había stock. La venta queda registrada acá hasta regularizarla. <b>Descontar</b>: elegís el producto de Melania y sale
        del stock con el N° de pedido como motivo (si todavía no hay stock cargado, avisa y queda pendiente).{" "}
        <b>Descartar</b>: no se descuenta, pero queda registrado quién y por qué. Si el producto no existe en Melania, crealo
        primero en <Link href="/productos" className="text-rose-deep hover:underline">Productos</Link>.
      </p>

      <datalist id="productos">
        {productos.map((p) => (
          <option key={p.sku} value={`${p.sku} · ${p.name}`} />
        ))}
      </datalist>

      <h2 className="mb-2 font-semibold">Pendientes ({pendientes.length})</h2>
      <div className="space-y-3">
        {pendientes.map((p) => (
          <Card key={p.item_id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/pedidos/${p.order_id}`} className="font-semibold text-rose-deep hover:underline">
                Pedido #{p.number ?? "—"}
              </Link>
              <span className="text-xs text-soft">
                {canal(p.channel_type)} · {p.ordered_at ? fmtDateTime(p.ordered_at) : "—"}
                {p.customer ? ` · ${p.customer}` : ""}
              </span>
            </div>
            <div className="mt-1">
              <span className="font-medium">{p.name ?? "Ítem sin nombre"}</span> × {fmtQty(p.quantity)}
              <span className="ml-2 text-xs text-soft">{p.external_sku ? `SKU Wix: ${p.external_sku}` : "sin SKU en Wix"}</span>
            </div>
            {p.note && <div className="mt-1 text-xs font-medium text-amber-800">⚠ {p.note}</div>}

            <form action={descontarItemWix} className="mt-3 grid gap-2 sm:grid-cols-[1fr_7rem_1fr_auto] sm:items-end">
              <input type="hidden" name="item" value={p.item_id} />
              <div>
                <label className={label}>Producto de Melania *</label>
                <input name="producto" list="productos" required placeholder="Buscá por nombre o SKU…" className={input} />
              </div>
              <div>
                <label className={label}>Cantidad *</label>
                <input type="number" name="cantidad" min="0.001" step="any" required defaultValue={p.quantity} className={input} />
              </div>
              <div>
                <label className={label}>Nota</label>
                <input name="nota" placeholder="Opcional" className={input} />
              </div>
              <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
                Descontar
              </SubmitButton>
            </form>

            {puedeDescartar && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-soft hover:text-ink">Descartar sin descontar</summary>
                <form action={descartarItemWix} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="item" value={p.item_id} />
                  <input name="motivo" required minLength={3} placeholder="Motivo (obligatorio)" className={`${input} max-w-sm`} />
                  <SubmitButton className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-blush-50">
                    Descartar
                  </SubmitButton>
                </form>
              </details>
            )}
          </Card>
        ))}
        {pendientes.length === 0 && <Card>No hay ventas sin descontar. 🎉</Card>}
      </div>

      <h2 className="mb-2 mt-6 font-semibold">Regularizadas (últimas 50)</h2>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Cuándo</th>
                <th className={th}>Pedido</th>
                <th className={th}>Ítem de Wix</th>
                <th className={th}>Resultado</th>
                <th className={th}>Quién</th>
                <th className={th}>Nota</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id} className="border-b border-blush-100">
                  <td className={td}>{fmtDateTime(h.settled_at)}</td>
                  <td className={td}>
                    <Link href={`/pedidos/${h.order.id}`} className="text-rose-deep hover:underline">#{h.order.number ?? "—"}</Link>
                  </td>
                  <td className={td}>
                    {h.name ?? "—"} × {fmtQty(h.quantity)}
                  </td>
                  <td className={td}>
                    {h.settled_action === "DESCONTADO" ? (
                      <span>
                        Descontado: {h.product?.name ?? "—"} × {fmtQty(h.settled_quantity ?? 0)}
                      </span>
                    ) : (
                      <span className="text-soft">Descartado</span>
                    )}
                  </td>
                  <td className={td}>{h.settled_by}</td>
                  <td className={td}>{h.settled_note ?? "—"}</td>
                </tr>
              ))}
              {historial.length === 0 && (
                <tr>
                  <td className={td} colSpan={6}>Todavía no se regularizó ninguna.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
