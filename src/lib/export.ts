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
