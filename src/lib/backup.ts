import "server-only";
import { gzipSync } from "zlib";
import { db } from "./db";

// Copia de seguridad completa de los datos (todas las tablas de negocio) en un
// JSON comprimido. Se guarda a diario en un bucket privado de Supabase Storage
// y un ADMIN puede descargarla para guardarla fuera de Supabase.

const TABLAS = [
  "profiles",
  "locations",
  "suppliers",
  "products",
  "kit_components",
  "lots",
  "stock_entries",
  "stock_entry_lines",
  "inventory_movements",
  "stock_balances",
  "inventory_counts",
  "inventory_count_lines",
  "audit_logs",
] as const;

export const BUCKET = "backups";
const RETENCION_DIAS = 30;
const PAGINA = 1000;

async function leerTabla(tabla: string) {
  const filas: unknown[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await db()
      .from(tabla)
      .select("*")
      .order("id")
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return filas;
}

export async function generarBackup() {
  const tablas: Record<string, unknown[]> = {};
  for (const t of TABLAS) tablas[t] = await leerTabla(t);
  const contenido = {
    app: "stock-melania",
    generado: new Date().toISOString(),
    filas: Object.fromEntries(Object.entries(tablas).map(([k, v]) => [k, v.length])),
    tablas,
  };
  return gzipSync(Buffer.from(JSON.stringify(contenido)));
}

// fecha calendario argentina (el server corre en UTC)
export function hoyAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

async function asegurarBucket() {
  const { data } = await db().storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db().storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
  }
}

export async function listarBackups() {
  const { data, error } = await db().storage.from(BUCKET).list("", {
    limit: 100,
    sortBy: { column: "name", order: "desc" },
  });
  if (error) return [];
  return (data ?? []).filter((f) => f.name.endsWith(".json.gz"));
}

// backup del día: si ya existe no hace nada (el endpoint queda a salvo de abusos)
export async function backupDiario(): Promise<{ archivo: string; creado: boolean }> {
  await asegurarBucket();
  const archivo = `backup-${hoyAR()}.json.gz`;
  const existentes = await listarBackups();
  if (existentes.some((f) => f.name === archivo)) return { archivo, creado: false };

  const gz = await generarBackup();
  const { error } = await db()
    .storage.from(BUCKET)
    .upload(archivo, gz, { contentType: "application/gzip", upsert: false });
  if (error && !/exists/i.test(error.message)) throw new Error(error.message);

  // retención: borrar copias de más de 30 días
  const limite = new Date(Date.now() - RETENCION_DIAS * 86400000).toISOString().slice(0, 10);
  const viejos = existentes
    .filter((f) => (f.name.match(/backup-(\d{4}-\d{2}-\d{2})/)?.[1] ?? "9999") < limite)
    .map((f) => f.name);
  if (viejos.length) await db().storage.from(BUCKET).remove(viejos);

  return { archivo, creado: true };
}
