import "server-only";
import { createClient } from "@supabase/supabase-js";

// Cliente con service_role: SOLO servidor. RLS deniega todo acceso directo,
// así que toda lectura/escritura pasa por acá.
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan variables de entorno de Supabase");
  return createClient(url, key, { auth: { persistSession: false } });
}
