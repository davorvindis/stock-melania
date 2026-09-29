import Image from "next/image";
import { cambiarPin } from "@/lib/auth-actions";
import { Flash, input, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CambiarPin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Image src="/logo-melania.png" alt="Melania Professional" width={200} height={67} priority />
        </div>
        <div className="rounded-xl border border-line bg-white p-6">
          <h1 className="mb-1 font-display text-2xl text-ink">Elegí tu PIN</h1>
          <p className="mb-4 text-sm text-soft">
            Tu PIN actual es temporal. Elegí uno nuevo de 6 dígitos que solo conozcas vos.
          </p>
          <Flash error={error} />
          <form action={cambiarPin} className="space-y-4">
            <div>
              <label className={label}>Nuevo PIN (6 dígitos)</label>
              <input
                type="password"
                name="pin"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                className={`${input} text-center text-2xl tracking-[0.5em]`}
              />
            </div>
            <div>
              <label className={label}>Repetí el PIN</label>
              <input
                type="password"
                name="pin2"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                className={`${input} text-center text-2xl tracking-[0.5em]`}
              />
            </div>
            <button type="submit" className={`${button} w-full`}>
              Guardar PIN
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
