import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";

// Site-wide HTTP Basic auth, enforced in proxy.ts. The password hash lives in the settings table so it can
// be changed from /admin. On first start (no hash stored yet) ADMIN_PASSWORD from the env is hashed and saved.

const KEY_USER = "auth_user";
const KEY_HASH = "auth_hash";

function getSetting(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? String(row.value) : null;
}

function setSetting(key: string, value: string) {
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyHash(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function getAuthUser(): string {
  return getSetting(KEY_USER) || (process.env.ADMIN_USER || "chungkk").trim();
}

function getAuthHash(): string | null {
  const stored = getSetting(KEY_HASH);
  if (stored) return stored;
  const envPw = process.env.ADMIN_PASSWORD;
  if (!envPw) return null;
  const h = hashPassword(envPw);
  setSetting(KEY_HASH, h);
  return h;
}

// scrypt is deliberately slow; remember Authorization headers already verified against the current hash.
const g = globalThis as unknown as { __authOk?: Map<string, string> };
const okCache = (g.__authOk ??= new Map());

/** true when the Authorization header carries the current admin credentials. */
export function checkBasicAuth(header: string | null): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const hash = getAuthHash();
  if (!hash) return false;
  if (okCache.get(header) === hash) return true;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  const user = decoded.slice(0, i);
  const pw = decoded.slice(i + 1);
  if (user !== getAuthUser() || !verifyHash(pw, hash)) return false;
  if (okCache.size > 50) okCache.clear();
  okCache.set(header, hash);
  return true;
}

export function verifyPassword(pw: string): boolean {
  const hash = getAuthHash();
  return !!hash && verifyHash(pw, hash);
}

export function setPassword(pw: string) {
  setSetting(KEY_HASH, hashPassword(pw));
  okCache.clear();
}
