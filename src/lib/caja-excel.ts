import "server-only";
import ExcelJS from "exceljs";
import { db } from "./db";
import { BUCKET } from "./backup";
import { getCierres, totalesDe, type Cierre } from "./caja";
import { CONTADORES } from "./caja-calc";

// Excel de cierres con el mismo formato que la planilla de Yura: una hoja por día
// (pagos minoristas arriba, MAYORISTA abajo, resumen a la derecha, gastos y tareas)
// y una hoja "Resumen" con el total de cada día.

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const MONEDA = '#,##0;[Red]-#,##0';
const COLS = ["PEDIDO", "CLIENTE", "DESCRIPCIÓN", "EFECTIVO", "INGRESOS DE\nDINERO", "POSNET", "LINK DE PAGO\nMP", "TRANSFERENCIA", "EXTRAS ", "PAGO \nUSD", "FACTURA"];

function hojaDia(wb: ExcelJS.Workbook, c: Cierre) {
  const [, m, d] = c.closing_date.split("-").map(Number);
  const ws = wb.addWorksheet(`${d}-${m}`);
  const t = totalesDe(c);
  ws.columns = [10, 26, 22, 13, 13, 12, 13, 15, 12, 10, 10, 26, 16, 2, 14, 40].map((width) => ({ width }));
  ws.getRow(1).values = [...COLS, "CIERRE TOTAL", t.ventas, null, "GASTOS"];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  const fila = (r: number, l: Cierre["lines"][number]) => {
    const row = ws.getRow(r);
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    row.getCell(1).value = l.order_ref ?? null;
    row.getCell(2).value = l.customer ?? null;
    row.getCell(3).value = l.description ?? null;
    [l.cash, l.money_in, l.posnet, l.mp_link, l.transfer].forEach((v, i) => (row.getCell(4 + i).value = num(v)));
    row.getCell(9).value = l.account ?? null;
    row.getCell(10).value = num(l.usd);
    row.getCell(11).value = l.invoice ?? null;
  };
  const minoristas = c.lines.filter((l) => l.kind === "MINORISTA");
  const mayoristas = c.lines.filter((l) => l.kind === "MAYORISTA");
  let r = 2;
  for (const l of minoristas) fila(r++, l);
  r = Math.max(r + 1, 13);
  ws.getCell(`B${r}`).value = "MAYORISTA";
  ws.getCell(`B${r}`).font = { bold: true };
  r++;
  for (const l of mayoristas) fila(r++, l);
  const fin = Math.max(r, 26);
  const tot = ws.getRow(fin + 1);
  tot.getCell(3).value = "TOTALES";
  for (const col of ["D", "E", "F", "G", "H", "J"]) ws.getCell(`${col}${fin + 1}`).value = { formula: `SUM(${col}2:${col}${fin})` };
  tot.font = { bold: true };

  const resumen: [string, number | string | null][] = [
    ["EFECTIVO", t.efectivo], ["POSNET", t.posnet], ["TRANSFERENCIA", t.transferencia], ["LINK DE PAGO MP", t.link],
    ["MAYORISTA", t.mayorista], ["MINORISTA", t.minorista],
    ["GASTOS LOCAL", t.gastos], ["CAJA CHICA (EFECTIVO TOTAL)", t.cajaChica], ["USD", t.usd || null],
    ["Ingreso de dinero", t.ingresosDinero || null], ["CAJA INICIAL", c.opening_cash], ["SOBRAN", c.surplus || null],
    ...CONTADORES.map((k) => [k.label.toUpperCase(), c.counters?.[k.key] ?? null] as [string, string | null]),
  ];
  resumen.forEach(([k, v], i) => {
    ws.getCell(`L${i + 2}`).value = k;
    ws.getCell(`M${i + 2}`).value = v;
  });
  c.expenses.forEach((g, i) => {
    ws.getCell(`O${i + 2}`).value = g.currency === "USD" ? `${g.amount} usd` : Number(g.amount);
    ws.getCell(`P${i + 2}`).value = `${g.description ?? ""}${g.from_petty_cash ? "" : " (no sale de la caja chica)"}`;
  });
  const filaObs = Math.max(c.expenses.length + 3, 11);
  ws.getCell(`O${filaObs}`).value = "observaciones";
  ws.getCell(`O${filaObs}`).font = { bold: true };
  (c.tasks ?? "").split("\n").map((s) => s.trim()).filter(Boolean).forEach((tarea, i) => (ws.getCell(`O${filaObs + 1 + i}`).value = tarea));
  for (const col of ["D", "E", "F", "G", "H", "M", "O"]) ws.getColumn(col).numFmt = MONEDA;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export async function excelCierres(desde?: string, hasta?: string): Promise<{ buf: ArrayBuffer; nombre: string }> {
  const cierres = (await getCierres(desde, hasta)).sort((a, b) => a.closing_date.localeCompare(b.closing_date));
  const wb = new ExcelJS.Workbook();
  const res = wb.addWorksheet("Resumen");
  res.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Estado", key: "estado", width: 11 },
    { header: "Total ingresos", key: "ventas", width: 16 },
    { header: "Mayorista", key: "mayorista", width: 14 },
    { header: "Minorista", key: "minorista", width: 14 },
    { header: "Efectivo", key: "efectivo", width: 13 },
    { header: "Transferencia", key: "transferencia", width: 15 },
    { header: "Link MP", key: "link", width: 12 },
    { header: "Posnet", key: "posnet", width: 12 },
    { header: "USD", key: "usd", width: 10 },
    { header: "Gastos", key: "gastos", width: 12 },
    { header: "Neto (ingresos − gastos)", key: "neto", width: 16 },
    { header: "Caja chica", key: "caja", width: 13 },
    { header: "Cargó", key: "quien", width: 12 },
  ];
  res.getRow(1).font = { bold: true };
  for (const c of cierres) {
    const t = totalesDe(c);
    res.addRow({
      fecha: c.closing_date.split("-").reverse().join("/"), estado: c.status === "ENVIADO" ? "Enviado" : "Borrador",
      ventas: t.ventas, mayorista: t.mayorista, minorista: t.minorista, efectivo: t.efectivo, transferencia: t.transferencia,
      link: t.link, posnet: t.posnet, usd: t.usd, gastos: t.gastos, neto: t.neto, caja: t.cajaChica, quien: c.submitted_by ?? c.updated_by,
    });
  }
  for (let i = 3; i <= 13; i++) if (i !== 10) res.getColumn(i).numFmt = MONEDA;
  for (const c of cierres) hojaDia(wb, c);
  const mes = desde && hasta && desde.slice(0, 7) === hasta.slice(0, 7) ? desde.slice(0, 7) : null;
  const nombre = mes
    ? `INFORMES ${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}.xlsx`
    : `Cierres de caja ${desde ?? "inicio"} a ${hasta ?? "hoy"}.xlsx`;
  return { buf: await wb.xlsx.writeBuffer(), nombre };
}

// respaldo automático: al enviar un cierre se regenera el Excel del mes en el bucket privado
export async function respaldarMes(fecha: string) {
  const mes = fecha.slice(0, 7);
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const { buf } = await excelCierres(`${mes}-01`, `${mes}-${String(ultimo).padStart(2, "0")}`);
  const { error } = await db()
    .storage.from(BUCKET)
    .upload(`caja/INFORMES-${mes}.xlsx`, Buffer.from(buf), {
      upsert: true,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  if (error) throw new Error(error.message);
}
