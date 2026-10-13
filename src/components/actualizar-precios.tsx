"use client";

import { useMemo, useState } from "react";
import { actualizarPrecios } from "@/lib/precios-actions";
import { SubmitButton } from "@/components/submit-button";

export type FilaPrecio = {
  id: string;
  name: string;
  category: string;
  lista: number | null;
  oferta: number | null;
  ultimaSuba: string | null;
};

const pesos = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("es-AR")}`);
const campo = "w-28 rounded-lg border border-line px-2 py-1.5 text-right text-sm focus:border-blush focus:outline-none";

// Actualización de precios: se editan uno por uno o se aplica un % a los seleccionados.
// Solo se guardan los que cambian.
export function ActualizarPrecios({ filas, categorias, hoy }: { filas: FilaPrecio[]; categorias: string[]; hoy: string }) {
  const [nuevos, setNuevos] = useState<Record<string, string>>({});
  const [ofertas, setOfertas] = useState<Record<string, string>>({});
  const [sinOferta, setSinOferta] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [pctTxt, setPctTxt] = useState("10");
  const [redondeo, setRedondeo] = useState("100");
  const [texto, setTexto] = useState("");
  const [cat, setCat] = useState("");

  const visibles = useMemo(
    () =>
      filas.filter(
        (f) => (!cat || f.category === cat) && (!texto || f.name.toLowerCase().includes(texto.toLowerCase()))
      ),
    [filas, cat, texto]
  );
  const cambiados = filas.filter(
    (f) =>
      (nuevos[f.id] && Number(nuevos[f.id]) !== f.lista) ||
      (ofertas[f.id] && Number(ofertas[f.id]) !== f.oferta) ||
      (sinOferta[f.id] && f.oferta != null)
  ).length;
  const seleccionados = visibles.filter((f) => sel[f.id]);

  function aplicarPct() {
    const p = Number(pctTxt.replace(",", "."));
    if (!Number.isFinite(p)) return;
    const r = Number(redondeo) || 1;
    const out = { ...nuevos };
    for (const f of seleccionados) {
      if (f.lista == null) continue;
      out[f.id] = String(Math.round((f.lista * (1 + p / 100)) / r) * r);
    }
    setNuevos(out);
  }

  return (
    <form action={actualizarPrecios} className="space-y-3">
      <div className="grid gap-3 rounded-xl border border-line bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-soft">Los precios nuevos rigen desde *</label>
          <input type="date" name="fecha" required defaultValue={hoy} className="w-full rounded-lg border border-line px-2 py-2 text-sm" />
        </div>
        <div className="lg:col-span-3">
          <label className="mb-1 block text-xs font-medium text-soft">Nota (opcional)</label>
          <input type="text" name="nota" placeholder="ej. Aumento octubre por suba de envases" className="w-full rounded-lg border border-line px-2 py-2 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-blush bg-blush-50 p-3 text-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-soft">Aumentar a los seleccionados</label>
          <div className="flex items-center gap-1">
            <input value={pctTxt} onChange={(e) => setPctTxt(e.target.value)} className="w-20 rounded-lg border border-line px-2 py-1.5 text-right" />
            <span>%</span>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-soft">Redondear a</label>
          <select value={redondeo} onChange={(e) => setRedondeo(e.target.value)} className="rounded-lg border border-line px-2 py-1.5">
            <option value="1">sin redondeo</option>
            <option value="10">$10</option>
            <option value="50">$50</option>
            <option value="100">$100</option>
            <option value="500">$500</option>
          </select>
        </div>
        <button
          type="button"
          onClick={aplicarPct}
          disabled={!seleccionados.length}
          className="rounded-lg bg-rose-deep px-3 py-1.5 font-semibold text-white disabled:opacity-40"
        >
          Aplicar a {seleccionados.length} seleccionado(s)
        </button>
        <button type="button" onClick={() => setNuevos({})} className="px-2 py-1.5 text-xs text-soft hover:text-ink">
          Deshacer cambios
        </button>
        <span className="ml-auto text-xs text-soft">Revisá los precios antes de guardar: podés corregir cualquiera a mano.</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar producto…" className="rounded-lg border border-line px-3 py-2 text-sm" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-soft">
              <th className="px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los visibles"
                  checked={visibles.length > 0 && visibles.every((f) => sel[f.id])}
                  onChange={(e) => setSel((s) => ({ ...s, ...Object.fromEntries(visibles.map((f) => [f.id, e.target.checked])) }))}
                  className="h-4 w-4 accent-rose-deep"
                />
              </th>
              <th className="px-2 py-2">Producto</th>
              <th className="px-2 py-2 text-right">Lista actual</th>
              <th className="px-2 py-2 text-right">Lista nueva</th>
              <th className="px-2 py-2 text-right">Var.</th>
              <th className="px-2 py-2 text-right">Oferta actual</th>
              <th className="px-2 py-2 text-right">Oferta nueva</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const visible = visibles.includes(f);
              const n = nuevos[f.id] ? Number(nuevos[f.id]) : null;
              const v = n != null && f.lista ? ((n - f.lista) / f.lista) * 100 : null;
              return (
                <tr key={f.id} className={`border-b border-blush-100 ${visible ? "" : "hidden"} ${n != null && n !== f.lista ? "bg-amber-50" : ""}`}>
                  <td className="px-2 py-1.5">
                    <input type="hidden" name="item" value={f.id} />
                    <input
                      type="checkbox"
                      checked={!!sel[f.id]}
                      onChange={(e) => setSel((s) => ({ ...s, [f.id]: e.target.checked }))}
                      aria-label={`Seleccionar ${f.name}`}
                      className="h-4 w-4 accent-rose-deep"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {f.name}
                    <span className="block text-xs text-soft">
                      {f.category}
                      {f.ultimaSuba ? ` · última suba ${f.ultimaSuba.split("-").reverse().join("/")}` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-soft">{pesos(f.lista)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      name="lista"
                      inputMode="numeric"
                      value={nuevos[f.id] ?? ""}
                      onChange={(e) => setNuevos((x) => ({ ...x, [f.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                      placeholder={f.lista != null ? String(f.lista) : "—"}
                      className={campo}
                    />
                  </td>
                  <td className={`px-2 py-1.5 text-right text-xs font-medium ${v == null ? "" : v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : ""}`}>
                    {v == null || Math.abs(v) < 0.05 ? "" : `${v > 0 ? "+" : ""}${v.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`}
                  </td>
                  <td className="px-2 py-1.5 text-right text-soft">{pesos(f.oferta)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      name="oferta"
                      inputMode="numeric"
                      value={ofertas[f.id] ?? ""}
                      disabled={!!sinOferta[f.id]}
                      onChange={(e) => setOfertas((x) => ({ ...x, [f.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                      placeholder={f.oferta != null ? String(f.oferta) : "—"}
                      className={campo}
                    />
                    {f.oferta != null && (
                      <label className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-soft">
                        <input
                          type="checkbox"
                          name="sin_oferta"
                          value={f.id}
                          checked={!!sinOferta[f.id]}
                          onChange={(e) => setSinOferta((x) => ({ ...x, [f.id]: e.target.checked }))}
                          className="h-3 w-3"
                        />
                        quitar oferta
                      </label>
                    )}
                    {/* un input deshabilitado no se envía: mantener el orden de los campos */}
                    {sinOferta[f.id] && <input type="hidden" name="oferta" value="" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/95 p-3 backdrop-blur">
        <span className="text-sm">
          <b>{cambiados}</b> precio(s) con cambios
        </span>
        <SubmitButton className="ml-auto rounded-lg bg-rose-deep px-5 py-2.5 font-semibold text-white hover:bg-rose-deeper">
          Guardar actualización de precios
        </SubmitButton>
      </div>
    </form>
  );
}
