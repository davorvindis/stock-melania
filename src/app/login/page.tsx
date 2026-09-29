import Image from "next/image";
import { SubmitButton } from "@/components/submit-button";
import { login } from "@/lib/auth-actions";
import { Flash, input, label, button } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Login({
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
          <span className="font-display text-2xl text-ink">Stock</span>
        </div>
        <div className="rounded-xl border border-line bg-white p-6">
          <Flash error={error} />
          <form action={login} className="space-y-4">
            <div>
              <label className={label}>Email, alias o DNI</label>
              <input
                type="text"
                name="usuario"
                required
                autoComplete="username"
                autoCapitalize="none"
                className={input}
              />
            </div>
            <div>
              <label className={label}>PIN (6 dígitos)</label>
              <input
                type="password"
                name="pin"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="current-password"
                className={`${input} text-center text-2xl tracking-[0.5em]`}
              />
            </div>
            <SubmitButton className={`${button} w-full`}>
              Entrar
            </SubmitButton>
          </form>
          <p className="mt-4 text-center text-xs text-soft">
            ¿Sin PIN o bloqueada? Pedile a la administración que te lo blanquee.
          </p>
        </div>
      </div>
    </div>
  );
}
