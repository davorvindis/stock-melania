"use client";

import { useState } from "react";

const iso = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);

function rangos(): { label: string; desde: string; hasta: string }[] {
  const hoy = iso(new Date());
  const [y, m, d] = hoy.split("-").map(Number);
  const fecha = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm - 1, dd, 12)));
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0 = domingo
  const lunes = fecha(y, m, d - ((dow + 6) % 7));
  return [
    { label: "Hoy", desde: hoy, hasta: hoy },
    { label: "Ayer", desde: fecha(y, m, d - 1), hasta: fecha(y, m, d - 1) },
    { label: "Esta semana", desde: lunes, hasta: hoy },
    { label: "Este mes", desde: fecha(y, m, 1), hasta: hoy },
    { label: "Mes pasado", desde: fecha(y, m - 1, 1), hasta: fecha(y, m, 0) },
    { label: "Últimos 30 días", desde: fecha(y, m, d - 29), hasta: hoy },
  ];
}

const campo =
  "w-full min-w-[9.5rem] cursor-pointer rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";

// abre el calendario al tocar en cualquier parte del campo (no solo en el ícono)
function abrir(e: React.MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    /* algunos navegadores no lo permiten: queda el campo normal */
  }
}

// "Desde" / "Hasta" con botones de rango rápido; los valores van en el form que lo contiene
export function RangoFechas({
  desde: desdeInicial = "",
  hasta: hastaInicial = "",
  className = "",
}: {
  desde?: string;
  hasta?: string;
  className?: string;
}) {
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const opciones = rangos();

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className}`}>
      <div className="w-[calc(50%-0.25rem)] sm:w-44">
        <label className="mb-1 block text-xs font-medium text-soft">Desde</label>
        <input type="date" name="desde" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} onClick={abrir} className={campo} />
      </div>
      <div className="w-[calc(50%-0.25rem)] sm:w-44">
        <label className="mb-1 block text-xs font-medium text-soft">Hasta</label>
        <input type="date" name="hasta" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} onClick={abrir} className={campo} />
      </div>
      <div className="flex flex-wrap gap-1.5 pb-1">
        {opciones.map((o) => {
          const activo = o.desde === desde && o.hasta === hasta;
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                setDesde(o.desde);
                setHasta(o.hasta);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                activo ? "border-rose-deep bg-rose-deep text-white" : "border-line bg-white text-soft hover:border-blush"
              }`}
            >
              {o.label}
            </button>
          );
        })}
        {(desde || hasta) && (
          <button
            type="button"
            onClick={() => {
              setDesde("");
              setHasta("");
            }}
            className="px-2 py-1 text-xs text-soft hover:text-ink"
          >
            Sin fechas
          </button>
        )}
      </div>
    </div>
  );
}
