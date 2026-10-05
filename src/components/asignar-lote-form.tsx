"use client";

import { useMemo, useState } from "react";
import { asignarLote } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";
import { input, label, button } from "@/components/ui";
import { fmtQty, fmtDate } from "@/lib/types";

export type FilaStock = {
  lotId: string | null;
  lotCode: string | null;
  locationId: string;
  locationName: string;
  qty: number;
};

export type ProductoConStock = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  filas: FilaStock[];
  lotes: { code: string; expires_on: string | null }[];
};

// Asigna nro de lote + vencimiento a stock existente. Elegís el producto y de
// qué renglón sale (todo lo sin lote, o un renglón puntual con cantidad).
export function AsignarLoteForm({
  productos,
  idem,
  inicial,
}: {
  productos: ProductoConStock[];
  idem: string;
  inicial?: string;
}) {
  const [productoId, setProductoId] = useState(
    productos.some((p) => p.id === inicial) ? inicial! : ""
  );
  const producto = productos.find((p) => p.id === productoId);
  const sinLote = useMemo(() => producto?.filas.filter((f) => !f.lotId) ?? [], [producto]);
  const totalSinLote = sinLote.reduce((s, f) => s + f.qty, 0);
  const [origen, setOrigen] = useState(sinLote.length ? "TODO" : "");
  const [codigo, setCodigo] = useState("");
  const [venc, setVenc] = useState("");

  const filaElegida = producto?.filas.find((f) => `${f.lotId ?? ""}|${f.locationId}` === origen);
  const loteExistente = producto?.lotes.find((l) => l.code.toLowerCase() === codigo.trim().toLowerCase());

  function elegirProducto(id: string) {
    setProductoId(id);
    const p = productos.find((x) => x.id === id);
    setOrigen(p?.filas.some((f) => !f.lotId) ? "TODO" : "");
  }

  function cambiarCodigo(v: string) {
    setCodigo(v);
    const l = producto?.lotes.find((x) => x.code.toLowerCase() === v.trim().toLowerCase());
    if (l?.expires_on) setVenc(l.expires_on);
  }

  return (
    <form action={asignarLote} className="space-y-3">
      <input type="hidden" name="idem" value={idem} />
      <div>
        <label className={label}>Producto *</label>
        <select
          name="producto"
          required
          value={productoId}
          onChange={(e) => elegirProducto(e.target.value)}
          className={input}
        >
          <option value="">Elegir producto…</option>
          {productos.map((p) => {
            const sl = p.filas.filter((f) => !f.lotId).reduce((s, f) => s + f.qty, 0);
            return (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}){sl > 0 ? ` · ${fmtQty(sl)} sin lote` : ""}
              </option>
            );
          })}
        </select>
      </div>

      {producto && (
        <fieldset>
          <legend className={label}>¿Qué stock pasa al lote? *</legend>
          <div className="space-y-1.5">
            {sinLote.length > 0 && (
              <OpcionOrigen
                value="TODO"
                actual={origen}
                onChange={setOrigen}
                destacada
                titulo="Todo el stock sin lote"
                detalle={`${fmtQty(totalSinLote)} ${producto.unit} en ${sinLote.length} ubicación(es)`}
              />
            )}
            {producto.filas.map((f) => {
              const v = `${f.lotId ?? ""}|${f.locationId}`;
              return (
                <OpcionOrigen
                  key={v}
                  value={v}
                  actual={origen}
                  onChange={setOrigen}
                  titulo={`${f.lotCode ? `Lote ${f.lotCode}` : "Sin lote"} · ${f.locationName}`}
                  detalle={`${fmtQty(f.qty)} ${producto.unit}`}
                />
              );
            })}
          </div>
          <input type="hidden" name="origen" value={origen} />
        </fieldset>
      )}

      {filaElegida && (
        <div>
          <label className={label}>Cantidad</label>
          <input
            type="number"
            name="cantidad"
            min="0.001"
            max={filaElegida.qty}
            step="any"
            placeholder={`Todo (${fmtQty(filaElegida.qty)})`}
            className={input}
          />
          <p className="mt-1 text-xs text-soft">Vacío = pasa todo el renglón.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>N° de lote *</label>
          <input
            type="text"
            name="lote"
            required
            value={codigo}
            onChange={(e) => cambiarCodigo(e.target.value)}
            list="lotes-del-producto"
            autoComplete="off"
            className={input}
          />
          <datalist id="lotes-del-producto">
            {producto?.lotes.map((l) => (
              <option key={l.code} value={l.code} />
            ))}
          </datalist>
          {loteExistente && (
            <p className="mt-1 text-xs text-soft">
              Lote existente{loteExistente.expires_on ? ` · vence ${fmtDate(loteExistente.expires_on)}` : ""}: se suma a él.
            </p>
          )}
        </div>
        <div>
          <label className={label}>Vencimiento</label>
          <input
            type="date"
            name="vencimiento"
            value={venc}
            onChange={(e) => setVenc(e.target.value)}
            className={input}
          />
        </div>
      </div>

      <SubmitButton className={button}>Asignar lote</SubmitButton>
      <p className="text-xs text-soft">
        El total del producto no cambia: el stock solo pasa a estar identificado con ese lote (queda en el historial).
      </p>
    </form>
  );
}

function OpcionOrigen({
  value,
  actual,
  onChange,
  titulo,
  detalle,
  destacada = false,
}: {
  value: string;
  actual: string;
  onChange: (v: string) => void;
  titulo: string;
  detalle: string;
  destacada?: boolean;
}) {
  const activa = actual === value;
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition ${
        activa ? "border-rose-deep bg-blush-100" : "border-line bg-white hover:border-blush"
      }`}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name="origen_radio"
          checked={activa}
          onChange={() => onChange(value)}
          className="h-4 w-4 accent-rose-deep"
        />
        <span className={destacada ? "font-semibold" : ""}>{titulo}</span>
      </span>
      <span className="shrink-0 text-soft">{detalle}</span>
    </label>
  );
}
