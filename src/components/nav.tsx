"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard", section: "dashboard" },
  { href: "/stock", label: "Stock", section: "stock" },
  { href: "/lotes", label: "Lotes", section: "lotes" },
  { href: "/ingresos/nuevo", label: "Nuevo ingreso", section: "ingresos" },
  { href: "/movimientos/nuevo", label: "Nuevo movimiento", section: "movimientos" },
  { href: "/movimientos", label: "Movimientos", section: "movimientos" },
  { href: "/ventas", label: "Ventas", section: "ventas" },
  { href: "/conteos", label: "Conteos", section: "conteos" },
  { href: "/productos", label: "Productos", section: "productos" },
  { href: "/proveedores", label: "Proveedores", section: "proveedores" },
  { href: "/ubicaciones", label: "Ubicaciones", section: "ubicaciones" },
  { href: "/auditoria", label: "Auditoría", section: "auditoria" },
  { href: "/compras", label: "Órdenes de compra", section: "compras" },
  { href: "/costos", label: "Costos", section: "costos" },
  { href: "/faltas", label: "Faltas y horas", section: "faltas" },
  { href: "/vacaciones", label: "Vacaciones", section: "vacaciones" },
  { href: "/configuracion", label: "Configuración", section: "configuracion" },
];

export function Nav({ sections }: { sections: string[] }) {
  const pathname = usePathname();
  const visible = items.filter((i) => sections.includes(i.section));
  // activo = el ítem cuyo href sea el prefijo más largo de la ruta actual
  const best = visible
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto pb-3 -mx-1 md:flex-wrap md:overflow-visible">
      {visible.map((item) => {
        const active = best?.href === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-blush text-ink font-semibold"
                : "text-soft hover:bg-blush-100 hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
