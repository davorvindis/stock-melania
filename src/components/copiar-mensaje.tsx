"use client";

import { useRef, useState } from "react";

// mensaje listo para pegar en WhatsApp, con botón de copiar
export function CopiarMensaje({ texto }: { texto: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // sin permiso de portapapeles: queda seleccionado para copiar a mano
      ref.current?.select();
      document.execCommand("copy");
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }
  return (
    <div>
      <textarea
        ref={ref}
        readOnly
        value={texto}
        rows={Math.min(30, texto.split("\n").length + 1)}
        className="w-full rounded-lg border border-line bg-blush-50 px-3 py-2.5 font-mono text-sm leading-relaxed"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        onClick={copiar}
        className="mt-2 rounded-lg bg-rose-deep px-6 py-3 text-base font-semibold text-white hover:bg-rose-deeper"
      >
        {copiado ? "¡Copiado! Pegalo en WhatsApp" : "Copiar mensaje"}
      </button>
    </div>
  );
}
