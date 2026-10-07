"use client";

import { useState } from "react";
import { MOVEMENT_LABELS, NEEDS_DESTINATION, OPERABLE_TYPES } from "@/lib/types";
import { input, label } from "@/components/ui";

// Tipo de movimiento + destino: el destino solo existe para transferencias,
// cuarentena y envío a proveedor; en egresos (venta, uso interno…) la
// mercadería sale del stock y el "destino" es el propio tipo.
export function TipoDestino({ ubicaciones }: { ubicaciones: { id: string; name: string }[] }) {
  const [tipo, setTipo] = useState<string>(OPERABLE_TYPES[0]);
  const conDestino = NEEDS_DESTINATION.includes(tipo);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className={label}>Tipo de movimiento *</label>
        <select name="tipo" required value={tipo} onChange={(e) => setTipo(e.target.value)} className={input}>
          {OPERABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {conDestino ? (
        <div>
          <label className={label}>Ubicación destino *</label>
          <select name="destino" required className={input}>
            <option value="">Elegir…</option>
            {ubicaciones.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="self-end pb-3 text-sm text-soft">
          Sale del stock: queda como <b>origen → {MOVEMENT_LABELS[tipo]}</b>.
        </p>
      )}
    </div>
  );
}
