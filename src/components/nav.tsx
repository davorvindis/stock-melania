"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Item = { href: string; label: string; section: string };
type Grupo = { id: string; label: string; items: Item[] };

// arriba los grupos; abajo las pestañas del grupo abierto (o del que estás usando)
const grupos: Grupo[] = [
  { id: "inicio", label: "Dashboard", items: [{ href: "/", label: "Dashboard", section: "dashboard" }] },
  {
    id: "ventas",
    label: "Ventas",
    items: [
      { href: "/ventas", label: "Ventas", section: "ventas" },
      { href: "/caja", label: "Cierre de caja", section: "caja" },
      { href: "/preventa", label: "Preventa", section: "preventa" },
    ],
  },
  {
    id: "wix",
    label: "Pedidos Wix",
    items: [
      { href: "/pedidos", label: "Pedidos Wix", section: "pedidos" },
      { href: "/equivalencias", label: "Equivalencias Wix", section: "wix" },
      { href: "/wix", label: "Integración Wix", section: "wix" },
    ],
  },
  {
    id: "stock",
    label: "Stock",
    items: [
      { href: "/stock", label: "Stock", section: "stock" },
      { href: "/movimientos", label: "Movimientos", section: "movimientos" },
      { href: "/movimientos/nuevo", label: "Nuevo movimiento", section: "movimientos" },
      { href: "/ingresos/nuevo", label: "Nuevo ingreso", section: "ingresos" },
      { href: "/lotes", label: "Lotes", section: "lotes" },
      { href: "/conteos", label: "Conteos", section: "conteos" },
    ],
  },
  {
    id: "compras",
    label: "Productos y compras",
    items: [
      { href: "/productos", label: "Productos", section: "productos" },
      { href: "/precios", label: "Precios", section: "precios" },
      { href: "/costos", label: "Costos", section: "costos" },
      { href: "/compras", label: "Órdenes de compra", section: "compras" },
      { href: "/proveedores", label: "Proveedores", section: "proveedores" },
    ],
  },
  {
    id: "equipo",
    label: "Equipo",
    items: [
      { href: "/faltas", label: "Faltas y horas", section: "faltas" },
      { href: "/vacaciones", label: "Vacaciones", section: "vacaciones" },
      { href: "/empleados", label: "Empleados", section: "empleados" },
    ],
  },
  {
    id: "ajustes",
    label: "Ajustes",
    items: [
      { href: "/ubicaciones", label: "Ubicaciones", section: "ubicaciones" },
      { href: "/auditoria", label: "Auditoría", section: "auditoria" },
      { href: "/configuracion", label: "Configuración", section: "configuracion" },
    ],
  },
];

const pill = (activo: boolean) =>
  `whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
    activo ? "bg-blush text-ink font-semibold" : "text-soft hover:bg-blush-100 hover:text-ink"
  }`;

export function Nav({ sections }: { sections: string[] }) {
  const pathname = usePathname();
  const visibles = grupos
    .map((g) => ({ ...g, items: g.items.filter((i) => sections.includes(i.section)) }))
    .filter((g) => g.items.length > 0);
  // activo = el ítem cuyo href sea el prefijo más largo de la ruta actual
  const best = visibles
    .flatMap((g) => g.items.map((i) => ({ ...i, grupo: g.id })))
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const [abierto, setAbierto] = useState<string | null>(null);
  useEffect(() => setAbierto(null), [pathname]);
  // quien ve pocas pestañas (ej. Karla) no necesita grupos
  const total = visibles.reduce((s, g) => s + g.items.length, 0);
  if (total <= 6) {
    return (
      <nav className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto pb-3 md:flex-wrap md:overflow-visible">
        {visibles.flatMap((g) => g.items).map((i) => (
          <Link key={i.href} href={i.href} className={pill(best?.href === i.href)}>
            {i.label}
          </Link>
        ))}
      </nav>
    );
  }
  const mostrado = visibles.find((g) => g.id === (abierto ?? best?.grupo));
  return (
    <nav className="pb-3">
      <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto md:flex-wrap md:overflow-visible">
        {visibles.map((g) =>
          g.items.length === 1 ? (
            <Link key={g.id} href={g.items[0].href} className={pill(best?.grupo === g.id)}>
              {g.items[0].label}
            </Link>
          ) : (
            <button
              key={g.id}
              type="button"
              aria-expanded={mostrado?.id === g.id}
              onClick={() => setAbierto(mostrado?.id === g.id && abierto ? null : g.id)}
              className={`${pill(best?.grupo === g.id)} ${mostrado?.id === g.id && best?.grupo !== g.id ? "bg-blush-100 text-ink" : ""}`}
            >
              {g.label} <span className="text-xs">{mostrado?.id === g.id ? "▴" : "▾"}</span>
            </button>
          )
        )}
      </div>
      {mostrado && mostrado.items.length > 1 && (
        <div className="no-scrollbar -mx-1 mt-2 flex gap-1 overflow-x-auto border-t border-blush-100 pt-2 md:flex-wrap md:overflow-visible">
          {mostrado.items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
                best?.href === i.href ? "bg-rose-deep font-semibold text-white" : "text-soft hover:bg-blush-100 hover:text-ink"
              }`}
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
