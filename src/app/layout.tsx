import type { Metadata } from "next";
import Image from "next/image";
import { Bebas_Neue, Montserrat } from "next/font/google";
import { Nav } from "@/components/nav";
import { getSessionUser, allowedSections } from "@/lib/auth";
import { logout } from "@/lib/auth-actions";
import "./globals.css";

const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-bebas" });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });

export const metadata: Metadata = {
  title: "Stock Melania",
  description: "Inventario de Melania Professional — fuente de verdad del stock",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const conMenu = user && !user.must_change_pin;

  return (
    <html lang="es" className={`${bebas.variable} ${montserrat.variable}`}>
      <body className="min-h-screen antialiased">
        {conMenu ? (
          <>
            <header className="border-b border-line bg-white">
              <div className="mx-auto max-w-6xl px-4">
                <div className="flex items-end justify-between py-4">
                  <div className="flex items-end gap-3">
                    <Image
                      src="/logo-melania.png"
                      alt="Melania Professional"
                      width={142}
                      height={48}
                      priority
                    />
                    <span className="font-display text-2xl leading-none text-ink">Stock</span>
                  </div>
                  <form action={logout} className="flex items-center gap-2">
                    <span className="hidden text-sm text-soft sm:inline">{user.alias}</span>
                    <button
                      type="submit"
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-soft hover:bg-blush-100 hover:text-ink"
                    >
                      Salir
                    </button>
                  </form>
                </div>
                <Nav sections={allowedSections(user)} />
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          </>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
