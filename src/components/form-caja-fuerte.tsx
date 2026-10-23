"use client";

import { useState } from "react";
import { registrarMovimientoCF } from "@/lib/caja-fuerte-actions";
import { SubmitButton } from "@/components/submit-button";

const campo =
  "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";
const etiqueta = "mb-1 block text-sm font-medium text-ink";

// registrar retiro (total / parcial) o ingreso manual de la caja fuerte
export function FormCajaFuerte({ porRetirar, hoy }: { porRetirar: { ARS: number; USD: number }; hoy: string }) {
  const [tipo, setTipo] = useState<"RETIRO" | "INGRESO">("RETIRO");
  const [alcance, setAlcance] = useState<"TOTAL" | "PARCIAL">("PARCIAL");
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [monto, setMonto] = useState("");
  const total = Math.max(porRetirar[moneda], 0);
  const valor = tipo === "RETIRO" && alcance === "TOTAL" ? String(total) : monto;

  return (
    <form action={registrarMovimientoCF} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["RETIRO", "Retiro"],
            ["INGRESO", "Ingreso manual"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTipo(v)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${tipo === v ? "border-rose-deep bg-rose-deep text-white" : "border-line bg-white text-soft"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <input type="hidden" name="tipo" value={tipo} />
      <div className="grid gap-3 sm:grid-cols-2">
        {tipo === "RETIRO" && (
          <div>
            <label className={etiqueta}>Retiro *</label>
            <select name="alcance" value={alcance} onChange={(e) => setAlcance(e.target.value as typeof alcance)} className={campo}>
              <option value="PARCIAL">Parcial</option>
              <option value="TOTAL">Total (todo lo que hay)</option>
            </select>
          </div>
        )}
        <div>
          <label className={etiqueta}>Fecha *</label>
          <input type="date" name="fecha" defaultValue={hoy} max={hoy} required className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Moneda *</label>
          <select name="moneda" value={moneda} onChange={(e) => setMoneda(e.target.value as typeof moneda)} className={campo}>
            <option value="ARS">Pesos</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </div>
        <div>
          <label className={etiqueta}>Monto *</label>
          <input
            type="number"
            name="monto"
            min="0.01"
            step="any"
            inputMode="decimal"
            required
            value={valor}
            readOnly={tipo === "RETIRO" && alcance === "TOTAL"}
            onChange={(e) => setMonto(e.target.value)}
            className={`${campo} ${tipo === "RETIRO" && alcance === "TOTAL" ? "bg-blush-50" : ""}`}
          />
          {tipo === "RETIRO" && (
            <p className="mt-1 text-xs text-soft">
              Disponible para retirar: {moneda === "USD" ? `US$ ${total.toLocaleString("es-AR")}` : total.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })}
            </p>
          )}
        </div>
        <div>
          <label className={etiqueta}>{tipo === "RETIRO" ? "¿Quién retiró? *" : "¿Quién trajo la plata?"}</label>
          <input name="persona" list="personas-cf" required={tipo === "RETIRO"} placeholder="ej. Joel" className={campo} />
          <datalist id="personas-cf">
            {["Joel", "Mel", "Yura"].map((p) => <option key={p} value={p} />)}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <label className={etiqueta}>Nota</label>
          <input name="notas" placeholder={tipo === "RETIRO" ? "ej. para pagar proveedor" : "ej. saldo que había antes de octubre"} className={campo} />
        </div>
      </div>
      <SubmitButton className="rounded-lg bg-rose-deep px-5 py-2.5 font-semibold text-white hover:bg-rose-deeper">
        {tipo === "RETIRO" ? "Registrar retiro" : "Registrar ingreso"}
      </SubmitButton>
      <p className="text-xs text-soft">Queda pendiente hasta que Joel o Mel lo aprueben. Recién ahí cambia el saldo.</p>
    </form>
  );
}
