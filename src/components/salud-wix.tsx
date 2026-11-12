import Link from "next/link";
import type { SaludWix } from "@/lib/wix/salud";

const COLOR = {
  ok: { punto: "bg-emerald-500", caja: "border-emerald-200", texto: "Funcionando" },
  alerta: { punto: "bg-amber-400", caja: "border-amber-300", texto: "Revisar" },
  error: { punto: "bg-red-600", caja: "border-red-300", texto: "Con problemas" },
} as const;

// cuadro en Integración Wix: cada cosa que tiene que pasar sola, en verde / amarillo / rojo
export function PanelSaludWix({ s }: { s: SaludWix }) {
  return (
    <div className={`mt-4 rounded-xl border-2 bg-white p-4 ${COLOR[s.estado].caja}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${COLOR[s.estado].punto}`} />
        <h2 className="font-semibold">Estado de la conexión con Wix: {COLOR[s.estado].texto}</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {s.controles.map((c) => (
          <div key={c.titulo} className="rounded-lg border border-line p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLOR[c.estado].punto}`} />
              {c.titulo}
            </p>
            <p className={`mt-1 text-sm ${c.estado === "error" ? "text-red-800" : "text-soft"}`}>{c.detalle}</p>
            {c.nombres && c.nombres.length > 0 && (
              <ul className="ml-4 mt-1 list-disc text-xs text-soft">
                {c.nombres.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// franja en el Dashboard: solo si algo está en rojo
export function FranjaSaludWix({ s, conLink }: { s: SaludWix; conLink: boolean }) {
  if (s.estado !== "error") return null;
  const problemas = s.controles.filter((c) => c.estado === "error");
  return (
    <div className="mb-4 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <p className="font-semibold">La conexión con la web (Wix) tiene un problema</p>
      <ul className="ml-4 mt-1 list-disc">
        {problemas.map((c) => <li key={c.titulo}><b>{c.titulo}:</b> {c.detalle}</li>)}
      </ul>
      {conLink ? (
        <Link href="/wix" className="mt-1 inline-block font-semibold text-rose-deep hover:underline">Ver Integración Wix →</Link>
      ) : (
        <p className="mt-1 text-xs">Avisale a Joel.</p>
      )}
    </div>
  );
}
