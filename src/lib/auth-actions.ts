"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { supabaseAuth, requireUser, requireRole, generarPin, SECTIONS } from "./auth";

const pin6 = z.string().regex(/^\d{6}$/, "El PIN debe ser de exactamente 6 dígitos");

// ── Login / logout / cambio de PIN ──────────────────────────────────

export async function login(formData: FormData) {
  const identifier = String(formData.get("usuario") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  if (!identifier || !pin) redirect(`/login?error=${encodeURIComponent("Completá usuario y PIN")}`);

  let email = identifier;
  if (!identifier.includes("@")) {
    let { data } = await db().from("profiles").select("email").ilike("alias", identifier).maybeSingle();
    if (!data) {
      ({ data } = await db().from("profiles").select("email").eq("dni", identifier).maybeSingle());
    }
    if (!data) redirect(`/login?error=${encodeURIComponent("Usuario no encontrado")}`);
    email = data.email;
  }

  const sb = await supabaseAuth();
  const { error } = await sb.auth.signInWithPassword({ email, password: pin });
  if (error) redirect(`/login?error=${encodeURIComponent("Usuario o PIN incorrectos")}`);

  const { data: profile } = await db().from("profiles").select("active").eq("email", email).maybeSingle();
  if (!profile?.active) {
    await sb.auth.signOut();
    redirect(`/login?error=${encodeURIComponent("Usuario desactivado")}`);
  }
  redirect("/");
}

export async function logout() {
  const sb = await supabaseAuth();
  await sb.auth.signOut();
  redirect("/login");
}

export async function cambiarPin(formData: FormData) {
  const back = "/cambiar-pin";
  const sb = await supabaseAuth();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const nuevo = pin6.safeParse(String(formData.get("pin") ?? "").trim());
  const repite = String(formData.get("pin2") ?? "").trim();
  if (!nuevo.success) redirect(`${back}?error=${encodeURIComponent(nuevo.error.issues[0].message)}`);
  if (nuevo.data !== repite) redirect(`${back}?error=${encodeURIComponent("Los PIN no coinciden")}`);

  const { error } = await db().auth.admin.updateUserById(user.id, { password: nuevo.data });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await db().from("profiles").update({ must_change_pin: false }).eq("id", user.id);
  await db().from("audit_logs").insert({ actor: user.email, action: "user:pin_changed", entity: "profiles", entity_id: user.id });
  // cambiar la contraseña invalida la sesión: re-entrar con el PIN nuevo
  const { error: reErr } = await sb.auth.signInWithPassword({ email: user.email!, password: nuevo.data });
  if (reErr) redirect(`/login?error=${encodeURIComponent("PIN actualizado. Entrá de nuevo.")}`);
  redirect(`/?ok=${encodeURIComponent("PIN actualizado")}`);
}

// ── Gestión de usuarios (solo ADMIN) ────────────────────────────────

const usuarioSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  alias: z.string().trim().min(2, "El alias necesita al menos 2 caracteres"),
  dni: z.string().trim().optional(),
  rol: z.enum(["ADMIN", "MANAGER", "OPERATOR"]),
});

export async function crearUsuario(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const back = "/configuracion";
  const parsed = usuarioSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  const d = parsed.data;

  const pin = generarPin();
  const cli = db();
  const { data: created, error } = await cli.auth.admin.createUser({
    email: d.email,
    password: pin,
    email_confirm: true,
  });
  if (error || !created.user) {
    redirect(`${back}?error=${encodeURIComponent(error?.message ?? "No se pudo crear el usuario")}`);
  }
  const { error: pErr } = await cli.from("profiles").insert({
    id: created.user.id,
    email: d.email,
    alias: d.alias,
    dni: d.dni || null,
    role: d.rol,
  });
  if (pErr) {
    await cli.auth.admin.deleteUser(created.user.id);
    redirect(
      `${back}?error=${encodeURIComponent(
        pErr.code === "23505" ? "Ese alias o DNI ya está en uso" : pErr.message
      )}`
    );
  }
  await cli.from("audit_logs").insert({
    actor: admin.alias, action: "user:create", entity: "profiles", entity_id: created.user.id,
    detail: { email: d.email, alias: d.alias, role: d.rol },
  });
  revalidatePath("/configuracion");
  redirect(
    `${back}?ok=${encodeURIComponent(
      `Usuario ${d.alias} creado. PIN temporal: ${pin} — anotalo ahora, no se vuelve a mostrar.`
    )}`
  );
}

export async function blanquearPin(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const back = "/configuracion";
  const id = String(formData.get("usuario") ?? "");
  const { data: target } = await db().from("profiles").select("alias").eq("id", id).maybeSingle();
  if (!target) redirect(`${back}?error=${encodeURIComponent("Usuario inexistente")}`);

  const pin = generarPin();
  const { error } = await db().auth.admin.updateUserById(id, { password: pin });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await db().from("profiles").update({ must_change_pin: true }).eq("id", id);
  await db().from("audit_logs").insert({
    actor: admin.alias, action: "user:pin_reset", entity: "profiles", entity_id: id,
  });
  revalidatePath("/configuracion");
  redirect(
    `${back}?ok=${encodeURIComponent(
      `PIN de ${target.alias} blanqueado. Nuevo PIN temporal: ${pin} — anotalo ahora.`
    )}`
  );
}

export async function actualizarUsuario(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const back = "/configuracion";
  const id = String(formData.get("usuario") ?? "");
  const rol = String(formData.get("rol") ?? "");
  const activo = formData.get("activo") === "on";
  if (!["ADMIN", "MANAGER", "OPERATOR"].includes(rol)) {
    redirect(`${back}?error=${encodeURIComponent("Rol inválido")}`);
  }
  if (id === admin.id && (rol !== "ADMIN" || !activo)) {
    redirect(`${back}?error=${encodeURIComponent("No podés desactivarte ni quitarte ADMIN a vos mismo")}`);
  }
  const permissions: Record<string, boolean> = {};
  for (const s of SECTIONS) {
    permissions[s.key] = formData.get(`perm_${s.key}`) === "on";
  }
  const { error } = await db()
    .from("profiles")
    .update({ role: rol, active: activo, permissions })
    .eq("id", id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await db().from("audit_logs").insert({
    actor: admin.alias, action: "user:update", entity: "profiles", entity_id: id,
    detail: { role: rol, active: activo, permissions },
  });
  revalidatePath("/configuracion");
  redirect(`${back}?ok=${encodeURIComponent("Usuario actualizado")}`);
}
