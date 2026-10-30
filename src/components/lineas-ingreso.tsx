"use client";

import { useState } from "react";
import { BuscadorProducto, type OpcionBuscador } from "@/components/buscador-producto";

type Linea = { key: number; producto: string; cantidad: string; costo: string; ocLinea?: string; detalle?: string; lote?: string; cerrada?: boolean };
// el remito cuenta en otra unidad: se carga lo que dice el remito y se calcula lo nuestro
function ConversionRemito({ conv, cantidad, onCantidad }: { conv: Conversion; cantidad: string; onCantidad: (c: string) => void }) {
  const remito = Number(cantidad) > 0 ? String(Number(cantidad) / conv.factor) : "";
  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <b>Ojo con la unidad:</b> el remito cuenta {conv.remito} y acá se carga en {plural(conv.nuestra)}: 1 {conv.remito.replace(/s$/, "")} = {conv.factor}{" "}
      {plural(conv.nuestra)}.
      <label className="mt-2 flex flex-wrap items-center gap-2">
        <span>El remito dice</span>
        <input
          type="number"
          min="0"
          step="any"
          value={remito}
          onChange={(e) => onCantidad(e.target.value ? String(Number(e.target.value) * conv.factor) : "")}
          className="w-32 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-base"
          aria-label={`Cantidad del remito en ${conv.remito}`}
        />
        <span>
          {conv.remito} → se cargan <b>{Number(cantidad) > 0 ? Number(cantidad).toLocaleString("es-AR") : "—"} {plural(conv.nuestra)}</b>
        </span>
      </label>
      <span className="mt-1 block text-xs">El costo unitario va por {conv.nuestra} (precio del {conv.remito.replace(/s$/, "")} ÷ {conv.factor}).</span>
    </div>
  );
}

export type LineaInicial = Omit<Linea, "key" | "lote" | "cerrada">;

const campo =
  "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";
const etiqueta = "mb-1 block text-xs font-medium text-soft";

const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

// Líneas del ingreso: un remito puede traer varios productos. Los inputs usan
// nombres repetidos (ing_*) y el server los lee en orden con getAll.
export type Conversion = { remito: string; factor: number; nuestra: string }; // nuestra: unidad del producto en singular (ej. par)

const plural = (u: string) => (/s$/.test(u) ? u : /[aeiou]$/.test(u) ? `${u}s` : `${u}es`);

export function LineasIngreso({
  productos,
  inicial,
  conversiones = {},
}: {
  productos: OpcionBuscador[];
  inicial?: LineaInicial[];
  conversiones?: Record<string, Conversion>;
}) {
  const [lineas, setLineas] = useState<Linea[]>(
    inicial?.length ? inicial.map((l, i) => ({ ...l, key: i })) : [{ key: 0, producto: "", cantidad: "", costo: "" }]
  );
  // siguiente clave libre: si no viene nada precargado, la línea vacía ya usa la 0
  const [next, setNext] = useState(Math.max(inicial?.length ?? 0, 1));

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
          {conversiones[linea.producto] && (
            <ConversionRemito
              conv={conversiones[linea.producto]}
              cantidad={linea.cantidad}
              onCantidad={(c) => set(linea.key, { cantidad: c })}
            />
          )}
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
              <input
                type="text"
                name="ing_lote"
                placeholder="ej. L-2026-02"
                value={linea.lote ?? ""}
                onChange={(e) => set(linea.key, { lote: e.target.value, ...(e.target.value.trim() ? {} : { cerrada: false }) })}
                className={campo}
              />
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
          {/* siempre se envía (aunque no esté tildado) para que las líneas no se desfasen */}
          <input type="hidden" name="ing_cerrada" value={linea.cerrada ? "1" : ""} />
          <label
            className={`mt-2 flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${
              linea.lote?.trim() ? "cursor-pointer" : "cursor-not-allowed opacity-50"
            } ${linea.cerrada ? "bg-amber-50 text-amber-900" : ""}`}
          >
            <input
              type="checkbox"
              checked={!!linea.cerrada}
              disabled={!linea.lote?.trim()}
              onChange={(e) => set(linea.key, { cerrada: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-rose-deep"
            />
            <span>
              🔒 <b>Mantener caja cerrada</b>
              <span className="block text-xs text-soft">
                {linea.lote?.trim()
                  ? "Suma al stock total pero no se puede vender hasta que abras la caja (primero se termina el lote anterior)."
                  : "Cargá el número de lote para poder dejarlo en caja cerrada."}
              </span>
            </span>
          </label>
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
