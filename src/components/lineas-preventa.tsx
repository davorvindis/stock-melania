"use client";

import { useState } from "react";
import { BuscadorProducto, type OpcionBuscador } from "@/components/buscador-producto";

// productos y cantidades de una preventa (inputs pv_producto / pv_cantidad repetidos)
export function LineasPreventa({ productos }: { productos: OpcionBuscador[] }) {
  const [lineas, setLineas] = useState([{ key: 0, producto: "" }]);
  const [next, setNext] = useState(1);
  return (
    <div className="space-y-2">
      {lineas.map((l, i) => (
        <div key={l.key} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <BuscadorProducto
              name="pv_producto"
              opciones={productos}
              value={l.producto}
              onChange={(v) => setLineas((x) => x.map((y) => (y.key === l.key ? { ...y, producto: v } : y)))}
              placeholder={`Producto ${i + 1}…`}
            />
          </div>
          <input
            type="number"
            name="pv_cantidad"
            min="1"
            step="any"
            required
            placeholder="Cant."
            aria-label="Cantidad"
            className="w-24 rounded-lg border border-line bg-white px-3 py-2.5 text-center text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
          />
          {lineas.length > 1 && (
            <button
              type="button"
              onClick={() => setLineas((x) => x.filter((y) => y.key !== l.key))}
              aria-label="Quitar"
              className="rounded-lg border border-line px-3 py-2.5 text-soft hover:bg-red-50 hover:text-red-700"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setLineas((x) => [...x, { key: next, producto: "" }]);
          setNext((n) => n + 1);
        }}
        className="rounded-lg border border-dashed border-blush px-4 py-2 text-sm font-medium text-rose-deep hover:bg-blush-50"
      >
        + Agregar otro producto
      </button>
    </div>
  );
}
