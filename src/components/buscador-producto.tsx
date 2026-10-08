"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type OpcionBuscador = { value: string; label: string; grupo?: string };

// sin acentos y en minúscula, para buscar "keratina" o "KERATINA" igual
const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const MAX_VISIBLES = 80;

// Selector de producto con buscador: escribís parte del nombre, SKU, lote o
// ubicación y filtra la lista. Envía el valor elegido con `name` (como un select).
export function BuscadorProducto({
  name,
  opciones,
  value,
  onChange,
  placeholder = "Buscar producto…",
  opcional = false,
}: {
  name: string;
  opciones: OpcionBuscador[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  opcional?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const listaId = useId();

  const elegida = opciones.find((o) => o.value === value);

  const filtradas = useMemo(() => {
    const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
    if (!palabras.length) return opciones;
    return opciones.filter((o) => {
      const l = normalizar(o.label);
      return palabras.every((p) => l.includes(p));
    });
  }, [texto, opciones]);
  const visibles = filtradas.slice(0, MAX_VISIBLES);

  // cerrar al tocar afuera
  useEffect(() => {
    const fuera = (e: MouseEvent | TouchEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("touchstart", fuera);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("touchstart", fuera);
    };
  }, []);

  // mantener visible la opción activa al navegar con el teclado
  useEffect(() => {
    lista.current?.querySelector(`[data-i="${activo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activo]);

  function elegir(o: OpcionBuscador) {
    onChange(o.value);
    setTexto("");
    setAbierto(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAbierto(true);
      setActivo((a) => Math.min(a + 1, visibles.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (abierto && visibles[activo]) {
        e.preventDefault();
        elegir(visibles[activo]);
      }
    } else if (e.key === "Escape") {
      setAbierto(false);
    }
  }

  return (
    <div ref={caja} className="relative">
      {/* valor real del form; required para que el navegador avise si falta */}
      <input
        name={name}
        value={value}
        required={!opcional}
        onChange={() => {}}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
      />

      {elegida && !abierto ? (
        <button
          type="button"
          onClick={() => {
            setAbierto(true);
            setActivo(0);
          }}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-blush bg-blush-50 px-3 py-2.5 text-left text-base"
        >
          <EtiquetaOpcion label={elegida.label} />
          <span className="flex shrink-0 gap-2 text-xs font-medium text-rose-deep">
            Cambiar
            {opcional && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    onChange("");
                  }
                }}
                className="text-soft hover:text-red-700"
              >
                Quitar
              </span>
            )}
          </span>
        </button>
      ) : (
        <input
          type="search"
          value={texto}
          autoFocus={abierto && !!elegida}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
            setActivo(0);
          }}
          onFocus={() => setAbierto(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={listaId}
          aria-autocomplete="list"
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
        />
      )}

      {abierto && (
        <ul
          ref={lista}
          id={listaId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg"
        >
          {visibles.map((o, i) => (
            <li key={o.value}>
              {o.grupo && o.grupo !== visibles[i - 1]?.grupo && (
                <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-soft">
                  {o.grupo}
                </div>
              )}
              <button
                type="button"
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActivo(i)}
                onClick={() => elegir(o)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  i === activo ? "bg-blush-100" : ""
                } ${o.value === value ? "font-semibold" : ""}`}
              >
                <EtiquetaOpcion label={o.label} />
              </button>
            </li>
          ))}
          {filtradas.length === 0 && (
            <li className="px-3 py-3 text-sm text-soft">Ningún producto coincide con “{texto}”.</li>
          )}
          {filtradas.length > MAX_VISIBLES && (
            <li className="px-3 py-2 text-xs text-soft">
              Mostrando {MAX_VISIBLES} de {filtradas.length}: escribí más para achicar la lista.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// "Producto · lote X · Ubicación (cant)": nombre destacado, el resto en gris
function EtiquetaOpcion({ label }: { label: string }) {
  const [nombre, ...resto] = label.split(" · ");
  return (
    <span className="min-w-0">
      <span className="text-ink">{nombre}</span>
      {resto.length > 0 && <span className="text-soft"> · {resto.join(" · ")}</span>}
    </span>
  );
}
