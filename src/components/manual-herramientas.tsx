"use client";

import { useState } from "react";

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// buscador del manual (oculta los capítulos que no tienen la palabra) e imprimir / PDF
export function ManualHerramientas({ contenedorId }: { contenedorId: string }) {
  const [texto, setTexto] = useState("");
  const [visibles, setVisibles] = useState<number | null>(null);

  const buscar = (valor: string) => {
    setTexto(valor);
    const palabras = normalizar(valor).split(/\s+/).filter(Boolean);
    let n = 0;
    document.querySelectorAll<HTMLElement>(`#${contenedorId} [data-capitulo]`).forEach((el) => {
      el.hidden = false;
      const ok = palabras.every((p) => normalizar(el.innerText).includes(p));
      el.hidden = !ok;
      if (ok) n++;
    });
    setVisibles(palabras.length ? n : null);
  };

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-[var(--background,#fdf6f5)] px-1 py-2 print:hidden">
      <input
        type="search"
        value={texto}
        onChange={(e) => buscar(e.target.value)}
        placeholder="Buscar en el manual: reembolso, blister, seguimiento…"
        className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
      />
      <button
        type="button"
        onClick={() => window.print()}
        className="shrink-0 rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-semibold text-rose-deep hover:bg-blush-50"
      >
        Imprimir / PDF
      </button>
      {visibles !== null && (
        <span className="w-full text-xs text-soft">
          {visibles === 0 ? "No hay nada con esa búsqueda." : `${visibles} tema(s) con esa búsqueda`}
        </span>
      )}
    </div>
  );
}
