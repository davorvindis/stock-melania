export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
        error
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {error ?? ok}
    </div>
  );
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mb-4 font-display text-4xl leading-none tracking-wide text-ink">{children}</h1>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-white p-4 ${className}`}>{children}</div>
  );
}

export function Stat({ label, value, alert = false }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <Card>
      <div className="text-sm text-soft">{label}</div>
      <div
        className={`mt-1 font-display text-5xl leading-none ${alert ? "text-red-700" : "text-ink"}`}
      >
        {value}
      </div>
    </Card>
  );
}

export const input =
  "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-blush focus:outline-none focus:ring-2 focus:ring-blush-100";
export const label = "block text-sm font-medium text-ink mb-1";
export const button =
  "rounded-lg bg-rose-deep px-6 py-3 text-base font-semibold text-white hover:bg-rose-deeper active:bg-rose-deeper disabled:opacity-50";
export const th = "px-3 py-2 text-left text-xs font-semibold text-soft";
export const td = "px-3 py-2 text-sm";
