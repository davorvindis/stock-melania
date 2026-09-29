"use client";

import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formAction?: any;
};

// Botón de envío con spinner: se deshabilita mientras la acción corre
// (también evita dobles clicks). Todos los botones del form quedan
// deshabilitados durante el envío.
export function SubmitButton({ children, className = "", ...props }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`relative ${className} disabled:opacity-60`}
      {...props}
    >
      {pending && (
        <span className="absolute inset-0 flex items-center justify-center">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </span>
      )}
      <span className={pending ? "invisible" : undefined}>{children}</span>
    </button>
  );
}
