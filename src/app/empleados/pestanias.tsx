import Link from "next/link";

const PESTANIAS = [
  { href: "/empleados", label: "Novedades del mes" },
  { href: "/empleados/evolucion", label: "Evolución" },
  { href: "/empleados/personal", label: "Personal" },
];

export function Pestanias({ activa }: { activa: string }) {
  return (
    <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto">
      {PESTANIAS.map((p) => (
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
