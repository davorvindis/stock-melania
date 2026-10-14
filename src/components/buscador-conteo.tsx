"use client";

import { useEffect, useMemo, useState } from "react";

const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Filtro de las líneas del conteo por tipo y por texto, sin recargar la página:
// las líneas ocultas siguen en el formulario, así no se pierde lo ya cargado.
export function BuscadorConteo({
  contenedorId,
  tipos,
  lineas,
  inicialTipo = "",
}: {
  contenedorId: string;
  tipos: { value: string; label: string; cantidad: number }[];
  lineas: { id: string; tipo: string; buscar: string }[];
  inicialTipo?: string;
}) {
  const [tipo, setTipo] = useState(inicialTipo);
  const [texto, setTexto] = useState("");
  const total = lineas.length;

  // qué líneas se ven con el tipo y el texto actuales
  const mostrar = useMemo(() => {
    const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
    return new Set(
      lineas
        .filter((l) => (!tipo || l.tipo === tipo) && palabras.every((p) => normalizar(l.buscar).includes(p)))
        .map((l) => l.id)
    );
  }, [lineas, tipo, texto]);
  const visibles = mostrar.size;

  // ocultar/mostrar las tarjetas del formulario (siguen enviándose aunque estén ocultas)
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(`#${contenedorId} [data-linea]`).forEach((el) => {
      el.hidden = !mostrar.has(el.dataset.linea ?? "");
    });
  }, [mostrar, contenedorId]);

  const pill = (activo: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${activo ? "border-rose-deep bg-rose-deep text-white" : "border-line bg-white text-soft hover:border-blush"}`;

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-3 space-y-2 bg-white px-1 pb-2 pt-1">
      <input type="hidden" name="tipo" value={tipo} />
      <input
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar producto, SKU o lote…"
        autoComplete="off"
        className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setTipo("")} className={pill(!tipo)}>
          Todos ({total})
        </button>
        {tipos.map((t) => (
          <button key={t.value} type="button" onClick={() => setTipo(t.value)} className={pill(tipo === t.value)}>
            {t.label} ({t.cantidad})
          </button>
        ))}
        {(texto || tipo) && (
          <span className="ml-auto text-xs text-soft">
            Mostrando {visibles} de {total}
          </span>
        )}
      </div>
      {visibles === 0 && <p className="text-sm text-soft">Ningún producto coincide con la búsqueda.</p>}
    </div>
  );
}
