"use client";

import { useRef, useState } from "react";

const MAX_LADO = 1800;
const CALIDAD = 0.82;

// achica fotos grandes (las del celular pesan 3–6 MB) a ~0,5 MB antes de subirlas.
// PDFs y fotos chicas se suben tal cual. Si el navegador no puede leer la foto (ej. HEIC en Chrome), va original.
async function achicar(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 900 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", CALIDAD));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

const peso = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function ArchivoComprobante({ name, label, required = false }: { name: string; label?: string; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState("");
  const [procesando, setProcesando] = useState(false);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const original = e.target.files?.[0];
    if (!original) return setInfo("");
    setProcesando(true);
    const final = await achicar(original);
    if (final !== original && ref.current) {
      const dt = new DataTransfer();
      dt.items.add(final);
      ref.current.files = dt.files;
    }
    setProcesando(false);
    setInfo(
      final.size > 4 * 1024 * 1024
        ? `⚠ ${peso(final.size)}: supera 4 MB, sacala con menos calidad`
        : final !== original
          ? `${peso(original.size)} → ${peso(final.size)} ✓`
          : `${peso(final.size)} ✓`
    );
  }

  return (
    <div>
      {label && <label className="mb-1 block text-sm font-medium text-ink">{label}</label>}
      <input
        ref={ref}
        type="file"
        name={name}
        required={required}
        accept="image/*,application/pdf"
        onChange={alElegir}
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-rose-deep"
      />
      <p className="mt-1 text-xs text-soft">{procesando ? "Preparando la foto…" : info || "Foto o PDF (opcional)"}</p>
    </div>
  );
}
