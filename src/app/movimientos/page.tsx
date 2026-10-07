import { SubmitButton } from "@/components/submit-button";
import { requireSection } from "@/lib/auth";
import Link from "next/link";
import { buscarMovimientos, getLocations, type MovementRow } from "@/lib/queries";
import { revertirMovimiento } from "@/lib/actions";
import { MOVEMENT_LABELS, fmtQty, fmtDateTime } from "@/lib/types";
import { Card, Flash, PageTitle, SortTh, th, td, input } from "@/components/ui";
import { MovementCard, movementBadgeClass, OrigenDestino } from "@/components/movement-card";

export const dynamic = "force-dynamic";

function RevertForm({ movement, compact = false }: { movement: MovementRow; compact?: boolean }) {
  return (
    <details className={compact ? "" : "mt-2"}>
      <summary className="cursor-pointer py-1 text-xs font-medium text-rose-deep hover:underline">
        Revertir
      </summary>
      <form
        action={revertirMovimiento}
        className={compact ? "mt-2 space-y-2" : "mt-2 flex flex-wrap gap-2"}
      >
        <input type="hidden" name="movimiento" value={movement.id} />
        <input
          type="text"
          name="motivo"
          placeholder="Motivo"
          required
          className={`rounded-lg border border-line px-3 py-2 text-sm ${compact ? "w-full" : "w-40"}`}
        />
        <SubmitButton
                  className={`rounded-lg bg-rose-deep px-4 py-2 text-sm font-semibold text-white ${compact ? "w-full" : ""}`}
        >
          Confirmar reversión
        </SubmitButton>
      </form>
    </details>
  );
}

type SP = {
  ok?: string;
  error?: string;
  q?: string;
  tipo?: string;
  desde?: string;
  hasta?: string;
  ubicacion?: string;
  pagina?: string;
  sort?: string;
  dir?: string;
};

const POR_PAGINA = 50;

export default async function Movimientos({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireSection("movimientos");
  const puedeRevertir = user.role === "ADMIN" || user.role === "MANAGER";
  const sp = await searchParams;
  const { ok, error } = sp;
  const pagina = Math.max(1, parseInt(sp.pagina ?? "1", 10) || 1);
  const [{ rows: movements, total, revertidos }, ubicaciones] = await Promise.all([
    buscarMovimientos(sp, pagina, POR_PAGINA),
    getLocations(),
  ]);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const hayFiltros = !!(sp.q || sp.tipo || sp.desde || sp.hasta || sp.ubicacion);

  // links conservando filtros y orden
  const qs = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) {
      if (v && k !== "ok" && k !== "error") params.set(k, v);
    }
    const str = params.toString();
    return str ? `?${str}` : "";
  };
  const exportQs = qs({ pagina: undefined, sort: undefined, dir: undefined });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Movimientos</PageTitle>
        <a
          href={`/api/export/movimientos${exportQs}`}
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-rose-deep hover:border-blush"
        >
          Descargar Excel
        </a>
      </div>
      <Flash ok={ok} error={error} />

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
        {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar producto, lote, motivo, persona…"
          className={`${input} lg:col-span-2`}
        />
        <select name="tipo" defaultValue={sp.tipo ?? ""} aria-label="Tipo" className={input}>
          <option value="">Todos los tipos</option>
          {Object.entries(MOVEMENT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select name="ubicacion" defaultValue={sp.ubicacion ?? ""} aria-label="Ubicación" className={input}>
          <option value="">Todas las ubicaciones</option>
          {ubicaciones.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-soft">
          Desde
          <input type="date" name="desde" defaultValue={sp.desde ?? ""} className={input} />
        </label>
        <label className="flex items-center gap-2 text-sm text-soft">
          Hasta
          <input type="date" name="hasta" defaultValue={sp.hasta ?? ""} className={input} />
        </label>
        <SubmitButton className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper lg:col-start-6">
          Filtrar
        </SubmitButton>
      </form>

      <p className="mb-3 text-sm text-soft">
        {total.toLocaleString("es-AR")} movimiento(s)
        {total > POR_PAGINA && ` · mostrando ${(pagina - 1) * POR_PAGINA + 1}–${Math.min(pagina * POR_PAGINA, total)}`}
        {hayFiltros && (
          <>
            {" · "}
            <Link href="/movimientos" className="font-medium text-rose-deep hover:underline">
              Limpiar filtros
            </Link>
          </>
        )}
        . El historial es permanente: los errores se corrigen con una reversión, nunca borrando.
      </p>

      {/* mobile: tarjetas */}
      <div className="space-y-2 md:hidden">
        {movements.map((m) => {
          const yaRevertido = revertidos.has(m.id);
          return (
            <div key={m.id} className={yaRevertido ? "opacity-50" : ""}>
              <MovementCard movement={m}>
                {puedeRevertir && m.type !== "REVERSAL" && m.type !== "LOT_ASSIGNMENT" && !yaRevertido && <RevertForm movement={m} compact />}
                {yaRevertido && <div className="mt-1 text-xs text-soft">Revertido</div>}
              </MovementCard>
            </div>
          );
        })}
      </div>

      {/* escritorio: tabla */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <SortTh col="fecha" sp={sp} path="/movimientos">Fecha</SortTh>
                <SortTh col="tipo" sp={sp} path="/movimientos">Tipo</SortTh>
                <th className={th}>Producto</th>
                <th className={th}>Lote</th>
                <SortTh col="cantidad" sp={sp} path="/movimientos">Cant.</SortTh>
                <th className={th}>Origen → Destino</th>
                <th className={th}>Motivo</th>
                <th className={th}>Quién</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const yaRevertido = revertidos.has(m.id);
                return (
                  <tr key={m.id} className={`border-b border-blush-100 ${yaRevertido ? "opacity-50" : ""}`}>
                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(m.occurred_at)}</td>
                    <td className={td}>
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${movementBadgeClass(m.type)}`}
                      >
                        {MOVEMENT_LABELS[m.type] ?? m.type}
                      </span>
                    </td>
                    <td className={td}>{m.product.name}</td>
                    <td className={td}>{m.lot?.code ?? "—"}</td>
                    <td className={`${td} font-medium`}>{fmtQty(m.quantity)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <OrigenDestino m={m} />
                    </td>
                    <td className={td}>{m.reason ?? "—"}</td>
                    <td className={td}>{m.actor ?? "—"}</td>
                    <td className={td}>
                      {puedeRevertir && m.type !== "REVERSAL" && m.type !== "LOT_ASSIGNMENT" && !yaRevertido && <RevertForm movement={m} />}
                      {yaRevertido && <span className="text-xs text-soft">Revertido</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {movements.length === 0 && (
        <Card>
          <p className="text-sm text-soft">Ningún movimiento coincide con la búsqueda o filtros.</p>
        </Card>
      )}

      {paginas > 1 && (
        <nav className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm" aria-label="Páginas">
          {pagina > 1 && (
            <Link href={`/movimientos${qs({ pagina: String(pagina - 1) })}`} className="rounded-lg border border-line bg-white px-3 py-2 text-rose-deep hover:border-blush">
              ← Anteriores
            </Link>
          )}
          <span className="px-2 text-soft">
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas && (
            <Link href={`/movimientos${qs({ pagina: String(pagina + 1) })}`} className="rounded-lg border border-line bg-white px-3 py-2 text-rose-deep hover:border-blush">
              Siguientes →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
