"use client";

import { useState } from "react";
import { fmtQty } from "@/lib/types";
import { input, label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export type LoteOpcion = { id: string; code: string; expires_on: string | null };
export type ComponenteDesarme = {
  id: string;
  nombre: string;
  porKit: number;
  lotes: LoteOpcion[];
};
// armados del kit, del más nuevo al más viejo: cuántos kits y de qué lote salió cada componente
export type ArmadoKit = { kits: number; comps: Record<string, { lot_id: string | null; qty: number }[]> };

type Fila = { lot_id: string; qty: number }; // lot_id "" = sin lote

// lo que queda en el estante es lo último que se armó: se sugiere el lote de los armados más nuevos
function sugerir(comp: ComponenteDesarme, armados: ArmadoKit[], kits: number): Fila[] {
  const out = new Map<string, number>();
  let resto = kits * comp.porKit;
  for (const a of armados) {
    if (resto <= 0) break;
    const filas = a.comps[comp.id] ?? [];
    let tope = Math.min(resto, a.kits * comp.porKit);
    for (const f of filas) {
      if (tope <= 0) break;
      const t = Math.min(tope, f.qty);
      out.set(f.lot_id ?? "", (out.get(f.lot_id ?? "") ?? 0) + t);
      tope -= t;
      resto -= t;
    }
  }
  if (resto > 0) out.set("", (out.get("") ?? 0) + resto);
  return [...out].map(([lot_id, qty]) => ({ lot_id, qty: Math.round(qty * 1000) / 1000 }));
}

const fecha = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("es-AR") : "sin vto.");

export function DesarmarKitForm({
  kitId,
  idem,
  ubicaciones,
  componentes,
  armados,
  action,
}: {
  kitId: string;
  idem: string;
  ubicaciones: { id: string; name: string }[];
  componentes: ComponenteDesarme[];
  armados: ArmadoKit[];
  action: (fd: FormData) => Promise<void>;
}) {
  const [cantidad, setCantidad] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [filas, setFilas] = useState<Record<string, Fila[]> | null>(null);
  const kits = Number(cantidad);

  const revisar = () => {
    if (!(kits > 0) || !ubicacion) return;
    setFilas(Object.fromEntries(componentes.map((c) => [c.id, sugerir(c, armados, kits)])));
  };
  const cambiar = (cid: string, i: number, f: Partial<Fila>) =>
    setFilas((s) => s && { ...s, [cid]: s[cid].map((x, j) => (j === i ? { ...x, ...f } : x)) });
  const sumar = (cid: string) => setFilas((s) => s && { ...s, [cid]: [...s[cid], { lot_id: "", qty: 0 }] });
  const quitar = (cid: string, i: number) => setFilas((s) => s && { ...s, [cid]: s[cid].filter((_, j) => j !== i) });

  const total = (cid: string) => (filas?.[cid] ?? []).reduce((a, f) => a + (Number(f.qty) || 0), 0);
  const cuadra = !!filas && componentes.every((c) => Math.abs(total(c.id) - kits * c.porKit) < 0.0005);
  const lotes = filas
    ? componentes.flatMap((c) => filas[c.id].filter((f) => Number(f.qty) > 0).map((f) => ({ component_id: c.id, lot_id: f.lot_id || null, quantity: Number(f.qty) })))
    : [];

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="kit" value={kitId} />
      <input type="hidden" name="idem" value={idem} />
      <input type="hidden" name="lotes" value={JSON.stringify(lotes)} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={label}>Kits a desarmar</label>
          <input
            type="number" name="cantidad" min="1" step="any" required value={cantidad}
            onChange={(e) => { setCantidad(e.target.value); setFilas(null); }}
            className={`${input} w-28`}
          />
        </div>
        <div className="min-w-40">
          <label className={label}>Ubicación</label>
          <select name="ubicacion" required value={ubicacion} onChange={(e) => { setUbicacion(e.target.value); setFilas(null); }} className={input}>
            <option value="">Elegir…</option>
            {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        {!filas && (
          <button
            type="button" onClick={revisar} disabled={!(kits > 0) || !ubicacion}
            className="rounded-lg border border-line px-5 py-2.5 font-medium text-rose-deep hover:border-blush disabled:opacity-50"
          >
            Desarmar…
          </button>
        )}
      </div>

      {filas && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-semibold">Confirmá a qué lote vuelve cada componente</p>
          <p className="mb-3 text-xs text-soft">
            Sugerido según con qué lotes se armaron los últimos kits. Si los kits son de tandas distintas
            (ej. una devolución), cambiá el lote o sumá otra línea.
          </p>
          <div className="space-y-3">
            {componentes.map((c) => {
              const t = total(c.id);
              const debe = kits * c.porKit;
              return (
                <div key={c.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{c.nombre}</span>
                    <span className={Math.abs(t - debe) < 0.0005 ? "text-soft" : "font-semibold text-red-700"}>
                      {fmtQty(t)} de {fmtQty(debe)}
                    </span>
                  </div>
                  {filas[c.id].map((f, i) => (
                    <div key={i} className="mt-1 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <select value={f.lot_id} onChange={(e) => cambiar(c.id, i, { lot_id: e.target.value })} className={input}>
                          <option value="">Sin lote</option>
                          {c.lotes.map((l) => <option key={l.id} value={l.id}>Lote {l.code} · vence {fecha(l.expires_on)}</option>)}
                        </select>
                      </div>
                      <div className="w-24 shrink-0">
                        <input
                          type="number" min="0" step="any" value={f.qty}
                          onChange={(e) => cambiar(c.id, i, { qty: Number(e.target.value) })}
                          className={input}
                        />
                      </div>
                      {filas[c.id].length > 1 && (
                        <button type="button" onClick={() => quitar(c.id, i)} className="text-sm text-soft hover:text-red-700" aria-label="Quitar línea">✕</button>
                      )}
                    </div>
                  ))}
                  {c.lotes.length > 0 && (
                    <button type="button" onClick={() => sumar(c.id)} className="mt-1 text-xs text-rose-deep hover:underline">+ otro lote</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {cuadra ? (
              <SubmitButton className="rounded-lg bg-rose-deep px-5 py-2.5 font-semibold text-white hover:bg-rose-deeper">
                Confirmar desarmado de {fmtQty(kits)} kit(s)
              </SubmitButton>
            ) : (
              <button type="button" disabled className="rounded-lg bg-rose-deep px-5 py-2.5 font-semibold text-white opacity-50">
                Las cantidades no cuadran
              </button>
            )}
            <button type="button" onClick={() => setFilas(null)} className="rounded-lg border border-line px-5 py-2.5 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
