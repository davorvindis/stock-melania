"use client";

import { useState } from "react";
import { BuscadorProducto, type OpcionBuscador } from "@/components/buscador-producto";

export type LineaOrdenInicial = {
  id?: string;
  producto: string;
  descripcion: string;
  cantidad: string;
  unidad: string;
  tipo: string;
  costo: string;
  recibido?: number;
};
type Linea = LineaOrdenInicial & { key: number };

const campo =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";
const etiqueta = "mb-1 block text-xs font-medium text-soft";
const vacia = (): LineaOrdenInicial => ({ producto: "", descripcion: "", cantidad: "", unidad: "u", tipo: "", costo: "" });
const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

// Ítems de una orden de compra. El producto del catálogo es opcional (estuches,
// granel o etiquetas pueden no estar cargados): alcanza con la descripción.
export function LineasOrden({ productos, inicial }: { productos: OpcionBuscador[]; inicial?: LineaOrdenInicial[] }) {
  const [lineas, setLineas] = useState<Linea[]>(
    (inicial?.length ? inicial : [vacia()]).map((l, i) => ({ ...l, key: i }))
  );
  const [next, setNext] = useState((inicial?.length ?? 1) + 1);
  const set = (key: number, c: Partial<Linea>) => setLineas((l) => l.map((x) => (x.key === key ? { ...x, ...c } : x)));
  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0);

  return (
    <div className="space-y-3">
      {lineas.map((l, i) => (
        <div key={l.key} className="rounded-lg border border-blush-100 p-3">
          <input type="hidden" name="oc_linea_id" value={l.id ?? ""} />
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-soft">
              Ítem {i + 1}
              {l.recibido ? ` · recibido ${l.recibido}` : ""}
            </span>
            {lineas.length > 1 && !l.recibido && (
              <button
                type="button"
                onClick={() => setLineas((x) => x.filter((y) => y.key !== l.key))}
                className="rounded-lg px-2 py-1 text-xs text-soft hover:bg-red-50 hover:text-red-700"
              >
                ✕ Quitar
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={etiqueta}>Descripción *</label>
              <input
                type="text"
                name="oc_desc"
                value={l.descripcion}
                onChange={(e) => set(l.key, { descripcion: e.target.value })}
                placeholder="ej. estuches keratin 15ml"
                className={campo}
              />
            </div>
            <div>
              <label className={etiqueta}>Producto del sistema (opcional, para recibirlo al stock)</label>
              <BuscadorProducto
                name="oc_producto"
                opciones={productos}
                value={l.producto}
                onChange={(v) => {
                  const nombre = productos.find((p) => p.value === v)?.label.split(" · ")[0] ?? "";
                  set(l.key, { producto: v, descripcion: l.descripcion || nombre });
                }}
                placeholder="Buscar producto…"
                opcional
              />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className={etiqueta}>Cantidad</label>
              <input
                type="number"
                name="oc_cantidad"
                min="0.001"
                step="any"
                value={l.cantidad}
                onChange={(e) => set(l.key, { cantidad: e.target.value })}
                className={campo}
              />
            </div>
            <div>
              <label className={etiqueta}>Unidad</label>
              <select name="oc_unidad" value={l.unidad} onChange={(e) => set(l.key, { unidad: e.target.value })} className={campo}>
                <option value="u">unidades</option>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="l">litros</option>
              </select>
            </div>
            <div>
              <label className={etiqueta}>Tipo / presentación</label>
              <input
                type="text"
                name="oc_tipo"
                value={l.tipo}
                onChange={(e) => set(l.key, { tipo: e.target.value })}
                placeholder="15ml, granel…"
                className={campo}
              />
            </div>
            <div>
              <label className={etiqueta}>Costo unitario ($)</label>
              <input
                type="number"
                name="oc_costo"
                min="0"
                step="0.01"
                value={l.costo}
                onChange={(e) => set(l.key, { costo: e.target.value })}
                className={campo}
              />
            </div>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setLineas((x) => [...x, { ...vacia(), key: next }]);
            setNext((n) => n + 1);
          }}
          className="rounded-lg border border-dashed border-blush px-4 py-2 text-sm font-medium text-rose-deep hover:bg-blush-50"
        >
          + Agregar ítem
        </button>
        {total > 0 && (
          <span className="text-sm">
            Total estimado: <b>{pesos(total)}</b>
          </span>
        )}
      </div>
    </div>
  );
}
