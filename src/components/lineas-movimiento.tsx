"use client";

import { useState } from "react";
import { BuscadorProducto, type OpcionBuscador } from "@/components/buscador-producto";

type Opcion = { value: string; label: string };
type Ubicacion = { id: string; name: string };

// Líneas dinámicas del movimiento: stock puntual (producto·lote·ubicación) o kits.
// Los inputs usan nombres repetidos; el server los lee en orden con getAll.
export function LineasMovimiento({
  opciones,
  kits,
  ubicaciones,
}: {
  opciones: Opcion[];
  kits: { id: string; sku: string; name: string }[];
  ubicaciones: Ubicacion[];
}) {
  const [lineas, setLineas] = useState<{ key: number; valor: string }[]>([{ key: 0, valor: "" }]);
  const [next, setNext] = useState(1);

  const agregar = () => {
    setLineas((l) => [...l, { key: next, valor: "" }]);
    setNext((n) => n + 1);
  };
  const quitar = (key: number) => setLineas((l) => l.filter((x) => x.key !== key));
  const setValor = (key: number, valor: string) =>
    setLineas((l) => l.map((x) => (x.key === key ? { ...x, valor } : x)));

  const todas: OpcionBuscador[] = [
    ...kits.map((k) => ({ value: `kit:${k.id}`, label: `${k.name} · kit ${k.sku}`, grupo: "Kits (descuentan sus componentes)" })),
    ...opciones.map((o) => ({ ...o, grupo: kits.length ? "Stock disponible" : undefined })),
  ];

  const selectCls =
    "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";

  return (
    <div className="space-y-3">
      {lineas.map((linea) => {
        const esKit = linea.valor.startsWith("kit:");
        return (
          <div key={linea.key} className="rounded-lg border border-blush-100 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="flex-1">
                <BuscadorProducto
                  name="linea_valor"
                  opciones={todas}
                  value={linea.valor}
                  onChange={(v) => setValor(linea.key, v)}
                  placeholder="Buscar producto, SKU o lote…"
                />
                {esKit ? (
                  <select name="linea_kit_ubicacion" required className={`${selectCls} mt-2`}>
                    <option value="">¿Desde qué ubicación salen los componentes?</option>
                    {ubicaciones.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="hidden" name="linea_kit_ubicacion" value="" />
                )}
              </div>
              <div className="flex items-start gap-2">
                <input
                  type="number"
                  name="linea_cantidad"
                  min="0.001"
                  step="any"
                  required
                  placeholder="Cant."
                  aria-label="Cantidad"
                  className="w-24 rounded-lg border border-line bg-white px-3 py-2.5 text-center text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
                />
                {lineas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => quitar(linea.key)}
                    aria-label="Quitar línea"
                    className="rounded-lg border border-line px-3 py-2.5 text-soft hover:bg-red-50 hover:text-red-700"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={agregar}
        className="rounded-lg border border-dashed border-blush px-4 py-2 text-sm font-medium text-rose-deep hover:bg-blush-50"
      >
        + Agregar otro producto
      </button>
    </div>
  );
}
