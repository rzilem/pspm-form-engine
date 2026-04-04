/** Simple admin authentication via password header or cookie */

import { timingSafeEqual } from "crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

/**
 * Constant-time string comparison to prevent timing attacks.
 * Always runs timingSafeEqual even when lengths differ, to avoid
 * leaking length information through short-circuit timing.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // consume constant time regardless
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function isAdminAuthenticated(request: Request): boolean {
  if (!ADMIN_PASSWORD) return false;

  // Check Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const [scheme, value] = authHeader.split(" ");
    if (scheme === "Bearer" && safeCompare(value ?? "", ADMIN_PASSWORD)) return true;
  }

  // Check X-Admin-Password header (simpler for fetch calls)
  const passwordHeader = request.headers.get("x-admin-password");
  if (passwordHeader !== null && safeCompare(passwordHeader, ADMIN_PASSWORD)) return true;

  // Check cookie
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(/admin_token=([^;]+)/);
  if (match && safeCompare(match[1], ADMIN_PASSWORD)) return true;

  return false;
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Returns cookie header attributes for the admin session cookie.
 * Use when setting admin_token in a login response.
 *
 * Example:
 *   `Set-Cookie: admin_token=VALUE; ${adminCookieAttributes()}`
 */
export function adminCookieAttributes(): string {
  return "HttpOnly; SameSite=Strict; Secure; Path=/";
}
