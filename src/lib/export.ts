import "server-only";
import ExcelJS from "exceljs";
import { getBalances, getMovements, isAvailable } from "./queries";
import { MOVEMENT_LABELS, LOT_STATUS_LABELS } from "./types";

// Exportación XLSX encapsulada: si algún día cambia la librería, solo se toca este archivo.

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9E8E6" } };
}

export async function stockWorkbook(): Promise<ArrayBuffer> {
  const balances = await getBalances();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Stock");
  ws.columns = [
    { header: "SKU", key: "sku", width: 18 },
    { header: "Producto", key: "producto", width: 32 },
    { header: "Lote", key: "lote", width: 14 },
    { header: "Estado lote", key: "estado", width: 14 },
    { header: "Vencimiento", key: "vence", width: 14 },
    { header: "Ubicación", key: "ubicacion", width: 16 },
    { header: "Cantidad", key: "cantidad", width: 12 },
    { header: "Unidad", key: "unidad", width: 10 },
    { header: "Disponible", key: "disponible", width: 12 },
  ];
  for (const b of balances) {
    ws.addRow({
      sku: b.product.sku,
      producto: b.product.name,
      lote: b.lot?.code ?? "",
      estado: b.lot ? LOT_STATUS_LABELS[b.lot.status] : "",
      vence: b.lot?.expires_on ?? "",
      ubicacion: b.location.name,
      cantidad: Number(b.quantity),
      unidad: b.product.unit,
      disponible: isAvailable(b) ? "Sí" : "No",
    });
  }
  styleHeader(ws);
  return new Uint8Array(await wb.xlsx.writeBuffer()).buffer as ArrayBuffer;
}

export async function movementsWorkbook(): Promise<ArrayBuffer> {
  const movements = await getMovements(5000);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Movimientos");
  ws.columns = [
    { header: "Fecha", key: "fecha", width: 20 },
    { header: "Tipo", key: "tipo", width: 20 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "Producto", key: "producto", width: 32 },
    { header: "Lote", key: "lote", width: 14 },
    { header: "Cantidad", key: "cantidad", width: 12 },
    { header: "Origen", key: "origen", width: 16 },
    { header: "Destino", key: "destino", width: 16 },
    { header: "Motivo", key: "motivo", width: 28 },
    { header: "Quién", key: "quien", width: 16 },
  ];
  for (const m of movements) {
    ws.addRow({
      fecha: new Date(m.occurred_at).toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
      }),
      tipo: MOVEMENT_LABELS[m.type] ?? m.type,
      sku: m.product.sku,
      producto: m.product.name,
      lote: m.lot?.code ?? "",
      cantidad: Number(m.quantity),
      origen: m.from_location?.name ?? "",
      destino: m.to_location?.name ?? "",
      motivo: m.reason ?? "",
      quien: m.actor ?? "",
    });
  }
  styleHeader(ws);
  return new Uint8Array(await wb.xlsx.writeBuffer()).buffer as ArrayBuffer;
}

// Plantilla para carga masiva de productos
export async function plantillaProductosWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Productos");
  ws.columns = [
    { header: "SKU", key: "sku", width: 18 },
    { header: "Nombre", key: "nombre", width: 32 },
    { header: "Descripción", key: "descripcion", width: 30 },
    { header: "Categoría", key: "categoria", width: 16 },
    { header: "Unidad", key: "unidad", width: 12 },
    { header: "Tipo", key: "tipo", width: 22 },
    { header: "Stock mínimo", key: "minimo", width: 14 },
    { header: "Maneja lote", key: "lote", width: 12 },
    { header: "Maneja vencimiento", key: "venc", width: 18 },
  ];
  ws.addRow({
    sku: "MEL-EJEMPLO-1", nombre: "Producto de ejemplo (borrá esta fila)", descripcion: "",
    categoria: "Pestañas", unidad: "unidad", tipo: "TERMINADO", minimo: 10, lote: "SI", venc: "SI",
  });
  styleHeader(ws);
  const info = wb.addWorksheet("Instrucciones");
  info.getCell("A1").value = "Tipos válidos: TERMINADO, MONODOSIS, INSUMO, PACKAGING, GRANEL, ACCESORIO";
  info.getCell("A2").value = "Maneja lote / vencimiento: SI o NO";
  info.getCell("A3").value = "SKU y Nombre son obligatorios. SKUs repetidos o ya existentes se saltean.";
  return new Uint8Array(await wb.xlsx.writeBuffer()).buffer as ArrayBuffer;
}

export type FilaProducto = {
  sku: string; nombre: string; descripcion: string | null; categoria: string | null;
  unidad: string; tipo: string; minimo: number; lote: boolean; venc: boolean;
};

const TIPOS_VALIDOS = ["TERMINADO", "MONODOSIS", "INSUMO", "PACKAGING", "GRANEL", "ACCESORIO"];

// parsea el excel subido → { filas, errores }
export async function parseProductosExcel(buf: ArrayBuffer): Promise<{ filas: FilaProducto[]; errores: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const filas: FilaProducto[] = [];
  const errores: string[] = [];
  if (!ws) return { filas, errores: ["El archivo no tiene hojas"] };
  ws.eachRow((row, n) => {
    if (n === 1) return; // encabezado
    const cell = (i: number) => String(row.getCell(i).text ?? "").trim();
    const sku = cell(1);
    const nombre = cell(2);
    if (!sku && !nombre) return; // fila vacía
    if (!sku) { errores.push(`Fila ${n}: falta SKU`); return; }
    if (!nombre) { errores.push(`Fila ${n}: falta Nombre`); return; }
    const tipo = (cell(6) || "TERMINADO").toUpperCase();
    if (!TIPOS_VALIDOS.includes(tipo)) { errores.push(`Fila ${n}: tipo "${cell(6)}" inválido`); return; }
    const minimoRaw = cell(7);
    const minimo = minimoRaw ? Number(minimoRaw.replace(",", ".")) : 0;
    if (isNaN(minimo) || minimo < 0) { errores.push(`Fila ${n}: stock mínimo inválido`); return; }
    const bool = (v: string, def: boolean) =>
      v === "" ? def : ["SI", "SÍ", "S", "TRUE", "1", "X"].includes(v.toUpperCase());
    filas.push({
      sku, nombre,
      descripcion: cell(3) || null,
      categoria: cell(4) || null,
      unidad: cell(5) || "unidad",
      tipo,
      minimo,
      lote: bool(cell(8), true),
      venc: bool(cell(9), true),
    });
  });
  const vistos = new Set<string>();
  for (const f of filas) {
    const k = f.sku.toLowerCase();
    if (vistos.has(k)) errores.push(`SKU repetido en el archivo: ${f.sku}`);
    vistos.add(k);
  }
  return { filas, errores };
}
