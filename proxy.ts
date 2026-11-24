import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/auth";

// Whole site sits behind Basic auth (password changeable in /admin).
// The push script (scripts/push.mjs) may instead authenticate with x-ingest-token on its two endpoints.
const TOKEN_PATHS = new Set(["/api/ingest", "/api/known"]);

export function proxy(req: NextRequest) {
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
