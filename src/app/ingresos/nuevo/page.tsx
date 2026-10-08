import { SubmitButton } from "@/components/submit-button";
import { requireSection, ubicacionFija, can } from "@/lib/auth";
import Link from "next/link";
import { getOrden } from "@/lib/compras";
import { randomUUID } from "crypto";
import { getProducts, getLocations, getSuppliers } from "@/lib/queries";
import { registrarIngreso } from "@/lib/actions";
import { Card, Flash, PageTitle, input, label, button } from "@/components/ui";
import { LineasIngreso, type LineaInicial } from "@/components/lineas-ingreso";

export const dynamic = "force-dynamic";

export default async function NuevoIngreso({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; oc?: string }>;
}) {
  const user = await requireSection("ingresos");
  const { ok, error, oc } = await searchParams;
  // recibir una orden de compra: precarga proveedor y lo que falta recibir
  const orden =
    oc && can(user, "compras") && /^[0-9a-f-]{36}$/i.test(oc) ? await getOrden(oc) : null;
  const inicial: LineaInicial[] = (orden?.lines ?? [])
    .map((l) => ({ l, falta: l.quantity ? Number(l.quantity) - Number(l.received_qty) : 0 }))
    .filter(({ l, falta }) => !l.quantity || falta > 0)
    .map(({ l, falta }) => ({
      producto: l.product_id ?? "",
      cantidad: falta > 0 ? String(falta) : "",
      costo: l.unit_cost != null ? String(l.unit_cost) : "",
      ocLinea: l.id,
      detalle: `${l.description}${l.kind ? ` (${l.kind})` : ""}${l.quantity ? ` · pedidas ${l.quantity}, recibidas ${l.received_qty}` : ""}`,
    }));
  const [products, locations, suppliers] = await Promise.all([
    getProducts(),
    getLocations(),
    getSuppliers(),
  ]);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const opcionesProductos = products
    .filter((p) => p.active && p.type !== "KIT")
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.sku} · ${p.unit}` }));

  return (
    <div className="max-w-3xl">
      <PageTitle>Nuevo ingreso de stock</PageTitle>
      <Flash ok={ok} error={error} />
      {orden && (
        <p className="mb-3 rounded-lg border border-blush-100 bg-white px-3 py-2 text-sm">
          Recibiendo la orden de compra a <b>{orden.supplier.name}</b> del {orden.order_date.split("-").reverse().join("/")}.
          Ajustá las cantidades a lo que llegó realmente y quitá lo que no vino.{" "}
          <Link href={`/compras/${orden.id}`} className="font-medium text-rose-deep hover:underline">
            Ver orden
          </Link>
        </p>
      )}
      <Card>
        <form action={registrarIngreso} className="space-y-4">
          <input type="hidden" name="idem" value={randomUUID()} />
          {orden && <input type="hidden" name="oc" value={orden.id} />}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Fecha de ingreso *</label>
              <input type="date" name="fecha" defaultValue={hoy} required className={input} />
            </div>

            <div>
              <label className={label}>N° remito</label>
              <input type="text" name="remito" className={input} />
            </div>
            <div>
              <label className={label}>N° factura</label>
              <input type="text" name="factura" className={input} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Proveedor</label>
              <select name="proveedor" defaultValue={orden?.supplier.id ?? ""} className={input}>
                <option value="">Sin proveedor</option>
                {suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className={label}>Ubicación destino *</label>
              <select name="ubicacion" required defaultValue={user.location_id ?? ""} className={input}>
                <option value="">Elegir ubicación…</option>
                {locations
                  .filter((l) => !ubicacionFija(user) || l.id === ubicacionFija(user))
                  .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>Productos *</label>
            <LineasIngreso productos={opcionesProductos} inicial={inicial} />
          </div>

          <div>
            <label className={label}>Observaciones</label>
            <textarea name="notas" rows={2} className={input} />
          </div>

          <SubmitButton className={`${button} w-full sm:w-auto`}>
            Confirmar ingreso
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
