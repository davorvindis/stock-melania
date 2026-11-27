import Link from "next/link";
import { ultimaCampania } from "@/lib/black-friday";

export function PestaniasVentas({ activa, forecast }: { activa: string; forecast: boolean }) {
  const lista = [
    { href: "/ventas", label: "Reportes" },
    ...(forecast ? [{ href: "/ventas/forecast", label: "Forecast" }] : []),
  ];
  // campaña de descuentos (Black Friday...): desde que empieza queda su resumen
  const campania = ultimaCampania();
  if (campania) lista.push({ href: "/ventas/campania", label: campania.nombre });
  if (lista.length < 2) return null;
  return (
    <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto">
      {lista.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
            p.href === activa ? "bg-rose-deep text-white" : "border border-line bg-white text-soft hover:text-ink"
          }`}
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}
