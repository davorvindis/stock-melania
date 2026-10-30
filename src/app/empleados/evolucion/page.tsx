import Link from "next/link";
import { requireSection } from "@/lib/auth";
import { getNovedades, getPersonas, MESES, mesVecino, nombre, pesos, porcentaje, type Novedad, type Persona } from "@/lib/empleados";
import { Card, PageTitle, th, td } from "@/components/ui";
import { Pestanias } from "../pestanias";

export const dynamic = "force-dynamic";

const corto = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1].slice(0, 3)} ${mes.slice(2, 4)}`;

function Etiquetas({ n }: { n: Novedad }) {
  const t: string[] = [];
  if (n.raise_pct) t.push(`+${porcentaje(n.raise_pct)}%`);
  if (n.bonus) t.push(`bono $${pesos(n.bonus)}`);
  if (n.aguinaldo) t.push("aguinaldo");
  if (n.no_presentismo) t.push("sin presentismo");
  if (n.pending) t.push("pendiente");
  return t.length ? <div className="mt-0.5 text-xs text-rose-deep">{t.join(" · ")}</div> : null;
}

function Celda({ n, p }: { n?: Novedad; p: Persona }) {
  if (!n) return <span className="text-soft">—</span>;
  const monto = n.total ?? n.base_amount;
  return (
    <div>
      <div className="font-medium tabular-nums">{monto !== null ? `$${pesos(monto)}` : p.pay_scheme === "CONVENIO" ? "convenio" : "cargado"}</div>
      {n.commissions !== null && <div className="text-xs text-soft tabular-nums">com. ${pesos(n.commissions)}</div>}
      <Etiquetas n={n} />
      {n.notes && <div className="mt-0.5 line-clamp-2 max-w-48 text-xs text-soft" title={n.notes}>{n.notes}</div>}
    </div>
  );
}

// variación contra el mes anterior con monto
function Variacion({ actual, previo }: { actual?: Novedad; previo?: Novedad }) {
  const a = actual?.total ?? actual?.base_amount;
  const b = previo?.total ?? previo?.base_amount;
  if (a == null || b == null || b === 0 || a === b) return null;
  const pct = ((a - b) / b) * 100;
  return <span className={`text-xs ${pct > 0 ? "text-emerald-700" : "text-red-700"}`}>{pct > 0 ? "▲" : "▼"} {porcentaje(Math.round(Math.abs(pct) * 10) / 10)}%</span>;
}

export default async function Evolucion({ searchParams }: { searchParams: Promise<{ hasta?: string }> }) {
  await requireSection("empleados");
  const sp = await searchParams;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()).slice(0, 7);
  const hasta = sp.hasta && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.hasta) ? sp.hasta : hoy;
  const meses = Array.from({ length: 12 }, (_, i) => mesVecino(hasta, i - 11));
  const [personas, novedades] = await Promise.all([getPersonas(), getNovedades(`${meses[0]}-01`, `${hasta}-01`)]);
  const de = new Map(novedades.map((n) => [`${n.employee_id}:${n.period.slice(0, 7)}`, n]));
  const conDatos = personas.filter((p) => p.active || novedades.some((n) => n.employee_id === p.id));
  // solo los meses con algo cargado, del más nuevo al más viejo en las tarjetas
  const mesesConDatos = meses.filter((m) => novedades.some((n) => n.period.startsWith(m)));
  const anteriorCon = (p: Persona, m: string) => {
    for (let i = meses.indexOf(m) - 1; i >= 0; i--) {
      const n = de.get(`${p.id}:${meses[i]}`);
      if (n && (n.total ?? n.base_amount) != null) return n;
    }
    return undefined;
  };

  return (
    <div>
      <PageTitle>Empleados</PageTitle>
      <Pestanias activa="/empleados/evolucion" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-soft">Lo que se le pasó a la contadora mes a mes: total a cobrar (o en mano), aumentos, bonos, aguinaldo y notas. Tocá un mes para verlo o corregirlo.</p>
        <div className="flex gap-2 text-sm">
          <Link href={`/empleados/evolucion?hasta=${mesVecino(hasta, -12)}`} className="rounded-lg border border-line bg-white px-3 py-1.5 text-soft hover:text-ink">← 12 meses antes</Link>
          {hasta < hoy && <Link href={`/empleados/evolucion?hasta=${mesVecino(hasta, 12)}`} className="rounded-lg border border-line bg-white px-3 py-1.5 text-soft hover:text-ink">12 meses después →</Link>}
        </div>
      </div>

      {mesesConDatos.length === 0 ? (
        <Card>No hay novedades cargadas entre {corto(meses[0])} y {corto(hasta)}.</Card>
      ) : (
        <>
          {/* escritorio: personas × meses */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="min-w-full">
              <thead className="border-b border-line bg-blush-50">
                <tr>
                  <th className={`${th} sticky left-0 bg-blush-50`}>Persona</th>
                  {mesesConDatos.map((m) => (
                    <th key={m} className={th}>
                      <Link href={`/empleados?mes=${m}`} className="capitalize hover:text-rose-deep">{corto(m)}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conDatos.map((p) => (
                  <tr key={p.id} className="border-b border-line align-top last:border-0">
                    <td className={`${td} sticky left-0 bg-white font-medium`}>
                      {nombre(p)}
                      <div className="text-xs font-normal text-soft">{p.employer === "ECP" ? "ECP" : "Marrudi"}{!p.active ? " · baja" : ""}</div>
                    </td>
                    {mesesConDatos.map((m) => (
                      <td key={m} className={td}>
                        <Celda n={de.get(`${p.id}:${m}`)} p={p} />
                        <Variacion actual={de.get(`${p.id}:${m}`)} previo={anteriorCon(p, m)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* celular: una tarjeta por persona */}
          <div className="grid gap-3 md:hidden">
            {conDatos.map((p) => (
              <Card key={p.id}>
                <h3 className="font-semibold text-ink">{nombre(p)}</h3>
                <div className="mb-2 text-xs text-soft">{p.employer === "ECP" ? "ECP" : "Marrudi"}{!p.active ? " · baja" : ""}</div>
                <div className="divide-y divide-line">
                  {[...mesesConDatos].reverse().filter((m) => de.has(`${p.id}:${m}`)).map((m) => (
                    <Link key={m} href={`/empleados?mes=${m}`} className="flex justify-between gap-3 py-2 text-sm">
                      <span className="capitalize text-soft">{corto(m)}</span>
                      <span className="text-right">
                        <Celda n={de.get(`${p.id}:${m}`)} p={p} />
                        <Variacion actual={de.get(`${p.id}:${m}`)} previo={anteriorCon(p, m)} />
                      </span>
                    </Link>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
