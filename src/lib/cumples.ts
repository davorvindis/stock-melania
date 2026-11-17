import "server-only";
import { db } from "./db";

const diaAR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

// usuarios activos que cumplen años hoy (hora de Argentina). El 29/2 se festeja el 28/2 en años no bisiestos.
export async function cumpleanerosHoy(hoy = diaAR.format(new Date())): Promise<{ id: string; alias: string }[]> {
  const { data, error } = await db().from("profiles").select("id, alias, birthday").eq("active", true).not("birthday", "is", null);
  if (error) return [];
  const anio = Number(hoy.slice(0, 4));
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
  const mmdd = hoy.slice(5);
  return (data ?? [])
    .filter((u) => {
      let d = String(u.birthday).slice(5, 10);
      if (d === "02-29" && !bisiesto) d = "02-28";
      return d === mmdd;
    })
    .map((u) => ({ id: u.id as string, alias: u.alias as string }));
}
