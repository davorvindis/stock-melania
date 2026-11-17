import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Bebas_Neue, Montserrat } from "next/font/google";
import { Nav } from "@/components/nav";
import { SinRuedaEnNumeros } from "@/components/sin-rueda-en-numeros";
import { getSessionUser, allowedSections, can } from "@/lib/auth";
import { getPedidosListos } from "@/lib/pedidos-listos";
import { BannerPedidosListos } from "@/components/pedidos-listos";
import { logout } from "@/lib/auth-actions";
import { db } from "@/lib/db";
import { cumpleanerosHoy } from "@/lib/cumples";
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
  const [ubicacion, listos, cumples] = await Promise.all([
    user?.location_id
      ? db().from("locations").select("name").eq("id", user.location_id).maybeSingle().then((r) => r.data?.name ?? null)
      : null,
    // recordatorio de pedidos armados que no salieron: para quien trabaja con Pedidos Wix
    conMenu && can(user, "pedidos") ? getPedidosListos().catch(() => null) : null,
    conMenu ? cumpleanerosHoy().catch(() => []) : [],
  ]);
  const nombres = cumples.map((c) => c.alias);
  const cumpleYo = !!user && cumples.some((c) => c.id === user.id);
  const listaNombres = nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}` : nombres[0];

  return (
    <html lang="es" className={`${bebas.variable} ${montserrat.variable}`}>
      <body className="min-h-screen antialiased">
        <SinRuedaEnNumeros />
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
                    <Link
                      href="/manual"
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-soft hover:bg-blush-100 hover:text-ink"
                    >
                      Manual
                    </Link>
                    <span className="text-sm text-soft">
                      <span className="hidden sm:inline">{user.alias}</span>
                      {ubicacion && <span className="ml-1 text-xs">📍 {ubicacion}</span>}
                    </span>
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
            {user.role === "VIEWER" && (
              <div className="border-b border-line bg-blush-100 px-4 py-1.5 text-center text-xs text-soft">
                Usuario de solo lectura: podés ver y descargar todo lo de tus pestañas, pero no modificar.
              </div>
            )}
            {nombres.length > 0 && (
              <div className="border-b border-blush bg-blush-100 px-4 py-2.5 text-center">
                <p className="font-display text-xl tracking-wide text-rose-deeper sm:text-2xl">
                  🎂🎉 ¡Feliz cumple, {listaNombres}! 🥳🎈
                </p>
                <p className="text-xs text-soft">
                  {cumpleYo ? "Que tengas un día hermoso. ¡Todo el equipo de Melania te saluda! 💖" : `Hoy es su cumple: no te olvides de saludar${nombres.length > 1 ? "los" : ""} 🎁`}
                </p>
              </div>
            )}
            {listos && <BannerPedidosListos r={listos} />}
            <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          </>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
