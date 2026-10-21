"use client";

import { useState } from "react";
import { BuscadorProducto, type OpcionBuscador } from "@/components/buscador-producto";

type Linea = { key: number; producto: string; cantidad: string };

// productos que descuenta un SKU de Wix (inputs eq_producto / eq_cantidad repetidos)
export function LineasEquivalencia({
  productos,
  inicial,
}: {
  productos: OpcionBuscador[];
  inicial?: { producto: string; cantidad: number }[];
}) {
  const [lineas, setLineas] = useState<Linea[]>(
    inicial?.length
      ? inicial.map((l, i) => ({ key: i, producto: l.producto, cantidad: String(l.cantidad) }))
      : [{ key: 0, producto: "", cantidad: "1" }]
  );
  const [next, setNext] = useState(Math.max(inicial?.length ?? 0, 1));
  const set = (key: number, cambios: Partial<Linea>) =>
    setLineas((x) => x.map((y) => (y.key === key ? { ...y, ...cambios } : y)));

  return (
    <div className="space-y-2">
      {lineas.map((l, i) => (
        <div key={l.key} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <BuscadorProducto
              name="eq_producto"
              opciones={productos}
              value={l.producto}
              onChange={(v) => set(l.key, { producto: v })}
              placeholder={`Producto ${i + 1}…`}
            />
          </div>
          <input
            type="number"
            name="eq_cantidad"
            min="0.001"
            step="any"
            required
            value={l.cantidad}
            onChange={(e) => set(l.key, { cantidad: e.target.value })}
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
          setLineas((x) => [...x, { key: next, producto: "", cantidad: "1" }]);
          setNext((n) => n + 1);
        }}
        className="rounded-lg border border-dashed border-blush px-4 py-2 text-sm font-medium text-rose-deep hover:bg-blush-50"
      >
        + Agregar otro producto
      </button>
    </div>
  );
}
