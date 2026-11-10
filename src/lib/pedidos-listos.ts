import "server-only";
import { db } from "./db";
import { getFeriados } from "./feriados";

// Pedidos armados (procesados) que todavía no salieron: para retirar por el local o por enviar.
// Se avisa cuando pasó más de 1 día hábil (lunes a viernes, sin feriados) desde que se procesó: un
// pedido procesado el viernes recién aparece como demorado el martes (o el miércoles si el lunes es feriado).

import { diaAR, diasHabilesDesde } from "./dias-habiles";

export { diasHabilesEntre } from "./dias-habiles";

export function esDemorado(processedAt: string | null, feriados: Set<string>, hoy = diaAR.format(new Date())): boolean {
  return !!processedAt && diasHabilesDesde(processedAt, feriados, hoy) > 1;
}

export type ResumenListos = {
  retiro: { total: number; sinAvisar: number; sinAvisarDemorados: number; demorados: number };
  envio: { total: number; moto: number; correo: number; otro: number; demorados: number };
};

export async function getPedidosListos(): Promise<ResumenListos> {
  const [{ data, error }, feriados] = await Promise.all([
    db()
      .from("channel_orders")
      .select("processed_at, delivery_rank, customer_notified_at")
      .eq("state", "PROCESSED")
      .is("delivery_status", null)
      .neq("channel_type", "POS"),
    getFeriados(),
  ]);
  if (error) throw new Error(error.message);
  const hoy = diaAR.format(new Date());
  const r: ResumenListos = {
    retiro: { total: 0, sinAvisar: 0, sinAvisarDemorados: 0, demorados: 0 },
    envio: { total: 0, moto: 0, correo: 0, otro: 0, demorados: 0 },
  };
  for (const p of data ?? []) {
    const dem = esDemorado(p.processed_at as string | null, feriados, hoy);
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
