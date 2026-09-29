import type { Metadata } from "next";
import Image from "next/image";
import { Bebas_Neue, Montserrat } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-bebas" });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });

export const metadata: Metadata = {
  title: "Stock Melania",
  description: "Inventario de Melania Professional — fuente de verdad del stock",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${bebas.variable} ${montserrat.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-white">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex items-end gap-3 py-4">
              <Image
                src="/logo-melania.png"
                alt="Melania Professional"
                width={142}
                height={48}
                priority
              />
              <span className="font-display text-2xl leading-none text-ink">Stock</span>
            </div>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
