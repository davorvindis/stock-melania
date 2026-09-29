// Skeleton global: aparece al instante en cada navegación mientras carga la sección
export default function Loading() {
  return (
    <div aria-busy aria-label="Cargando…">
      <div className="mb-6 h-9 w-56 animate-pulse rounded-lg bg-blush-100" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-white p-4">
            <div className="h-3 w-2/3 rounded bg-blush-100" />
            <div className="mt-3 h-8 w-1/3 rounded bg-blush-100" />
          </div>
        ))}
      </div>
      <div className="mt-4 animate-pulse rounded-xl border border-line bg-white p-4">
        <div className="h-4 w-40 rounded bg-blush-100" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 rounded bg-blush-50" style={{ width: `${90 - i * 7}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
