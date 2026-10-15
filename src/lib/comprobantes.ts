import "server-only";
import { randomUUID } from "crypto";
import { db } from "./db";

// Fotos/PDF de remitos y facturas de los ingresos, en un bucket privado.
export const BUCKET_COMPROBANTES = "comprobantes";
const MAX = 4 * 1024 * 1024;
const TIPOS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

// sube el archivo y devuelve la ruta; si no hay archivo devuelve null; si es inválido, un mensaje de error
export async function subirComprobante(
  archivo: FormDataEntryValue | null,
  nombre: "remito" | "factura"
): Promise<{ path: string | null; error?: string }> {
  if (!(archivo instanceof File) || archivo.size === 0) return { path: null };
  if (archivo.size > MAX) return { path: null, error: `La foto del ${nombre} pesa más de 4 MB` };
  const ext = TIPOS[archivo.type];
  if (!ext) return { path: null, error: `El ${nombre} tiene que ser una foto (JPG, PNG, HEIC) o un PDF` };
  const { data: bucket } = await db().storage.getBucket(BUCKET_COMPROBANTES);
  if (!bucket) await db().storage.createBucket(BUCKET_COMPROBANTES, { public: false });
  const path = `${new Date().toISOString().slice(0, 7)}/${nombre}-${randomUUID()}.${ext}`;
  const { error } = await db()
    .storage.from(BUCKET_COMPROBANTES)
    .upload(path, Buffer.from(await archivo.arrayBuffer()), { contentType: archivo.type });
  if (error) return { path: null, error: `No se pudo subir el ${nombre}: ${error.message}` };
  return { path };
}

export type IngresoHistorial = {
  id: string;
  entry_date: string;
  remito: string | null;
  invoice: string | null;
  notes: string | null;
  actor: string | null;
  created_at: string;
  remito_path: string | null;
  invoice_path: string | null;
  purchase_order_id: string | null;
  supplier: { name: string } | null;
  lines: {
    id: string;
    quantity: number;
    unit_cost: number | null;
    product: { name: string; sku: string; unit: string };
    lot: { code: string; expires_on: string | null } | null;
    location: { name: string };
  }[];
};

// ingresos más recientes primero; el buscador mira proveedor, remito, factura, notas, quién, producto y lote
export async function getHistorialIngresos(q: string | undefined, limite: number) {
  const { data, error } = await db()
    .from("stock_entries")
    .select(
      "id, entry_date, remito, invoice, notes, actor, created_at, remito_path, invoice_path, purchase_order_id, supplier:suppliers(name), lines:stock_entry_lines(id, quantity, unit_cost, product:products(name, sku, unit), lot:lots(code, expires_on), location:locations(name))"
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  let lista = (data ?? []) as unknown as IngresoHistorial[];
  const texto = (q ?? "").trim().toLowerCase();
  if (texto) {
    lista = lista.filter((e) =>
      [
        e.supplier?.name,
        e.remito,
        e.invoice,
        e.notes,
        e.actor,
        ...e.lines.flatMap((l) => [l.product.name, l.product.sku, l.lot?.code]),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(texto))
    );
  }
  return { ingresos: lista.slice(0, limite), total: lista.length };
}
