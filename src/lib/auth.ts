import "server-only";
import { randomInt } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { db } from "./db";

export type Role = "ADMIN" | "MANAGER" | "OPERATOR";

export type Profile = {
  id: string;
  email: string;
  alias: string;
  dni: string | null;
  role: Role;
  permissions: Record<string, boolean>;
  active: boolean;
  must_change_pin: boolean;
  location_id?: string | null;
  location_locked?: boolean;
};

// ubicación a la que está atado el usuario (solo opera stock desde ahí), o null
export function ubicacionFija(p: Profile): string | null {
  return p.location_locked && p.location_id ? p.location_id : null;
}

// secciones de la app gobernadas por permisos (dashboard siempre accesible)
export const SECTIONS: readonly { key: string; label: string }[] = [
  { key: "stock", label: "Stock" },
  { key: "lotes", label: "Lotes" },
  { key: "ingresos", label: "Ingresos" },
  { key: "movimientos", label: "Movimientos" },
  { key: "conteos", label: "Conteos" },
  { key: "productos", label: "Productos" },
  { key: "proveedores", label: "Proveedores" },
  { key: "ubicaciones", label: "Ubicaciones" },
  { key: "auditoria", label: "Auditoría" },
  { key: "configuracion", label: "Configuración" },
  { key: "compras", label: "Órdenes de compra" },
  { key: "costos", label: "Costos" },
];

const ROLE_DEFAULTS: Record<Role, Record<string, boolean>> = {
  ADMIN: {
    stock: true, lotes: true, ingresos: true, movimientos: true, conteos: true,
    productos: true, proveedores: true, ubicaciones: true, auditoria: true, configuracion: true,
    compras: false, costos: false,
  },
  MANAGER: {
    stock: true, lotes: true, ingresos: true, movimientos: true, conteos: true,
    productos: true, proveedores: true, ubicaciones: true, auditoria: true, configuracion: false,
    compras: false, costos: false,
  },
  OPERATOR: {
    stock: true, lotes: true, ingresos: true, movimientos: true, conteos: true,
    productos: true, proveedores: true, ubicaciones: false, auditoria: false, configuracion: false,
    compras: false, costos: false,
  },
};

export function can(p: Profile, section: string): boolean {
  if (section === "dashboard") return true;
  if (section === "configuracion" && p.role !== "ADMIN") return false;
  if (section in p.permissions) return !!p.permissions[section];
  return ROLE_DEFAULTS[p.role]?.[section] ?? false;
}

export function allowedSections(p: Profile): string[] {
  return ["dashboard", ...SECTIONS.filter((s) => can(p, s.key)).map((s) => s.key)];
}

// cliente Supabase Auth atado a las cookies del request (sesión del usuario)
export async function supabaseAuth() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // en Server Components no se pueden escribir cookies; el proxy refresca la sesión
          }
        },
      },
    }
  );
}

export async function getSessionUser(): Promise<Profile | null> {
  const sb = await supabaseAuth();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await db().from("profiles").select("*").eq("id", user.id).single();
  if (!data || !data.active) return null;
  return data as Profile;
}

export async function requireUser(): Promise<Profile> {
  const p = await getSessionUser();
  if (!p) redirect("/login");
  if (p.must_change_pin) redirect("/cambiar-pin");
  return p;
}

export async function requireSection(section: string): Promise<Profile> {
  const p = await requireUser();
  if (!can(p, section)) redirect(`/?error=${encodeURIComponent("No tenés permiso para esa sección")}`);
  return p;
}

export async function requireRole(...roles: Role[]): Promise<Profile> {
  const p = await requireUser();
  if (!roles.includes(p.role)) redirect(`/?error=${encodeURIComponent("Acción reservada a otro rol")}`);
  return p;
}

export function generarPin(): string {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}
