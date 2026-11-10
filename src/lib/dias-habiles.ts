// Días hábiles: lunes a viernes que no son feriado (los feriados salen de getFeriados() en lib/feriados).

export const diaAR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

// días hábiles después de la fecha `desde` hasta `hasta` inclusive (ambas YYYY-MM-DD)
export function diasHabilesEntre(desde: string, hasta: string, feriados: Set<string> = new Set()): number {
  let n = 0;
  const d = new Date(`${desde}T12:00:00Z`);
  const fin = new Date(`${hasta}T12:00:00Z`);
  for (d.setUTCDate(d.getUTCDate() + 1); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !feriados.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

// días hábiles desde un momento (timestamp) hasta hoy, en hora argentina
export function diasHabilesDesde(iso: string, feriados: Set<string>, hoy = diaAR.format(new Date())): number {
  return diasHabilesEntre(diaAR.format(new Date(iso)), hoy, feriados);
}
