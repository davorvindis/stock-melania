import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { getProducts } from "@/lib/queries";
import {
  CATEGORIAS_PRECIO,
  DESCUENTOS,
  analizar,
  getCambios,
  getCondiciones,
  getCostosPorProducto,
  getItemsPrecio,
  hoyAR,
  pct,
  subaCostoDesde,
  vigenteEn,
} from "@/lib/precios";
import { eliminarCambioPrecio, guardarCondicionesMayoristas, guardarItemPrecio } from "@/lib/precios-actions";
import { nombreMes } from "@/lib/compras";
import { fmtDate } from "@/lib/types";
import { Card, Flash, PageTitle, input, label, th, td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ActualizarPrecios } from "@/components/actualizar-precios";

export const dynamic = "force-dynamic";

type SP = {
  ok?: string;
  error?: string;
  vista?: string;
  q?: string;
  cat?: string;
  may?: string;
  antig?: string;
  item?: string;
  mes?: string;
  anio?: string;
  canal?: string;
  editar?: string;
};

const pesos = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("es-AR")}`);
const fmtPct = (n: number | null, signo = true) =>
  n == null ? "—" : `${signo && n > 0 ? "+" : ""}${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
const hace = (d: number | null) =>
  d == null
    ? "—"
    : d < 31
      ? `${d} día${d === 1 ? "" : "s"}`
      : d < 365
        ? `${Math.floor(d / 30)} mes${Math.floor(d / 30) === 1 ? "" : "es"}`
        : `${(d / 365).toLocaleString("es-AR", { maximumFractionDigits: 1 })} años`;

const VISTAS = [
  ["lista", "Lista vigente"],
  ["historial", "Historial de cambios"],
  ["actualizar", "Actualizar precios"],
] as const;

export default async function Precios({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSection("precios");
  const sp = await searchParams;
  const vista = VISTAS.some(([v]) => v === sp.vista) ? sp.vista! : "lista";
  const hoy = hoyAR();
  const [items, cambios, condiciones, costos, productos] = await Promise.all([
    getItemsPrecio(),
    getCambios(),
    getCondiciones(),
    getCostosPorProducto(),
    getProducts(),
  ]);
  const cond = condiciones.find((c) => c.effective_date <= hoy) ?? condiciones[0];
  const porItem = new Map<string, typeof cambios>();
  for (const c of cambios) {
    if (!porItem.has(c.item_id)) porItem.set(c.item_id, []);
    porItem.get(c.item_id)!.push(c);
  }
  const nombreItem = new Map(items.map((i) => [i.id, i]));
  const editando = sp.editar ? nombreItem.get(sp.editar) : undefined;

  const filas = items
    .filter((i) => i.active)
    .map((i) => {
      const a = analizar(porItem.get(i.id) ?? [], hoy);
      return { ...i, ...a, subaCosto: i.product_id ? subaCostoDesde(costos.get(i.product_id), a.ultimaSuba) : null };
    });
  let lista = filas;
  if (sp.q) lista = lista.filter((f) => f.name.toLowerCase().includes(sp.q!.toLowerCase()));
  if (sp.cat) lista = lista.filter((f) => f.category === sp.cat);
  if (sp.may === "si") lista = lista.filter((f) => f.wholesale);
  if (sp.antig) lista = lista.filter((f) => (f.diasDesdeSuba ?? 0) >= Number(sp.antig) * 30);

  const ultimaActualizacion = cambios.filter((c) => c.effective_date <= hoy).at(-1)?.effective_date ?? null;
  const viejos = filas.filter((f) => f.lista != null && (f.diasDesdeSuba ?? 0) >= 120).length;
  const costoMasQuePrecio = filas.filter((f) => f.subaCosto != null && f.subaCosto > 0.5).length;
  const productosSistema = productos.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, "es"));

  // historial con filtros
  let historial = [...cambios].reverse();
  if (sp.item) historial = historial.filter((c) => c.item_id === sp.item);
  if (sp.canal) historial = historial.filter((c) => c.channel === sp.canal);
  if (sp.anio) historial = historial.filter((c) => c.effective_date.startsWith(sp.anio!));
  if (sp.mes) historial = historial.filter((c) => c.effective_date.startsWith(sp.mes!));
  if (sp.q && vista === "historial") historial = historial.filter((c) => nombreItem.get(c.item_id)?.name.toLowerCase().includes(sp.q!.toLowerCase()));
  const anios = [...new Set(cambios.map((c) => c.effective_date.slice(0, 4)))].sort().reverse();
  const meses = [...new Set(cambios.map((c) => c.effective_date.slice(0, 7)))].sort().reverse();
  const anteriorDe = (c: (typeof cambios)[number]) => {
    const lst = (porItem.get(c.item_id) ?? []).filter((x) => x.channel === c.channel);
    const i = lst.findIndex((x) => x.id === c.id);
    return i > 0 ? lst[i - 1].price : null;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Historial de precios</PageTitle>
        <div className="inline-flex rounded-lg border border-line bg-white p-1 text-sm">
          {VISTAS.map(([v, l]) => (
            <Link key={v} href={`/precios?vista=${v}`} className={`rounded-md px-3 py-1.5 font-medium ${vista === v ? "bg-rose-deep text-white" : "text-soft hover:text-ink"}`}>
              {l}
            </Link>
          ))}
        </div>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <div className="text-sm text-soft">Última actualización</div>
          <div className="mt-1 font-display text-3xl leading-none">{ultimaActualizacion ? fmtDate(ultimaActualizacion) : "—"}</div>
        </Card>
        <Card>
          <div className="text-sm text-soft">Productos con precio</div>
          <div className="mt-1 font-display text-3xl leading-none">{filas.filter((f) => f.lista != null).length}</div>
        </Card>
        <Card>
          <div className="text-sm text-soft">Sin subir hace 4 meses o más</div>
          <div className={`mt-1 font-display text-3xl leading-none ${viejos ? "text-amber-700" : ""}`}>{viejos}</div>
        </Card>
        <Card>
          <div className="text-sm text-soft">Subió el costo desde su última suba</div>
          <div className={`mt-1 font-display text-3xl leading-none ${costoMasQuePrecio ? "text-red-700" : ""}`}>{costoMasQuePrecio}</div>
        </Card>
      </div>

      {vista === "lista" && (
        <>
          <form method="get" className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="vista" value="lista" />
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar producto…" className={input} />
            <select name="cat" defaultValue={sp.cat ?? ""} aria-label="Categoría" className={input}>
              <option value="">Todas las categorías</option>
              {CATEGORIAS_PRECIO.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select name="may" defaultValue={sp.may ?? ""} aria-label="Mayorista" className={input}>
              <option value="">Todos</option>
              <option value="si">Solo listado mayorista</option>
            </select>
            <select name="antig" defaultValue={sp.antig ?? ""} aria-label="Antigüedad" className={input}>
              <option value="">Cualquier última suba</option>
              <option value="3">Sin subir hace 3+ meses</option>
              <option value="6">Sin subir hace 6+ meses</option>
              <option value="12">Sin subir hace 12+ meses</option>
            </select>
            <button type="submit" className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
              Filtrar
            </button>
          </form>

          <Card className="mb-4">
            <p className="mb-2 text-xs text-soft">
              <b>Mayorista</b>: precio con cada descuento sobre la lista
              {cond ? ` (20% desde ${pesos(cond.min_20)} · 30% desde ${pesos(cond.min_30)} · 40% desde ${pesos(cond.min_40)} de compra)` : ""}.
              <b> Costo ↑</b>: cuánto subió el costo (pestaña Costos) desde la última suba de precio.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Producto</th>
                    <th className={th}>Lista</th>
                    <th className={th}>Oferta</th>
                    {DESCUENTOS.map((d) => (
                      <th key={d} className={`${th} text-center`}>
                        −{d}%
                      </th>
                    ))}
                    <th className={th}>Última suba</th>
                    <th className={th}>Hace</th>
                    <th className={th}>12 meses</th>
                    <th className={th}>Costo ↑</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((f) => (
                    <tr key={f.id} className="border-b border-blush-100 align-top">
                      <td className={td}>
                        <Link href={`/precios?vista=historial&item=${f.id}`} className="font-medium hover:text-rose-deep hover:underline">
                          {f.name}
                        </Link>
                        <span className="block text-xs text-soft">
                          {f.category}
                          {f.wholesale ? " · mayorista" : ""}
                          {" · "}
                          <Link href={`/precios?vista=lista&editar=${f.id}#editar`} className="text-rose-deep hover:underline">
                            editar
                          </Link>
                          {f.web_slug && (
                            <>
                              {" · "}
                              <a href={`https://www.melaniapro.com/product-page/${f.web_slug}`} target="_blank" className="text-rose-deep hover:underline">
                                web
                              </a>
                            </>
                          )}
                        </span>
                      </td>
                      <td className={`${td} whitespace-nowrap font-semibold`}>{pesos(f.lista)}</td>
                      <td className={`${td} whitespace-nowrap ${f.oferta ? "text-rose-deep" : "text-soft"}`}>{pesos(f.oferta)}</td>
                      {DESCUENTOS.map((d) => (
                        <td key={d} className={`${td} whitespace-nowrap text-center text-xs`}>
                          {f.wholesale && f.lista != null && (f.wholesale_max_discount == null || d <= f.wholesale_max_discount)
                            ? pesos(f.lista * (1 - d / 100))
                            : "—"}
                        </td>
                      ))}
                      <td className={`${td} whitespace-nowrap`}>
                        {f.ultimaSuba ? fmtDate(f.ultimaSuba) : "—"}
                        {f.pctUltimaSuba != null && <span className="block text-xs text-emerald-700">{fmtPct(f.pctUltimaSuba)}</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap ${(f.diasDesdeSuba ?? 0) >= 120 ? "font-medium text-amber-700" : ""}`}>{hace(f.diasDesdeSuba)}</td>
                      <td className={td}>{fmtPct(f.pct12m)}</td>
                      <td className={`${td} ${f.subaCosto != null && f.subaCosto > 0.5 ? "font-semibold text-red-700" : "text-soft"}`}>{fmtPct(f.subaCosto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <details>
                <summary className="cursor-pointer font-semibold text-rose-deep">Condiciones mayoristas</summary>
                <ul className="my-3 space-y-1 text-sm">
                  {condiciones.map((c) => (
                    <li key={c.id}>
                      Desde {fmtDate(c.effective_date)}: 20% desde {pesos(c.min_20)} · 30% desde {pesos(c.min_30)} · 40% desde {pesos(c.min_40)}
                      {c.note ? <span className="text-soft"> · {c.note}</span> : null}
                    </li>
                  ))}
                </ul>
                <form action={guardarCondicionesMayoristas} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs text-soft">Rigen desde</label>
                    <input type="date" name="fecha" required defaultValue={hoy} className={input} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-soft">Mínimo 20%</label>
                    <input type="number" name="min_20" required defaultValue={cond?.min_20} className={input} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-soft">Mínimo 30%</label>
                    <input type="number" name="min_30" required defaultValue={cond?.min_30} className={input} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-soft">Mínimo 40%</label>
                    <input type="number" name="min_40" required defaultValue={cond?.min_40} className={input} />
                  </div>
                  <SubmitButton className="col-span-2 rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white sm:col-span-4">
                    Guardar condiciones nuevas
                  </SubmitButton>
                </form>
              </details>
            </Card>

            <Card>
              <details open={!!editando} id="editar">
                <summary className="cursor-pointer font-semibold text-rose-deep">
                  {editando ? `Editar: ${editando.name}` : "+ Agregar un producto a la lista"}
                </summary>
                <form key={editando?.id ?? "nuevo"} action={guardarItemPrecio} className="mt-3 grid gap-2 sm:grid-cols-2">
                  {editando && <input type="hidden" name="item" value={editando.id} />}
                  <div className="sm:col-span-2">
                    <label className={label}>Nombre *</label>
                    <input type="text" name="nombre" required defaultValue={editando?.name ?? ""} className={input} />
                  </div>
                  <div>
                    <label className={label}>Categoría</label>
                    <select name="categoria" defaultValue={editando?.category} className={input}>
                      {CATEGORIAS_PRECIO.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={label}>Producto del sistema (para costos)</label>
                    <select name="producto" className={input} defaultValue={editando?.product_id ?? ""}>
                      <option value="">Sin vincular</option>
                      {productosSistema.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="mayorista" defaultChecked={editando?.wholesale} className="h-4 w-4 accent-rose-deep" /> En listado mayorista
                  </label>
                  <div>
                    <label className="mb-1 block text-xs text-soft">Tope de descuento mayorista (%)</label>
                    <input type="number" name="max_desc" min="0" max="100" placeholder="sin tope" defaultValue={editando?.wholesale_max_discount ?? ""} className={input} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-soft">Link en la web (lo que va después de /product-page/)</label>
                    <input type="text" name="slug" defaultValue={editando?.web_slug ?? ""} className={input} />
                  </div>
                  {editando ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="activo" value="off" className="h-4 w-4 accent-rose-deep" /> Ya no se vende (ocultar de la lista)
                    </label>
                  ) : (
                    <>
                      <div>
                        <label className="mb-1 block text-xs text-soft">Precio de lista inicial</label>
                        <input type="number" name="precio_inicial" min="0" className={input} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-soft">Desde</label>
                        <input type="date" name="fecha_inicial" defaultValue={hoy} className={input} />
                      </div>
                    </>
                  )}
                  <p className="text-xs text-soft sm:col-span-2">Los precios se cambian en “Actualizar precios” (así queda el historial).</p>
                  <div className="flex items-center gap-3 sm:col-span-2">
                    <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white">Guardar</SubmitButton>
                    {editando && (
                      <Link href="/precios?vista=lista" className="text-sm text-soft hover:text-ink">
                        Cancelar
                      </Link>
                    )}
                  </div>
                </form>
              </details>
            </Card>
          </div>
        </>
      )}

      {vista === "historial" && (
        <>
          <form method="get" className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <input type="hidden" name="vista" value="historial" />
            <select name="item" defaultValue={sp.item ?? ""} aria-label="Producto" className={`${input} lg:col-span-2`}>
              <option value="">Todos los productos</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <select name="anio" defaultValue={sp.anio ?? ""} aria-label="Año" className={input}>
              <option value="">Todos los años</option>
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select name="mes" defaultValue={sp.mes ?? ""} aria-label="Mes" className={input}>
              <option value="">Todos los meses</option>
              {meses.map((m) => (
                <option key={m} value={m} className="capitalize">
                  {nombreMes(`${m}-01`)}
                </option>
              ))}
            </select>
            <select name="canal" defaultValue={sp.canal ?? ""} aria-label="Canal" className={input}>
              <option value="">Lista y oferta</option>
              <option value="LISTA">Solo precio de lista</option>
              <option value="OFERTA">Solo ofertas</option>
            </select>
            <button type="submit" className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
              Filtrar
            </button>
          </form>
          <p className="mb-3 text-sm text-soft">
            {historial.length} cambio(s) ·{" "}
            <Link href="/precios?vista=historial" className="font-medium text-rose-deep hover:underline">
              Limpiar filtros
            </Link>
          </p>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Rige desde</th>
                    <th className={th}>Producto</th>
                    <th className={th}>Canal</th>
                    <th className={th}>Antes</th>
                    <th className={th}>Ahora</th>
                    <th className={th}>Var.</th>
                    <th className={th}>Mayorista −20/−30/−40%</th>
                    <th className={th}>Nota</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((c) => {
                    const it = nombreItem.get(c.item_id);
                    const antes = anteriorDe(c);
                    const v = pct(c.price != null ? Number(c.price) : null, antes != null ? Number(antes) : null);
                    return (
                      <tr key={c.id} className="border-b border-blush-100">
                        <td className={`${td} whitespace-nowrap`}>{fmtDate(c.effective_date)}</td>
                        <td className={td}>{it?.name ?? "—"}</td>
                        <td className={td}>{c.channel === "LISTA" ? "Lista" : "Oferta"}</td>
                        <td className={`${td} whitespace-nowrap text-soft`}>{pesos(antes)}</td>
                        <td className={`${td} whitespace-nowrap font-semibold`}>{c.price == null ? "sin oferta" : pesos(c.price)}</td>
                        <td className={`${td} ${v != null && v > 0 ? "text-emerald-700" : v != null && v < 0 ? "text-red-700" : ""}`}>{fmtPct(v)}</td>
                        <td className={`${td} whitespace-nowrap text-xs text-soft`}>
                          {c.channel === "LISTA" && it?.wholesale && c.price != null
                            ? DESCUENTOS.filter((d) => it.wholesale_max_discount == null || d <= it.wholesale_max_discount)
                                .map((d) => pesos(Number(c.price) * (1 - d / 100)))
                                .join(" / ")
                            : ""}
                        </td>
                        <td className={`${td} text-xs text-soft`}>
                          {c.note}
                          {c.created_by ? <span className="block">{c.created_by}</span> : null}
                        </td>
                        <td className={td}>
                          <form action={eliminarCambioPrecio}>
                            <input type="hidden" name="cambio" value={c.id} />
                            <SubmitButton className="text-xs text-soft hover:text-red-700">Eliminar</SubmitButton>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {vista === "actualizar" && (
        <ActualizarPrecios
          hoy={hoy}
          categorias={CATEGORIAS_PRECIO}
          filas={filas.map((f) => ({
            id: f.id,
            name: f.name,
            category: f.category,
            lista: f.lista,
            oferta: vigenteEn(porItem.get(f.id) ?? [], "OFERTA", hoy),
            ultimaSuba: f.ultimaSuba,
          }))}
        />
      )}
    </div>
  );
}
