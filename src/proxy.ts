import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Autenticación por sesión (Supabase Auth). Sin sesión → /login.
// También refresca el token de sesión en cada request.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims verifica la firma del token acá mismo (claves ES256 publicadas por
  // Supabase) en vez de consultar al servidor de Auth en cada request, que a veces
  // tarda varios segundos. Si el token venció, lo refresca y actualiza las cookies.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ?? null;

  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";
  // backup diario: lo llama el cron de Vercel (sin sesión); se protege en la ruta
  // webhooks y cron de Wix: sin sesión, se protegen en la ruta (firma JWT / secreto)
  if (path === "/api/backup" || path.startsWith("/api/wix/")) return response;

  if (!user && !isLogin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && isLogin) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo-melania.png).*)"],
};
