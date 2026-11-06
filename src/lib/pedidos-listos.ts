import "server-only";
import { db } from "./db";

// Pedidos armados (procesados) que todavía no salieron: para retirar por el local o por enviar.
// Se avisa cuando pasó más de 1 día hábil (lunes a viernes) desde que se procesó: un pedido
// procesado el viernes recién aparece como demorado el martes.

const diaAR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

// días hábiles después de la fecha `desde` hasta `hasta` inclusive (ambas YYYY-MM-DD)
export function diasHabilesEntre(desde: string, hasta: string): number {
  let n = 0;
  const d = new Date(`${desde}T12:00:00Z`);
  const fin = new Date(`${hasta}T12:00:00Z`);
  for (d.setUTCDate(d.getUTCDate() + 1); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export function esDemorado(processedAt: string | null, hoy = diaAR.format(new Date())): boolean {
  return !!processedAt && diasHabilesEntre(diaAR.format(new Date(processedAt)), hoy) > 1;
}

export type ResumenListos = {
  retiro: { total: number; sinAvisar: number; sinAvisarDemorados: number; demorados: number };
  envio: { total: number; moto: number; correo: number; otro: number; demorados: number };
};

export async function getPedidosListos(): Promise<ResumenListos> {
  const { data, error } = await db()
    .from("channel_orders")
    .select("processed_at, delivery_rank, customer_notified_at")
    .eq("state", "PROCESSED")
    .is("delivery_status", null)
    .neq("channel_type", "POS");
  if (error) throw new Error(error.message);
  const hoy = diaAR.format(new Date());
  const r: ResumenListos = {
    retiro: { total: 0, sinAvisar: 0, sinAvisarDemorados: 0, demorados: 0 },
    envio: { total: 0, moto: 0, correo: 0, otro: 0, demorados: 0 },
  };
  for (const p of data ?? []) {
    const dem = esDemorado(p.processed_at as string | null, hoy);
    if (p.delivery_rank === 3) {
      r.retiro.total++;
      if (dem) r.retiro.demorados++;
      if (!p.customer_notified_at) {
        r.retiro.sinAvisar++;
        if (dem) r.retiro.sinAvisarDemorados++;
      }
    } else {
      r.envio.total++;
      if (p.delivery_rank === 1) r.envio.moto++;
      else if (p.delivery_rank === 2) r.envio.correo++;
      else r.envio.otro++;
      if (dem) r.envio.demorados++;
    }
  }
  return r;
}
