"use client";

import { useState } from "react";
import { BuscadorProducto, type OpcionBuscador } from "@/components/buscador-producto";

type Linea = { key: number; producto: string; cantidad: string; costo: string; ocLinea?: string; detalle?: string };
export type LineaInicial = Omit<Linea, "key">;

const campo =
  "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";
const etiqueta = "mb-1 block text-xs font-medium text-soft";

const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

// Líneas del ingreso: un remito puede traer varios productos. Los inputs usan
// nombres repetidos (ing_*) y el server los lee en orden con getAll.
export function LineasIngreso({ productos, inicial }: { productos: OpcionBuscador[]; inicial?: LineaInicial[] }) {
  const [lineas, setLineas] = useState<Linea[]>(
    inicial?.length ? inicial.map((l, i) => ({ ...l, key: i })) : [{ key: 0, producto: "", cantidad: "", costo: "" }]
  );
  const [next, setNext] = useState(inicial?.length ?? 1);

  const set = (key: number, cambios: Partial<Linea>) =>
    setLineas((l) => l.map((x) => (x.key === key ? { ...x, ...cambios } : x)));
  const agregar = () => {
    setLineas((l) => [...l, { key: next, producto: "", cantidad: "", costo: "" }]);
    setNext((n) => n + 1);
  };
  const quitar = (key: number) => setLineas((l) => l.filter((x) => x.key !== key));

  const subtotal = (x: Linea) => (Number(x.cantidad) || 0) * (Number(x.costo) || 0);
  const total = lineas.reduce((s, x) => s + subtotal(x), 0);

  return (
    <div className="space-y-3">
      {lineas.map((linea, i) => (
        <div key={linea.key} className="rounded-lg border border-blush-100 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-soft">Producto {i + 1}</span>
            {lineas.length > 1 && (
              <button
                type="button"
                onClick={() => quitar(linea.key)}
                className="rounded-lg px-2 py-1 text-xs text-soft hover:bg-red-50 hover:text-red-700"
              >
                ✕ Quitar
              </button>
            )}
          </div>
          <input type="hidden" name="ing_oc_linea" value={linea.ocLinea ?? ""} />
          {linea.detalle && <p className="mb-1 text-xs text-soft">De la orden: {linea.detalle}</p>}
          <BuscadorProducto
            name="ing_producto"
            opciones={productos}
            value={linea.producto}
            onChange={(v) => set(linea.key, { producto: v })}
            placeholder="Buscar producto o SKU…"
          />
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className={etiqueta}>Cantidad *</label>
              <input
                type="number"
                name="ing_cantidad"
                min="0.001"
                step="any"
                required
                value={linea.cantidad}
                onChange={(e) => set(linea.key, { cantidad: e.target.value })}
                className={campo}
              />
            </div>
            <div>
              <label className={etiqueta}>Lote</label>
              <input type="text" name="ing_lote" placeholder="ej. L-2026-02" className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Vencimiento</label>
              <input type="date" name="ing_vencimiento" className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Costo unitario ($)</label>
              <input
                type="number"
                name="ing_costo"
                min="0"
                step="0.01"
                value={linea.costo}
                onChange={(e) => set(linea.key, { costo: e.target.value })}
                className={campo}
              />
            </div>
          </div>
          {subtotal(linea) > 0 && (
            <p className="mt-1 text-right text-xs text-soft">Subtotal: {pesos(subtotal(linea))}</p>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={agregar}
          className="rounded-lg border border-dashed border-blush px-4 py-2 text-sm font-medium text-rose-deep hover:bg-blush-50"
        >
          + Agregar otro producto
        </button>
        {total > 0 && (
          <span className="text-sm">
            Total del ingreso: <b>{pesos(total)}</b>
          </span>
        )}
      </div>
    </div>
  );
}
