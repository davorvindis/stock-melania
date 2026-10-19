// Empareja un texto libre de una orden de compra ("2000 estuches keratin 15ml")
// con el producto del catálogo más parecido. Devuelve null si no hay uno claro.

const VACIAS = new Set(["de", "para", "x", "el", "la", "los", "las", "con", "pro", "u", "unidad", "unidades", "y", "del", "por", "envasar", "granel"]);
// palabras que separan "clases" de producto: un estuche no es el producto terminado
const CLASES = ["estuch", "etiqueta", "envase", "tapa", "folia", "exhibidor"];
const SINONIMOS: Record<string, string> = { espuma: "mousse", musse: "mousse", micelar: "mousse", micelare: "mousse", btx: "botox" };

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function raiz(p: string) {
  let r = p;
  if (r.length > 4 && r.endsWith("s")) r = r.slice(0, -1);
  if (r.length > 4 && r.endsWith("e") && !/\d/.test(r)) r = r.slice(0, -1);
  return SINONIMOS[r] ?? SINONIMOS[p] ?? r;
}

export function tokens(texto: string): string[] {
  const t = sinAcentos(texto)
    .replace(/(\d+)[.,](\d+)\s*(ml|gr|g)\b/g, "$1$2$3") // "2,5g" → "25g"
    .replace(/(\d+)\s*(ml|gr|g|kg|cc)\b/g, "$1$2") // "15 ml" → "15ml"
    .replace(/\b([a-z]{3,})(\d+)\b/g, "$1 $2") // "perm1" → "perm 1"
    .replace(/[^a-z0-9]+/g, " ");
  return [...new Set(
    t
      .split(" ")
      .filter((w) => w && !VACIAS.has(w) && !/^\d+$/.test(w) && !/^\d+mil$/.test(w) && !/^\d+kg$/.test(w))
      .map(raiz)
      .map((w) => (w === "gr" ? "g" : w.replace(/(\d+)gr$/, "$1g")))
  )];
}

const coincide = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
const esMedida = (w: string) => /^\d+(ml|g|kg|cc)$/.test(w);
const clases = (ts: string[]) => CLASES.filter((c) => ts.some((w) => w.startsWith(c))).join("|");

export function emparejar<T extends { id: string; name: string }>(texto: string, productos: T[]): T | null {
  // granel (kg): lo que vuelve envasado es otro producto, mejor que lo elija la persona
  if (/\bgranel\b|\d\s*kg\b/i.test(texto)) return null;
  const d = tokens(texto);
  const palabras = d.filter((w) => !esMedida(w) && !CLASES.some((c) => w.startsWith(c)));
  if (!palabras.length) return null;
  const dClase = clases(d);
  const dMedidas = d.filter(esMedida);
  const tProd = productos.map((p) => ({ p, t: tokens(p.name) }));
  // peso de cada palabra: las que aparecen en pocos productos distinguen más (keratin > lash)
  const df = new Map<string, number>();
  for (const { t } of tProd) for (const w of t) df.set(w, (df.get(w) ?? 0) + 1);
  const peso = (w: string) => {
    let n = 0;
    for (const [k, v] of df) if (coincide(w, k)) n = Math.max(n, v);
    return 1 + Math.log((productos.length + 1) / (n + 1));
  };
  const total = palabras.reduce((s, w) => s + peso(w), 0);

  const puntajes = tProd.map(({ p, t }) => {
    if (clases(t) !== dClase) return { p, s: 0 };
    const hits = palabras.filter((w) => t.some((x) => coincide(w, x))).reduce((s, w) => s + peso(w), 0);
    let s = hits / total;
    const tMedidas = t.filter(esMedida);
    if (dMedidas.length && tMedidas.length) {
      if (!dMedidas.some((m) => tMedidas.includes(m))) return { p, s: 0 }; // 500ml no es 15ml
      s += 0.15;
    }
    // palabras del producto que el texto no menciona restan (más si son distintivas)
    const sobrantes = t.filter((x) => !esMedida(x) && !CLASES.some((c) => x.startsWith(c)) && !d.some((w) => coincide(w, x)));
    s -= sobrantes.reduce((acc, x) => acc + 0.04 * peso(x), 0);
    return { p, s };
  });
  puntajes.sort((a, b) => b.s - a.s);
  const [mejor, segundo] = puntajes;
  if (!mejor || mejor.s < 0.55) return null;
  if (segundo && mejor.s - segundo.s < 0.05) return null; // empate: mejor no adivinar
  return mejor.p;
}
