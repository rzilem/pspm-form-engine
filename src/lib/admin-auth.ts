/** Simple admin authentication via password header or cookie */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

export function isAdminAuthenticated(request: Request): boolean {
  if (!ADMIN_PASSWORD) return false;

  // Check Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const [scheme, value] = authHeader.split(" ");
    if (scheme === "Bearer" && value === ADMIN_PASSWORD) return true;
  }

  // Check X-Admin-Password header (simpler for fetch calls)
  const passwordHeader = request.headers.get("x-admin-password");
  if (passwordHeader === ADMIN_PASSWORD) return true;

  // Check cookie
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(/admin_token=([^;]+)/);
  if (match && match[1] === ADMIN_PASSWORD) return true;

  return false;
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
