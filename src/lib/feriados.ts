import "server-only";
import { db } from "./db";

// Feriados para contar días hábiles (lunes a viernes que no son feriado).
// - Nacionales: se leen de ArgentinaDatos (lista oficial) y se guardan en app_settings "feriados".
//   Los "puentes turísticos no laborables" NO cuentan: esos días se trabaja.
// - Extra: los que se cargan a mano en Configuración (ej. feriado solo en CABA).

const API = "https://api.argentinadatos.com/v1/feriados";
const REFRESCAR_CADA = 7 * 86400_000;

export type Feriado = { fecha: string; nombre: string };
type Guardado = {
  nacionales: Record<string, Feriado[]>; // por año
  actualizado?: string;
  extra: Feriado[];
};

const anioAR = () => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric" }).format(new Date()));

async function leer(): Promise<Guardado> {
  const { data } = await db().from("app_settings").select("value").eq("key", "feriados").maybeSingle();
  const v = (data?.value ?? {}) as Partial<Guardado>;
  return { nacionales: v.nacionales ?? {}, actualizado: v.actualizado, extra: v.extra ?? [] };
}

async function guardar(v: Guardado, actor: string) {
  await db().from("app_settings").upsert({ key: "feriados", value: v, updated_at: new Date().toISOString(), updated_by: actor }, { onConflict: "key" });
}

async function bajarAnio(anio: number): Promise<Feriado[] | null> {
  try {
    const r = await fetch(`${API}/${anio}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const lista = (await r.json()) as { fecha: string; tipo: string; nombre: string }[];
    if (!Array.isArray(lista)) return null;
    return lista.filter((f) => f.tipo !== "puente" && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha)).map((f) => ({ fecha: f.fecha, nombre: f.nombre }));
  } catch {
    return null;
  }
}

// trae (o refresca una vez por semana) los nacionales de este año y el que viene; si falla, sigue con lo guardado
async function conNacionales(v: Guardado, forzar = false): Promise<Guardado> {
  const anio = anioAR();
  const falta = !v.nacionales[anio] || !v.nacionales[anio + 1]?.length;
  const viejo = !v.actualizado || Date.now() - Date.parse(v.actualizado) > REFRESCAR_CADA;
  if (!forzar && !falta && !viejo) return v;
  const [a, b] = await Promise.all([bajarAnio(anio), bajarAnio(anio + 1)]);
  if (!a && !b) return v;
  const nacionales = { ...v.nacionales };
  if (a) nacionales[anio] = a;
  if (b?.length) nacionales[anio + 1] = b;
  const nuevo = { ...v, nacionales, actualizado: new Date().toISOString() };
  await guardar(nuevo, "sistema").catch(() => {});
  return nuevo;
}

export async function getFeriados(): Promise<Set<string>> {
  const v = await conNacionales(await leer());
  return new Set([...Object.values(v.nacionales).flat().map((f) => f.fecha), ...v.extra.map((f) => f.fecha)]);
}

export async function getFeriadosDetalle(forzar = false) {
  const v = await conNacionales(await leer(), forzar);
  return { nacionales: v.nacionales, extra: [...v.extra].sort((a, b) => a.fecha.localeCompare(b.fecha)), actualizado: v.actualizado ?? null };
}

export async function guardarExtras(extra: Feriado[], actor: string) {
  const v = await leer();
  await guardar({ ...v, extra }, actor);
}
