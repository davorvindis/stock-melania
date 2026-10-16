import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { can, requireUser } from "@/lib/auth";
import { propuestaReparto } from "@/lib/preventa";
import { entregarPreventas } from "@/lib/preventa-actions";
import { fmtDate, fmtQty } from "@/lib/types";
import { Card, Flash, PageTitle, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

const volverSeguro = (v?: string) =>
  v && /^\/(preventa|ingresos\/nuevo|compras\/[0-9a-f-]{36})(\?[\w=&%-]*)?$/.test(v) ? v : "/ingresos/nuevo";

// Después de un ingreso: lo que entró se reparte entre las preventas pendientes
export default async function Repartir({
  searchParams,
}: {
  searchParams: Promise<{ ingreso?: string; volver?: string; ok?: string; error?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, "preventa") && !can(user, "ingresos")) redirect("/");
  const sp = await searchParams;
  const volver = volverSeguro(sp.volver);
  const r = sp.ingreso && /^[0-9a-f-]{36}$/i.test(sp.ingreso) ? await propuestaReparto(sp.ingreso) : null;
  if (!r || r.productos.length === 0) redirect(`${volver}${volver.includes("?") ? "&" : "?"}ok=${encodeURIComponent(sp.ok ?? "Listo")}`);
  const back = `/preventa/repartir?ingreso=${sp.ingreso}&volver=${encodeURIComponent(volver)}`;

  return (
    <div className="max-w-4xl">
      <PageTitle>Preventas para repartir</PageTitle>
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="mb-4 border-amber-200 bg-amber-50">
        <p className="text-sm">
          En este ingreso entraron productos que ya tienen <b>preventas pendientes</b>. Te armamos el reparto empezando por las
          preventas más viejas: revisá las cantidades y confirmá. Cada entrega se registra como <b>venta</b> desde la
          ubicación donde entró la mercadería.
        </p>
      </Card>

      <form action={entregarPreventas} className="space-y-4">
        <input type="hidden" name="ingreso" value={sp.ingreso} />
        <input type="hidden" name="idem" value={randomUUID()} />
        <input type="hidden" name="volver" value={volver} />
        <input type="hidden" name="back" value={back} />
        {r.productos.map((p) => {
          const asignado = p.asignaciones.reduce((s, a) => s + a.quantity, 0);
          return (
            <Card key={p.id}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{p.nombre}</h2>
                <span className="text-sm text-soft">
                  Ingresaron <b className="text-ink">{fmtQty(p.ingresado)}</b> · prevendidas pendientes{" "}
                  <b className="text-ink">{fmtQty(p.prevendido)}</b>
                  {p.prevendido > p.ingresado && (
                    <span className="text-amber-700"> · alcanza para {fmtQty(asignado)}: el resto sigue pendiente</span>
                  )}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th className={th}>Cliente</th>
                      <th className={th}>Pedido</th>
                      <th className={th}>Fecha preventa</th>
                      <th className={th}>Pendiente</th>
                      <th className={th}>Desde</th>
                      <th className={th}>Entregar ahora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.asignaciones.map((a, i) => (
                      <tr key={`${a.line_id}-${i}`} className="border-b border-blush-100">
                        <td className={`${td} font-medium`}>{a.customer}</td>
                        <td className={td}>{a.order_ref ?? "—"}</td>
                        <td className={td}>{fmtDate(a.order_date)}</td>
                        <td className={td}>
                          {fmtQty(a.pendiente)} {p.unidad}
                        </td>
                        <td className={`${td} text-xs text-soft`}>
                          {a.location_name}
                          {a.lot_code ? ` · lote ${a.lot_code}` : ""}
                        </td>
                        <td className={td}>
                          <input type="hidden" name="al_line" value={a.line_id} />
                          <input type="hidden" name="al_lot" value={a.lot_id ?? ""} />
                          <input type="hidden" name="al_loc" value={a.location_id} />
                          <input
                            type="number"
                            name="al_qty"
                            min="0"
                            max={a.quantity}
                            step="any"
                            defaultValue={a.quantity}
                            aria-label={`Entregar a ${a.customer}`}
                            className="w-24 rounded-lg border border-line px-2 py-1.5 text-center font-semibold"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className="rounded-lg bg-rose-deep px-6 py-3 font-semibold text-white hover:bg-rose-deeper">
            Confirmar y registrar las ventas
          </SubmitButton>
          <Link href={volver} className="text-sm text-soft hover:text-ink">
            Ahora no (quedan pendientes)
          </Link>
        </div>
        <p className="text-xs text-soft">
          Poné 0 en lo que no quieras entregar todavía. Lo pendiente se puede entregar después desde la pestaña Preventa.
        </p>
      </form>
    </div>
  );
}
