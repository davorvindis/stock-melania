import { Fragment } from "react";
import { requireUser, SECTIONS, can, ubicacionFija, type Profile } from "@/lib/auth";
import { ACTUALIZADO, MANUAL } from "@/lib/manual/contenido";
import { manualPara, type Bloque } from "@/lib/manual/tipos";
import { ManualHerramientas } from "@/components/manual-herramientas";
import { PageTitle } from "@/components/ui";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// **negrita** y *cursiva*
function Texto({ t }: { t: string }) {
  return (
    <>
      {t.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((x, i) =>
        x.startsWith("**") ? <b key={i}>{x.slice(2, -2)}</b> : x.startsWith("*") && x.length > 2 ? <i key={i}>{x.slice(1, -1)}</i> : <Fragment key={i}>{x}</Fragment>
      )}
    </>
  );
}

const TONOS = {
  info: "border-blush-100 bg-blush-50",
  ambar: "border-amber-300 bg-amber-50",
  verde: "border-emerald-200 bg-emerald-50",
};

const ROL: Record<string, string> = { ADMIN: "Administración", MANAGER: "Encargada", OPERATOR: "Equipo" };

function Permisos({ u }: { u: Profile }) {
  const encargada = u.role === "ADMIN" || u.role === "MANAGER";
  const puede = [
    can(u, "stock") && "Ver el stock de tus ubicaciones y descargar el Excel.",
    can(u, "ingresos") && "Cargar ingresos de mercadería.",
    can(u, "movimientos") && "Cargar movimientos (transferencias, roturas, muestras…) y ver el historial.",
    can(u, "pedidos") && "Armar pedidos web: procesar, despachar y retirar; descontar Ventas sin descontar; Volvió / No volvió de los reembolsos del POS.",
    can(u, "conteos") && "Abrir, cargar y cerrar conteos.",
    encargada && "Revertir movimientos, ajustar stock, asignar lotes, cambiar estado o vencimiento de lotes y separar blisters.",
    encargada && can(u, "pedidos") && "Botón Reembolso de pedidos web, Marcar como revisado, descartar Ventas sin descontar y deshacer despachado / retirado.",
    u.role === "ADMIN" && "Aprobar conteos.",
    u.role === "ADMIN" && can(u, "caja") && "Aprobar retiros e ingresos de la caja fuerte y ver los cierres enviados.",
    u.role === "ADMIN" && can(u, "vacaciones") && "Aprobar vacaciones.",
    can(u, "configuracion") && "Usuarios, PIN, permisos y ubicaciones.",
  ].filter(Boolean) as string[];
  const fija = ubicacionFija(u);
  return (
    <div className="space-y-2 text-sm">
      <p>
        Usuario <b>{u.alias}</b> · {ROL[u.role] ?? u.role}
        {fija ? " · operás solo el stock de tu ubicación" : ""}.
      </p>
      <p>
        <b>Tus pestañas:</b> Dashboard, {SECTIONS.filter((s) => can(u, s.key)).map((s) => s.label).join(", ")}.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {puede.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="text-xs text-soft">¿Necesitás otra pestaña o permiso? Pedíselo a Joel o a Mel: cuando te lo habiliten, su explicación aparece sola en este manual.</p>
    </div>
  );
}

function Bloques({ bloques, u }: { bloques: Bloque[]; u: Profile }) {
  return (
    <>
      {bloques.map((b, i) => {
        switch (b.tipo) {
          case "p":
            return (
              <p key={i} className="mb-2 text-sm leading-relaxed">
                <Texto t={b.texto} />
              </p>
            );
          case "lista":
          case "pasos": {
            const Tag = b.tipo === "lista" ? "ul" : "ol";
            return (
              <Tag key={i} className={`mb-3 space-y-1.5 pl-5 text-sm leading-relaxed ${b.tipo === "lista" ? "list-disc" : "list-decimal"}`}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Texto t={typeof it === "string" ? it : it.t} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "tabla":
            return (
              <div key={i} className="mb-3 overflow-x-auto rounded-lg border border-blush-100">
                <table className="w-full text-sm">
                  <thead className="bg-blush-50">
                    <tr>
                      {b.cols.map((c) => (
                        <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-soft">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.filas.map((f, j) => (
                      <tr key={j} className="border-t border-blush-100 align-top">
                        {(Array.isArray(f) ? f : f.c).map((c, k) => (
                          <td key={k} className="px-3 py-2">
                            <Texto t={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "aviso":
            return (
              <div key={i} className={`mb-3 rounded-lg border px-3 py-2 text-sm leading-relaxed break-inside-avoid ${TONOS[b.tono ?? "info"]}`}>
                {b.titulo && <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-soft">{b.titulo}</div>}
                <Texto t={b.texto} />
              </div>
            );
          case "sub":
            return (
              <div key={i} className="mb-3 break-inside-avoid">
                <h3 className="mb-1.5 mt-3 font-semibold text-ink">{b.titulo}</h3>
                <Bloques bloques={b.bloques} u={u} />
              </div>
            );
          case "permisos":
            return <Permisos key={i} u={u} />;
        }
      })}
    </>
  );
}

export default async function ManualPage({ searchParams }: { searchParams: Promise<{ como?: string }> }) {
  const yo = await requireUser();
  const { como } = await searchParams;
  // administración: ver el manual como lo ve otra persona
  let usuarios: { alias: string }[] = [];
  let u = yo;
  if (yo.role === "ADMIN") {
    const { data } = await db().from("profiles").select("*").eq("active", true).order("alias");
    usuarios = (data ?? []) as Profile[];
    const otro = (data ?? []).find((p) => p.alias === como);
    if (otro) u = otro as Profile;
  }
  const capitulos = manualPara(u, MANUAL);
  return (
    <div className="max-w-3xl">
      <PageTitle>Manual de uso</PageTitle>
      <p className="mb-3 text-sm text-soft">
        {u === yo ? `Hecho a tu medida, ${u.alias}: solo aparece lo que tenés habilitado.` : `Así ve el manual ${u.alias}.`} Actualizado el {ACTUALIZADO}.
      </p>
      {usuarios.length > 0 && (
        <form method="get" className="mb-3 flex flex-wrap items-center gap-2 text-sm print:hidden">
          <span className="text-soft">Ver como:</span>
          <select name="como" defaultValue={u.alias} className="rounded-lg border border-line bg-white px-3 py-1.5">
            {usuarios.map((x) => (
              <option key={x.alias} value={x.alias}>{x.alias}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-rose-deep hover:bg-blush-50">Ver</button>
        </form>
      )}
      <ManualHerramientas contenedorId="manual" />
      <nav className="mb-5 rounded-xl border border-line bg-white p-4 print:hidden">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-soft">Contenido</div>
        <ol className="grid list-decimal gap-x-6 gap-y-1 pl-5 text-sm sm:grid-cols-2">
          {capitulos.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`} className="text-rose-deep hover:underline">{c.titulo}</a>
            </li>
          ))}
        </ol>
      </nav>
      <div id="manual" className="space-y-4">
        {capitulos.map((c, i) => (
          <section key={c.id} id={c.id} data-capitulo className="scroll-mt-20 rounded-xl border border-line bg-white p-4 print:border-0 print:p-0">
            <h2 className="mb-3 font-display text-2xl tracking-wide text-rose-deep">
              {i + 1}. {c.titulo}
            </h2>
            <Bloques bloques={c.bloques} u={u} />
          </section>
        ))}
      </div>
    </div>
  );
}
