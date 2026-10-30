"use client";

import { useEffect } from "react";

// En la compu, mover la rueda del mouse o el trackpad sobre un campo numérico con el cursor
// adentro le suma o resta al número sin que se note (ej. 2410 → 2408). Se saca el foco
// antes de que pase, así la rueda solo mueve la página.
export function SinRuedaEnNumeros() {
  useEffect(() => {
    const alGirar = (e: WheelEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.type === "number" && document.activeElement === el) el.blur();
    };
    document.addEventListener("wheel", alGirar, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", alGirar, { capture: true });
  }, []);
  return null;
}
