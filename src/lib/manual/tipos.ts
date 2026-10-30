import { can, ubicacionFija, type Profile, type Role } from "@/lib/auth";

// Manual de uso dentro de la app. Cada parte dice qué hace falta para verla (pestaña
// habilitada, rol, usuario atado a una ubicación) y cada usuario ve solo lo suyo: si se le
// habilita una pestaña nueva en Configuración, la parte del manual aparece sola.
// Texto con **negrita** y *cursiva*.

export type Regla = {
  s?: string[]; // alguna de estas pestañas habilitada
  r?: Role[]; // alguno de estos roles
  fija?: boolean; // true: solo usuarios atados a una ubicación (ej. Karla) · false: solo los que no
};

export type Fila = string[] | { c: string[]; ver?: Regla };

export type Bloque = { ver?: Regla } & (
  | { tipo: "p"; texto: string }
  | { tipo: "lista"; items: (string | { t: string; ver?: Regla })[] }
  | { tipo: "pasos"; items: (string | { t: string; ver?: Regla })[] }
  | { tipo: "tabla"; cols: string[]; filas: Fila[] }
  | { tipo: "aviso"; texto: string; titulo?: string; tono?: "info" | "ambar" | "verde" }
  | { tipo: "sub"; titulo: string; bloques: Bloque[] }
  | { tipo: "permisos" } // lo que puede hacer el usuario que está mirando
);

export type Capitulo = { id: string; titulo: string; ver?: Regla; bloques: Bloque[] };

export function cumple(u: Profile, v?: Regla): boolean {
  if (!v) return true;
  if (v.s && !v.s.some((s) => can(u, s))) return false;
  if (v.r && !v.r.includes(u.role)) return false;
  if (v.fija !== undefined && !!ubicacionFija(u) !== v.fija) return false;
  return true;
}

function filtrarBloque(u: Profile, b: Bloque): Bloque | null {
  if (!cumple(u, b.ver)) return null;
  switch (b.tipo) {
    case "lista":
    case "pasos": {
      const items = b.items.filter((i) => typeof i === "string" || cumple(u, i.ver));
      return items.length ? { ...b, items } : null;
    }
    case "tabla": {
      const filas = b.filas.filter((f) => Array.isArray(f) || cumple(u, f.ver));
      return filas.length ? { ...b, filas } : null;
    }
    case "sub": {
      const bloques = b.bloques.map((x) => filtrarBloque(u, x)).filter((x): x is Bloque => !!x);
      return bloques.length ? { ...b, bloques } : null;
    }
    default:
      return b;
  }
}

export function manualPara(u: Profile, capitulos: Capitulo[]): Capitulo[] {
  return capitulos
    .filter((c) => cumple(u, c.ver))
    .map((c) => ({ ...c, bloques: c.bloques.map((b) => filtrarBloque(u, b)).filter((b): b is Bloque => !!b) }))
    .filter((c) => c.bloques.length > 0);
}

// atajos para escribir el contenido
export const P = (texto: string, ver?: Regla): Bloque => ({ tipo: "p", texto, ver });
export const L = (items: (string | { t: string; ver?: Regla })[], ver?: Regla): Bloque => ({ tipo: "lista", items, ver });
export const N = (items: (string | { t: string; ver?: Regla })[], ver?: Regla): Bloque => ({ tipo: "pasos", items, ver });
export const T = (cols: string[], filas: Fila[], ver?: Regla): Bloque => ({ tipo: "tabla", cols, filas, ver });
export const A = (texto: string, titulo?: string, tono: "info" | "ambar" | "verde" = "info", ver?: Regla): Bloque => ({ tipo: "aviso", texto, titulo, tono, ver });
export const S = (titulo: string, bloques: Bloque[], ver?: Regla): Bloque => ({ tipo: "sub", titulo, bloques, ver });
export const solo = (t: string, ver: Regla) => ({ t, ver });

// reglas frecuentes
export const ENCARGADA: Regla = { r: ["ADMIN", "MANAGER"] };
export const ADMIN: Regla = { r: ["ADMIN"] };
