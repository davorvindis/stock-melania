import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSection } from "@/lib/auth";
import { cajaInicialSugerida, getCierre, marcarVisto } from "@/lib/caja";
import { hoyAR } from "@/lib/backup";
import { fmtDateTime } from "@/lib/types";
import { Flash, PageTitle } from "@/components/ui";
import { CierreEditor } from "@/components/cierre-editor";

export const dynamic = "force-dynamic";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export default async function CierreDia({
  params,
  searchParams,
}: {
  params: Promise<{ fecha: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireSection("caja");
  const { fecha: f } = await params;
  const { ok, error } = await searchParams;
  const fecha = f === "hoy" ? hoyAR() : f;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) notFound();
  if (fecha > hoyAR()) notFound();

  const [cierre, sugerida] = await Promise.all([getCierre(fecha), cajaInicialSugerida(fecha)]);
  // Joel y Mel: abrir el cierre enviado apaga el aviso
  if (cierre?.status === "ENVIADO" && user.role === "ADMIN") await marcarVisto(cierre.id, user.id);

  const [y, m, d] = fecha.split("-").map(Number);
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];

  return (
    <div>
      <Link href="/caja" className="text-sm text-rose-deep hover:underline">
        ← Cierres de caja
      </Link>
      <PageTitle>
        Cierre de caja · {dia} {fecha.split("-").reverse().join("/")}
      </PageTitle>
      <Flash ok={ok} error={error} />
      <p className="mb-3 text-sm text-soft">
        {cierre
          ? cierre.status === "ENVIADO"
            ? `✅ Enviado por ${cierre.submitted_by ?? "—"} el ${fmtDateTime(cierre.submitted_at!)}. Si corregís algo, volvé a enviarlo.`
            : `📝 Borrador, guardado por ${cierre.updated_by ?? "—"} el ${fmtDateTime(cierre.updated_at)}. Todavía no lo vieron Joel ni Mel: tocá "Enviar cierre" al terminar el día.`
          : "Cargá los pagos que no entran por Wix (efectivo, transferencias, link de pago MP, posnet, USD), los gastos y las tareas del día. Podés guardar borrador e ir completando."}
      </p>
      <CierreEditor
        key={cierre?.updated_at ?? "nuevo"}
        fecha={fecha}
        enviado={cierre?.status === "ENVIADO"}
        sugerida={sugerida}
        inicial={{
          opening_cash: cierre ? cierre.opening_cash : 0,
          surplus: cierre?.surplus ?? 0,
          counters: cierre?.counters ?? {},
          tasks: cierre?.tasks ?? "",
          notes: cierre?.notes ?? "",
          lines: cierre?.lines ?? [],
          expenses: cierre?.expenses ?? [],
        }}
      />
    </div>
  );
}
