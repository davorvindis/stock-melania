"use client";

import { useMemo, useState } from "react";
import { fmtQty } from "@/lib/types";

export type ProductoCatalogo = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  type: string;
  category: string | null;
};

type Item = { id: string; quantity: number };

const TIPO_CORTO: Record<string, string> = {
  TERMINADO: "Terminado",
  MONODOSIS: "Monodosis",
  INSUMO: "Insumo",
  PACKAGING: "Packaging",
  GRANEL: "Granel",
  ACCESORIO: "Accesorio",
};

const MIME = "application/x-melania-producto";

// Armador visual de kits: arrastrar productos del catálogo a la caja del kit
// (o tocar "+" en mobile). Emite inputs ocultos comp_id/comp_qty para el form
// que lo contiene; el guardado real lo hace la server action.
export function KitBuilder({
  productos,
  inicial = [],
}: {
  productos: ProductoCatalogo[];
  inicial?: Item[];
}) {
  const [items, setItems] = useState<Item[]>(inicial);
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState<string>("");
  const [sobreCaja, setSobreCaja] = useState(false);
  const [sobreCatalogo, setSobreCatalogo] = useState(false);
  const [recienAgregado, setRecienAgregado] = useState<string | null>(null);

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const enKit = useMemo(() => new Set(items.map((i) => i.id)), [items]);

  const tiposDisponibles = useMemo(
    () => [...new Set(productos.map((p) => p.type))].filter((t) => TIPO_CORTO[t]),
    [productos],
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter(
      (p) =>
        !enKit.has(p.id) &&
        (!tipo || p.type === tipo) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q)),
    );
  }, [productos, enKit, busqueda, tipo]);

  function agregar(id: string) {
    if (!porId.has(id)) return;
    setItems((prev) =>
      prev.some((i) => i.id === id)
        ? prev.map((i) => (i.id === id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...prev, { id, quantity: 1 }],
    );
    setRecienAgregado(id);
    setTimeout(() => setRecienAgregado((r) => (r === id ? null : r)), 600);
  }

  function quitar(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function setCantidad(id: string, q: number) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: q } : i)));
  }

  const totalUnidades = items.reduce((s, i) => s + (Number.isFinite(i.quantity) ? i.quantity : 0), 0);

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.1fr]">
      {items.map((i) => (
        <span key={i.id} hidden>
          <input type="hidden" name="comp_id" value={i.id} />
          <input type="hidden" name="comp_qty" value={String(i.quantity)} />
        </span>
      ))}

      {/* ── Catálogo ── */}
      <section
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(`${MIME}-kit`)) {
            e.preventDefault();
            setSobreCatalogo(true);
          }
        }}
        onDragLeave={() => setSobreCatalogo(false)}
        onDrop={(e) => {
          setSobreCatalogo(false);
          const id = e.dataTransfer.getData(`${MIME}-kit`);
          if (id) quitar(id);
        }}
        className={`flex min-h-0 flex-col rounded-xl border bg-white p-3 transition ${
          sobreCatalogo ? "border-red-300 bg-red-50/40" : "border-line"
        }`}
      >
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-display text-2xl leading-none tracking-wide">Productos</h3>
          <span className="text-xs text-soft">{visibles.length} disponibles</span>
        </div>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, SKU o categoría…"
          className="mb-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100"
        />
        <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto">
          {["", ...tiposDisponibles].map((t) => (
            <button
              key={t || "todos"}
              type="button"
              onClick={() => setTipo(t)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
                tipo === t
                  ? "border-rose-deep bg-rose-deep text-white"
                  : "border-line bg-white text-soft hover:border-blush"
              }`}
            >
              {t ? TIPO_CORTO[t] : "Todos"}
            </button>
          ))}
        </div>

        <ul className="-mx-1 max-h-[26rem] space-y-1.5 overflow-y-auto px-1">
          {visibles.map((p) => (
            <li
              key={p.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(MIME, p.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onDoubleClick={() => agregar(p.id)}
              className="group flex cursor-grab items-center gap-3 rounded-lg border border-blush-100 bg-blush-50/60 p-2.5 transition hover:border-blush hover:bg-white hover:shadow-sm active:cursor-grabbing"
            >
              <span aria-hidden className="select-none text-soft/50 group-hover:text-rose-deep">
                ⠿
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-soft">
                  <span className="font-mono">{p.sku}</span>
                  {TIPO_CORTO[p.type] && ` · ${TIPO_CORTO[p.type]}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => agregar(p.id)}
                aria-label={`Agregar ${p.name} al kit`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-lg leading-none text-rose-deep transition hover:border-rose-deep hover:bg-rose-deep hover:text-white"
              >
                +
              </button>
            </li>
          ))}
          {visibles.length === 0 && (
            <li className="py-8 text-center text-sm text-soft">
              {busqueda || tipo ? "Nada coincide con la búsqueda" : "Ya agregaste todos los productos"}
            </li>
          )}
        </ul>
        <p className="mt-2 hidden text-xs text-soft md:block">
          Arrastrá un producto a la caja, o tocá <b>+</b>. Para sacarlo, arrastralo de vuelta acá.
        </p>
      </section>

      {/* ── Caja del kit ── */}
      <section
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setSobreCaja(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobreCaja(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setSobreCaja(false);
          const id = e.dataTransfer.getData(MIME);
          if (id) agregar(id);
        }}
        className={`relative flex min-h-72 flex-col rounded-2xl border-2 border-dashed p-4 transition-all ${
          sobreCaja
            ? "scale-[1.01] border-rose-deep bg-blush-100 shadow-lg"
            : items.length
              ? "border-blush bg-white"
              : "border-blush bg-blush-50"
        }`}
      >
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl leading-none tracking-wide">
            <span aria-hidden>🎁 </span>Contenido del kit
          </h3>
          {items.length > 0 && (
            <span className="rounded-full bg-blush-100 px-2.5 py-0.5 text-xs font-semibold text-rose-deeper">
              {items.length} producto{items.length === 1 ? "" : "s"} · {fmtQty(totalUnidades)} u.
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="pointer-events-none flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-dashed text-4xl transition ${
                sobreCaja ? "rotate-6 border-rose-deep" : "border-blush"
              }`}
            >
              📦
            </div>
            <p className="font-medium text-ink">{sobreCaja ? "¡Soltalo acá!" : "La caja está vacía"}</p>
            <p className="max-w-xs text-sm text-soft">
              Arrastrá productos desde la lista o tocá <b>+</b> para sumarlos al kit.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((i) => {
              const p = porId.get(i.id);
              if (!p) return null;
              const invalida = !(i.quantity > 0);
              return (
                <li
                  key={i.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(`${MIME}-kit`, i.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className={`flex items-center gap-3 rounded-xl border bg-white p-2.5 shadow-sm transition ${
                    recienAgregado === i.id ? "animate-[pop_0.5s_ease-out] border-rose-deep" : "border-blush-100"
                  } ${invalida ? "border-red-300" : ""}`}
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blush-100 font-display text-lg text-rose-deeper"
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate font-mono text-xs text-soft">{p.sku}</span>
                  </span>
                  <span className="flex shrink-0 items-center rounded-lg border border-line">
                    <button
                      type="button"
                      onClick={() => (i.quantity <= 1 ? quitar(i.id) : setCantidad(i.id, i.quantity - 1))}
                      aria-label="Restar"
                      className="h-8 w-8 text-lg leading-none text-rose-deep hover:bg-blush-50"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      inputMode="decimal"
                      value={Number.isFinite(i.quantity) ? i.quantity : ""}
                      onChange={(e) => setCantidad(i.id, parseFloat(e.target.value))}
                      aria-label={`Cantidad de ${p.name} por kit`}
                      className="h-8 w-14 border-x border-line text-center text-sm font-semibold [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setCantidad(i.id, (Number.isFinite(i.quantity) ? i.quantity : 0) + 1)}
                      aria-label="Sumar"
                      className="h-8 w-8 text-lg leading-none text-rose-deep hover:bg-blush-50"
                    >
                      +
                    </button>
                  </span>
                  <span className="hidden w-12 text-xs text-soft sm:block">{p.unit}</span>
                  <button
                    type="button"
                    onClick={() => quitar(i.id)}
                    aria-label={`Quitar ${p.name}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-soft hover:bg-red-50 hover:text-red-700"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
            <li
              className={`rounded-xl border-2 border-dashed py-3 text-center text-xs transition ${
                sobreCaja ? "border-rose-deep text-rose-deep" : "border-blush-100 text-soft"
              }`}
            >
              {sobreCaja ? "Soltá para agregar" : "Arrastrá más productos acá"}
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}
