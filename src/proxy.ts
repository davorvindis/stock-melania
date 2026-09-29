import { NextResponse, type NextRequest } from "next/server";

// Candado simple mientras no hay usuarios: si APP_PASSWORD está definida,
// exige Basic Auth (cualquier usuario + esa contraseña). Sin APP_PASSWORD
// (ej. desarrollo local), no pide nada.
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (given === password) return NextResponse.next();
  }
  return new NextResponse("Autenticación requerida", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Stock Melania", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
