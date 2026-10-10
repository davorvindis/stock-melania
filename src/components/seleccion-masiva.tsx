"use client";

import { useEffect, useState } from "react";

// Barra para borrar varios registros juntos. Las casillas viven en cada tarjeta
// (con form={formId}) y esta barra las cuenta, permite marcarlas todas y confirma antes de enviar.
export function SeleccionMasiva({
  formId,
  action,
  volver,
  total,
}: {
  formId: string;
  action: (formData: FormData) => void | Promise<void>;
  volver: string;
  total: number;
}) {
  const [marcadas, setMarcadas] = useState(0);
  const casillas = () =>
    [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${formId}"]`)];

  useEffect(() => {
    const contar = () => setMarcadas(casillas().filter((c) => c.checked).length);
    document.addEventListener("change", contar);
    return () => document.removeEventListener("change", contar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const todas = marcadas > 0 && marcadas === total;
  const alternar = () => {
    const nuevo = !todas;
    casillas().forEach((c) => (c.checked = nuevo));
    setMarcadas(nuevo ? total : 0);
  };

  if (total === 0) return null;
  return (
    <form
      id={formId}
      action={action}
      onSubmit={(e) => {
        if (!marcadas || !confirm(`¿Eliminar ${marcadas} registro(s)? No se puede deshacer.`)) e.preventDefault();
      }}
      className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white/95 px-3 py-2 text-sm backdrop-blur"
    >
      <input type="hidden" name="volver" value={volver} />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={todas} onChange={alternar} className="h-4 w-4 accent-rose-deep" />
        Seleccionar todos ({total})
      </label>
      <button
        type="submit"
        disabled={!marcadas}
        className="ml-auto rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-40"
      >
        Eliminar seleccionados{marcadas ? ` (${marcadas})` : ""}
      </button>
    </form>
  );
}
