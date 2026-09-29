import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Melania",
  description: "Inventario de Melania — fuente de verdad del stock",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/stock", label: "Stock" },
  { href: "/ingresos/nuevo", label: "Nuevo ingreso" },
  { href: "/movimientos/nuevo", label: "Nuevo movimiento" },
  { href: "/movimientos", label: "Movimientos" },
  { href: "/productos", label: "Productos" },
  { href: "/proveedores", label: "Proveedores" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-stone-50 text-stone-800 antialiased">
        <header className="bg-white border-b border-stone-200">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex items-center gap-3 py-4">
              <span className="text-xl font-semibold tracking-wide text-rose-900">Melania</span>
              <span className="text-xs uppercase tracking-widest text-stone-400 mt-1">Stock</span>
            </div>
            <nav className="flex gap-1 overflow-x-auto pb-2 -mx-1">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-stone-600 hover:bg-rose-50 hover:text-rose-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
