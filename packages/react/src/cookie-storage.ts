import type { TokenStorage } from "./storage.js";

export type CookieOptions = {
  /** Cookie name. Default: "authai-jwt". */
  name?: string;
  /** Path scope. Default: "/". */
  path?: string;
  /**
   * SameSite policy. Default: "lax".
   *
   * Note: when set to "none", the Secure flag is automatically enforced
   * (required by all modern browsers; non-secure SameSite=None cookies
   * are silently dropped).
   */
  sameSite?: "lax" | "strict" | "none";
  /**
   * Secure flag. Default: true when location.protocol === "https:", false otherwise.
   * Set explicitly to override.
   */
  secure?: boolean;
  /** Lifetime in seconds. Default: 14*24*60*60 (matches relay JWT lifetime). */
  maxAge?: number;
  /** Optional Domain attribute. Default: omitted (cookie is host-only). */
  domain?: string;
};

const DEFAULTS = {
  name: "authai-jwt",
  path: "/",
  sameSite: "lax" as const,
  maxAge: 14 * 24 * 60 * 60,
};

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

function isSecureByDefault(): boolean {
  if (typeof location === "undefined") return false;
  return location.protocol === "https:";
}

function readCookie(name: string): string | null {
  if (!hasDocument()) return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const c of document.cookie.split(";")) {
    const trimmed = c.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

function writeCookie(
  name: string,
  value: string,
  opts: { path: string; sameSite: "lax" | "strict" | "none"; maxAge: number; secure: boolean; domain?: string },
): void {
  if (!hasDocument()) return;
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `path=${opts.path}`,
    `max-age=${opts.maxAge}`,
    `samesite=${opts.sameSite}`,
  ];
  if (opts.secure) parts.push("secure");
  if (opts.domain) parts.push(`domain=${opts.domain}`);
  document.cookie = parts.join("; ");
}

function deleteCookie(name: string, opts: { path: string; domain?: string }): void {
  if (!hasDocument()) return;
  const parts = [
    `${encodeURIComponent(name)}=`,
    `path=${opts.path}`,
    "expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (opts.domain) parts.push(`domain=${opts.domain}`);
  document.cookie = parts.join("; ");
}

export function cookieAdapter(options: CookieOptions = {}): TokenStorage {
  const name = options.name ?? DEFAULTS.name;
  const path = options.path ?? DEFAULTS.path;
  const sameSite = options.sameSite ?? DEFAULTS.sameSite;
  const maxAge = options.maxAge ?? DEFAULTS.maxAge;
  const secure = options.secure ?? isSecureByDefault();
  // SameSite=None requires Secure (Chrome 80+, Safari 13+). Coerce silently
  // instead of letting the browser drop the cookie with no error.
  const effectiveSecure = sameSite === "none" ? true : secure;
  const domain = options.domain;

  return {
    get: () => readCookie(name),
    set: (jwt) => writeCookie(name, jwt, { path, sameSite, maxAge, secure: effectiveSecure, domain }),
    clear: () => deleteCookie(name, { path, domain }),
  };
}
