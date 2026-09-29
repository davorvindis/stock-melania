"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard" },
  { href: "/stock", label: "Stock" },
  { href: "/ingresos/nuevo", label: "Nuevo ingreso" },
  { href: "/movimientos/nuevo", label: "Nuevo movimiento" },
  { href: "/movimientos", label: "Movimientos" },
  { href: "/productos", label: "Productos" },
  { href: "/proveedores", label: "Proveedores" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto pb-3 -mx-1">
      {items.map((item) => {
        const active = pathname === item.href;
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
