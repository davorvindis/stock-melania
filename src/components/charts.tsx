import { fmtQty } from "@/lib/types";

// Paleta validada (CVD + contraste, validate_palette.js): rosa marca + azul.
export const CHART = {
  in: "#2B6CB0", // entradas
  out: "#A85751", // salidas / serie única
};

// Barras horizontales de magnitud (una serie, tono único de marca)
export function HBarChart({
  items,
  unit = "u.",
}: {
  items: { label: string; value: number }[];
  unit?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-soft">Sin datos todavía.</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.label} title={`${i.label}: ${fmtQty(i.value)} ${unit}`}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-ink">{i.label}</span>
            <span className="text-xs font-medium text-soft">{fmtQty(i.value)}</span>
          </div>
          <div className="h-3 rounded-r-[4px] bg-blush-50">
            <div
              className="h-3 rounded-r-[4px]"
              style={{ width: `${Math.max((i.value / max) * 100, 1.5)}%`, background: CHART.out }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Columnas diarias entradas vs salidas (2 series, leyenda siempre presente)
export function DailyFlowChart({
  days,
  leyenda = ["Entradas", "Salidas"],
  vacio = "Sin movimientos en los últimos 14 días.",
}: {
  days: { label: string; inQty: number; outQty: number }[];
  leyenda?: [string, string];
  vacio?: string;
}) {
  const max = Math.max(...days.map((d) => Math.max(d.inQty, d.outQty)), 1);
  const any = days.some((d) => d.inQty > 0 || d.outQty > 0);
  if (!any) return <p className="text-sm text-soft">{vacio}</p>;
  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height: 128 }}>
        {days.map((d) => (
          <div
            key={d.label}
            className="flex h-full flex-1 items-end justify-center gap-[2px]"
            title={`${d.label}: ${leyenda[0]} ${fmtQty(d.inQty)}, ${leyenda[1]} ${fmtQty(d.outQty)}`}
          >
            <div
              className="w-full max-w-3 rounded-t-[4px]"
              style={{ height: `${(d.inQty / max) * 100}%`, minHeight: d.inQty > 0 ? 3 : 0, background: CHART.in }}
            />
            <div
              className="w-full max-w-3 rounded-t-[4px]"
              style={{ height: `${(d.outQty / max) * 100}%`, minHeight: d.outQty > 0 ? 3 : 0, background: CHART.out }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-soft">
        <span>{days[0]?.label}</span>
        <span>{days[days.length - 1]?.label}</span>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-ink">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: CHART.in }} />
          {leyenda[0]}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: CHART.out }} />
          {leyenda[1]}
        </span>
      </div>
    </div>
  );
}
