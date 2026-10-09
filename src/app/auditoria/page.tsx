import { requireSection } from "@/lib/auth";
import Link from "next/link";
import { db } from "@/lib/db";
import { CATEGORIAS_AUDITORIA, getAuditoria, type AuditRow, type MovimientoAuditado } from "@/lib/queries";
import { fmtDateTime, fmtQty, MOVEMENT_LABELS, origenDestino } from "@/lib/types";
import { Card, PageTitle, input } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACCIONES: Record<string, string> = {
  "stock_entry:create": "Ingreso de stock",
  "count:open": "Conteo abierto",
  "count:close": "Conteo cerrado",
  "count:approve": "Conteo aprobado",
  "count:reject": "Conteo rechazado",
  "lot:status": "Cambio estado de lote",
  "user:create": "Alta de usuario",
  "user:update": "Edición de usuario",
  "user:pin_reset": "Blanqueo de PIN",
  "user:pin_changed": "Cambio de PIN propio",
  "product:create": "Alta de producto",
  "product:update": "Edición de producto",
  "product:import": "Importación de productos",
  "product:delete": "Baja de producto",
  "kit:set_components": "Contenido de kit",
  "lot:create": "Alta de lote",
  "lot:assign": "Asignación de lote",
  "lot:expiry": "Corrección de vencimiento",
  "supplier:create": "Alta de proveedor",
  "supplier:update": "Edición de proveedor",
  "supplier:delete": "Baja de proveedor",
  "location:update": "Edición de ubicación",
  "location:delete": "Baja de ubicación",
  "purchase_order:create": "Orden de compra creada",
  "purchase_order:update": "Orden de compra editada",
  "purchase_order:delete": "Orden de compra eliminada",
  "purchase_order:receive": "Orden de compra recibida",
  "purchase_order:shipment": "Envío de orden registrado",
  "purchase_order:shipment_delivered": "Envío entregado",
  "purchase_order:shipment_delete": "Envío eliminado",
  "cost:create": "Costo agregado",
  "cost:update": "Costo editado",
  "cost:delete": "Costo quitado",
  "cost:copy_month": "Mes de costos creado",
  "import:compras_costos": "Importación de compras y costos",
  "backup:download": "Descarga de backup",
};

function describir(action: string): string {
  if (ACCIONES[action]) return ACCIONES[action];
  if (action.startsWith("movement:")) {
    const tipo = action.slice(9);
    return `Movimiento: ${MOVEMENT_LABELS[tipo] ?? tipo}`;
  }
  return action;
}

const ESTADOS_LOTE: Record<string, string> = {
  ACTIVE: "Liberado", QUARANTINE: "Cuarentena", BLOCKED: "Bloqueado",
  EXPIRED: "Vencido", DEPLETED: "Agotado",
};

// resume el detalle en lenguaje humano; nunca muestra JSON crudo ni UUIDs
function detalleLegible(detail: Record<string, unknown> | null): string {
  if (!detail) return "—";
  const partes: string[] = [];
  if (typeof detail.before === "string" && typeof detail.after === "string") {
    partes.push(`${ESTADOS_LOTE[detail.before] ?? detail.before} → ${ESTADOS_LOTE[detail.after] ?? detail.after}`);
  }
  if (detail.quantity !== undefined) partes.push(`Cantidad: ${detail.quantity}`);
  if (detail.creados !== undefined) partes.push(`Creados: ${detail.creados}`);
  if (detail.salteados !== undefined && Number(detail.salteados) > 0) partes.push(`salteados: ${detail.salteados}`);
  if (typeof detail.lines === "number") partes.push(`Líneas: ${detail.lines}`);
  if (typeof detail.remito === "string" && detail.remito) partes.push(`Remito ${detail.remito}`);
  if (typeof detail.sku === "string") partes.push(detail.sku);
  if (typeof detail.alias === "string") partes.push(`Alias: ${detail.alias}`);
  if (typeof detail.role === "string") partes.push(`Rol: ${detail.role}`);
  if (detail.active !== undefined) partes.push(detail.active ? "activo" : "desactivado");
  if (typeof detail.reason === "string" && detail.reason) partes.push(`Motivo: ${detail.reason}`);
  return partes.length ? partes.join(" · ") : "—";
}

type SP = { persona?: string; categoria?: string; desde?: string; hasta?: string; pagina?: string };
const POR_PAGINA = 50;
const esUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// todos los datos del detalle en texto (sin UUIDs ni JSON crudo)
function detalleCompleto(detail: Record<string, unknown> | null): [string, string][] {
  if (!detail) return [];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(detail)) {
    if (v == null || v === "" || esUuid(v)) continue;
    if (typeof v === "object") {
      const txt = Array.isArray(v)
        ? v.map((x) => (typeof x === "object" && x ? Object.values(x).filter((y) => !esUuid(y)).join(" ") : String(x))).join(" · ")
        : Object.entries(v as Record<string, unknown>).filter(([, y]) => y === true).map(([y]) => y).join(", ");
      if (txt) out.push([k, txt]);
    } else out.push([k, String(v)]);
  }
  return out;
}

function DetalleMovimiento({ m }: { m: MovimientoAuditado }) {
  const od = origenDestino(m);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      <dt className="text-soft">Producto</dt>
      <dd>
        {m.product?.name ?? "—"} {m.product && <span className="font-mono text-xs text-soft">{m.product.sku}</span>}
      </dd>
      <dt className="text-soft">Cantidad</dt>
      <dd>
        {fmtQty(m.quantity)} {m.product?.unit}
        {m.lot ? ` · lote ${m.lot.code}` : ""}
      </dd>
      <dt className="text-soft">Origen → destino</dt>
      <dd>
        {od.origen} → {od.destino}
      </dd>
      <dt className="text-soft">N° pedido / motivo</dt>
      <dd className="font-medium">{m.reason ?? "—"}</dd>
      {m.notes && (
        <>
          <dt className="text-soft">Observaciones</dt>
          <dd className="whitespace-pre-line">{m.notes}</dd>
        </>
      )}
    </dl>
  );
}

function resumen(l: AuditRow, m?: MovimientoAuditado): string {
  if (m) {
    const od = origenDestino(m);
    return [`${fmtQty(m.quantity)} × ${m.product?.name ?? "?"}`, `${od.origen} → ${od.destino}`, m.reason]
      .filter(Boolean)
      .join(" · ");
  }
  return detalleLegible(l.detail);
}

export default async function Auditoria({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSection("auditoria");
  const sp = await searchParams;
  const pagina = Math.max(1, parseInt(sp.pagina ?? "1", 10) || 1);
  const [{ rows: logs, total, movimientos }, { data: perfiles }] = await Promise.all([
    getAuditoria(sp, pagina, POR_PAGINA),
    db().from("profiles").select("alias").order("alias"),
  ]);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const hayFiltros = !!(sp.persona || sp.categoria || sp.desde || sp.hasta);
  const qs = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) params.set(k, v);
    const str = params.toString();
    return str ? `?${str}` : "";
  };

  return (
    <div className="max-w-5xl">
      <PageTitle>Auditoría</PageTitle>
      <p className="mb-3 text-sm text-soft">
        Registro permanente de todo lo que se hace en el sistema: quién, cuándo y qué. No se puede editar ni
        borrar. Para análisis de ventas usá la pestaña{" "}
        <Link href="/ventas" className="font-medium text-rose-deep hover:underline">
          Ventas
        </Link>
        .
      </p>
      <form method="get" className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <select name="persona" defaultValue={sp.persona ?? ""} aria-label="Persona" className={input}>
          <option value="">Todas las personas</option>
          {(perfiles ?? []).map((p) => (
            <option key={p.alias} value={p.alias}>
              {p.alias}
            </option>
          ))}
        </select>
        <select name="categoria" defaultValue={sp.categoria ?? ""} aria-label="Tipo de acción" className={input}>
          <option value="">Todas las acciones</option>
          {Object.entries(CATEGORIAS_AUDITORIA).map(([k, c]) => (
            <option key={k} value={k}>
              {c.label}
            </option>
          ))}
        </select>
        <input type="date" name="desde" defaultValue={sp.desde ?? ""} aria-label="Desde" className={input} />
        <input type="date" name="hasta" defaultValue={sp.hasta ?? ""} aria-label="Hasta" className={input} />
        <button type="submit" className="rounded-lg bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-deeper">
          Filtrar
        </button>
      </form>
      <p className="mb-3 text-sm text-soft">
        {total.toLocaleString("es-AR")} registro(s)
        {total > POR_PAGINA && ` · mostrando ${(pagina - 1) * POR_PAGINA + 1}–${Math.min(pagina * POR_PAGINA, total)}`}
        {hayFiltros && (
          <>
            {" · "}
            <Link href="/auditoria" className="font-medium text-rose-deep hover:underline">
              Limpiar filtros
            </Link>
          </>
        )}
      </p>

      <div className="space-y-1.5">
        {logs.map((l) => {
          const m = l.entity_id ? movimientos.get(l.entity_id) : undefined;
          const extra = m ? [] : detalleCompleto(l.detail);
          return (
            <details key={l.id} className="rounded-lg border border-blush-100 bg-white px-3 py-2">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm">
                    <span className="font-medium">{describir(l.action)}</span>
                    <span className="text-soft"> · {l.actor ?? "—"}</span>
                  </span>
                  <span className="text-xs text-soft">{fmtDateTime(l.at)}</span>
                </div>
                <div className="truncate text-xs text-soft">
                  {resumen(l, m)} <span className="text-rose-deep">▾</span>
                </div>
              </summary>
              <div className="mt-2 border-t border-blush-100 pt-2">
                {m ? (
                  <DetalleMovimiento m={m} />
                ) : extra.length ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                    {extra.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="capitalize text-soft">{k.replace(/_/g, " ")}</dt>
                        <dd className="break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-soft">Sin más detalle.</p>
                )}
              </div>
            </details>
          );
        })}
        {logs.length === 0 && (
          <Card>
            <p className="text-sm text-soft">No hay registros con estos filtros.</p>
          </Card>
        )}
      </div>

      {paginas > 1 && (
        <nav className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm" aria-label="Páginas">
          {pagina > 1 && (
            <Link href={`/auditoria${qs({ pagina: String(pagina - 1) })}`} className="rounded-lg border border-line bg-white px-3 py-2 text-rose-deep hover:border-blush">
              ← Anteriores
            </Link>
          )}
          <span className="px-2 text-soft">
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas && (
            <Link href={`/auditoria${qs({ pagina: String(pagina + 1) })}`} className="rounded-lg border border-line bg-white px-3 py-2 text-rose-deep hover:border-blush">
              Siguientes →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
