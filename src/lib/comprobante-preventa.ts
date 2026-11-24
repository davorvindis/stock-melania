import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { MEDIOS_PAGO, numeroComprobante, resumenPago, type PagoPreventa } from "./preventa-pagos";
import { fmtDate, fmtQty } from "./types";

// PDF del comprobante de pago de una preventa (para mandarle al cliente). Sin precios:
// productos, cantidades, pagos y total abonado. No toca la base: recibe los datos ya leídos.

export type DatosComprobante = {
  customer: string;
  order_ref: string | null;
  order_date: string;
  receipt_no: number;
  total_amount: number | null;
  lines: { quantity: number; product: { name: string; unit: string } }[];
  payments: PagoPreventa[];
};

// colores de marca (globals.css)
const ROSA = rgb(0xa8 / 255, 0x57 / 255, 0x51 / 255);
const TINTA = rgb(0x2e / 255, 0x2e / 255, 0x2e / 255);
const SUAVE = rgb(0x6f / 255, 0x62 / 255, 0x60 / 255);
const LINEA = rgb(0xed / 255, 0xdb / 255, 0xd8 / 255);
const FONDO = rgb(0xfd / 255, 0xf6 / 255, 0xf5 / 255);

// las fuentes estándar del PDF solo tienen caracteres latinos: lo demás (emojis, etc.) se saca
const limpiar = (t: string) =>
  t
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E -ÿ–—•€]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const pesos = (n: number) =>
  "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

// corta un texto en renglones que entren en el ancho
function renglones(texto: string, font: PDFFont, size: number, ancho: number): string[] {
  const out: string[] = [];
  let actual = "";
  for (const palabra of limpiar(texto).split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(prueba, size) <= ancho) actual = prueba;
    else {
      if (actual) out.push(actual);
      actual = palabra;
    }
  }
  if (actual) out.push(actual);
  return out.length ? out : [""];
}

export function nombreArchivoComprobante(pv: Pick<DatosComprobante, "customer" | "receipt_no">) {
  const cliente = limpiar(pv.customer).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `Comprobante-preventa-${numeroComprobante(pv.receipt_no)}-${cliente}.pdf`;
}

// hoy: fecha de emisión YYYY-MM-DD (Argentina)
export async function armarComprobantePreventa(pv: DatosComprobante, logoPng: Uint8Array | null, hoy: string): Promise<Uint8Array> {
  const pagos = pv.payments.filter((p) => !p.voided_at);
  const { pagado, total, saldo } = resumenPago(pv);

  const pdf = await PDFDocument.create();
  const nro = numeroComprobante(pv.receipt_no);
  pdf.setTitle(`Comprobante de preventa ${nro}`);
  pdf.setAuthor("Melania Professional");
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  const img = logoPng ? await pdf.embedPng(logoPng).catch(() => null) : null;

  const W = 595.28, H = 841.89, M = 48; // A4
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const texto = (t: string, x: number, size = 10, font = reg, color = TINTA) => page.drawText(limpiar(t), { x, y, size, font, color });
  const derecha = (t: string, xDer: number, size = 10, font = reg, color = TINTA) => {
    const s = limpiar(t);
    page.drawText(s, { x: xDer - font.widthOfTextAtSize(s, size), y, size, font, color });
  };
  const nuevaPagina = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const espacio = (alto: number) => {
    if (y - alto < M + 40) nuevaPagina();
  };

  // encabezado
  if (img) {
    const alto = 46;
    const ancho = (img.width / img.height) * alto;
    page.drawImage(img, { x: M, y: y - alto + 6, width: ancho, height: alto });
  } else {
    texto("Melania Professional", M, 18, neg, ROSA);
  }
  derecha("COMPROBANTE DE PAGO", W - M, 13, neg, ROSA);
  y -= 16;
  derecha("Preventa", W - M, 10, reg, SUAVE);
  y -= 14;
  derecha(`N° ${nro}`, W - M, 10, neg);
  y -= 14;
  derecha(`Emitido el ${fmtDate(hoy)}`, W - M, 9, reg, SUAVE);
  y -= 18;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: ROSA });
  y -= 26;

  // datos del cliente
  const dato = (etiqueta: string, valor: string, x: number) => {
    page.drawText(limpiar(etiqueta).toUpperCase(), { x, y: y + 12, size: 7.5, font: neg, color: SUAVE });
    page.drawText(limpiar(valor), { x, y, size: 11, font: reg, color: TINTA });
  };
  dato("Cliente", pv.customer, M);
  dato("Fecha de la preventa", fmtDate(pv.order_date), 380);
  y -= 32;
  if (pv.order_ref) {
    dato("Pedido", pv.order_ref, M);
    y -= 32;
  }
  y -= 4;

  // productos
  const colCant = W - M - 70;
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: FONDO });
  texto("PRODUCTO", M + 8, 8, neg, SUAVE);
  texto("CANTIDAD", colCant, 8, neg, SUAVE);
  y -= 22;
  for (const l of pv.lines) {
    const filas = renglones(l.product.name, reg, 10, colCant - M - 20);
    espacio(filas.length * 13 + 8);
    filas.forEach((f, i) => {
      texto(f, M + 8, 10);
      if (i === 0) texto(`${fmtQty(l.quantity)} ${l.product.unit === "unidad" ? "u." : l.product.unit}`, colCant, 10, neg);
      y -= 13;
    });
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.5, color: LINEA });
    y -= 8;
  }
  y -= 18;

  // pagos
  espacio(60 + pagos.length * 16);
  texto("PAGOS RECIBIDOS", M, 9, neg, ROSA);
  y -= 16;
  if (pagos.length === 0) {
    texto("Todavía no se registraron pagos.", M, 10, reg, SUAVE);
    y -= 16;
  }
  for (const p of pagos) {
    espacio(16);
    texto(`${fmtDate(p.paid_on)}  ·  ${MEDIOS_PAGO[p.method] ?? p.method}${p.notes ? `  ·  ${p.notes}` : ""}`.slice(0, 95), M, 10);
    derecha(pesos(Number(p.amount)), W - M, 10);
    y -= 16;
  }
  y -= 4;
  espacio(80);
  page.drawLine({ start: { x: 330, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.8, color: LINEA });
  y -= 8;
  texto("Total abonado", 330, 11, neg);
  derecha(pesos(pagado), W - M, 13, neg, ROSA);
  y -= 18;
  if (total !== null) {
    texto("Total de la preventa", 330, 10, reg, SUAVE);
    derecha(pesos(total), W - M, 10, reg, SUAVE);
    y -= 15;
    texto(saldo ? "Saldo pendiente" : "Saldo", 330, 10, saldo ? neg : reg, saldo ? TINTA : SUAVE);
    derecha(saldo ? pesos(saldo) : "Pagado en su totalidad", W - M, 10, saldo ? neg : reg, saldo ? TINTA : SUAVE);
    y -= 15;
  }
  y -= 24;

  // constancia
  const aviso = [
    pagado > 0
      ? `Dejamos constancia de que ${pv.customer} abonó ${pesos(pagado)} por la preventa de los productos detallados.`
      : `Dejamos constancia de la preventa de los productos detallados a nombre de ${pv.customer}.`,
    "Los productos quedan reservados a su nombre y se entregan cuando ingresen a nuestro depósito.",
    pagado > 0 ? "Conservá este comprobante como constancia de tu reserva y de tu pago." : "Conservá este comprobante como constancia de tu reserva.",
  ];
  const filasAviso = aviso.flatMap((a) => renglones(a, reg, 9.5, W - 2 * M - 24));
  espacio(filasAviso.length * 13 + 20);
  page.drawRectangle({ x: M, y: y - filasAviso.length * 13 + 2, width: W - 2 * M, height: filasAviso.length * 13 + 14, color: FONDO, borderColor: LINEA, borderWidth: 0.8 });
  y -= 2;
  for (const f of filasAviso) {
    texto(f, M + 12, 9.5);
    y -= 13;
  }

  // pie en todas las páginas
  for (const p of pdf.getPages()) {
    const pie = limpiar(`Melania Professional · Comprobante de preventa ${nro}`);
    p.drawText(pie, { x: (W - reg.widthOfTextAtSize(pie, 8)) / 2, y: M - 20, size: 8, font: reg, color: SUAVE });
  }

  return pdf.save();
}
