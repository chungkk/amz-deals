import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/auth";

// The public deals page (/) is open to everyone; everything else (/admin, /api/*) sits behind Basic auth
// (password changeable in /admin).
// The push script (scripts/push.mjs) may instead authenticate with x-ingest-token on its two endpoints.
const TOKEN_PATHS = new Set(["/api/ingest", "/api/known"]);
const PUBLIC_PATHS = new Set(["/", "/robots.txt"]);

export function proxy(req: NextRequest) {
  if (PUBLIC_PATHS.has(req.nextUrl.pathname)) return NextResponse.next();
  const token = process.env.INGEST_TOKEN;
  if (token && TOKEN_PATHS.has(req.nextUrl.pathname) && req.headers.get("x-ingest-token") === token) {
    return NextResponse.next();
  }
  if (checkBasicAuth(req.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Amazon Deals", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
