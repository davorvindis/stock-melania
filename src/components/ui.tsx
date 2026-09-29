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
  return <h1 className="mb-4 text-2xl font-semibold text-stone-900">{children}</h1>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value, alert = false }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <Card>
      <div className="text-sm text-stone-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${alert ? "text-red-700" : "text-stone-900"}`}>{value}</div>
    </Card>
  );
}

export const input =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100";
export const label = "block text-sm font-medium text-stone-700 mb-1";
export const button =
  "rounded-lg bg-rose-900 px-6 py-3 text-base font-semibold text-white hover:bg-rose-800 active:bg-rose-950 disabled:opacity-50";
export const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500";
export const td = "px-3 py-2 text-sm";
