import { NextResponse, type NextRequest } from "next/server";

// Pretty join links: survey.psprop.net/K7QP2 → /s/K7QP2 (the room-code resolver,
// which redirects to /survey/[id]). Host-agnostic by design — the strict
// room-code charset (uppercase, no 0/O/1/I/L) never collides with the app's
// lowercase route names, so a bare code rewrites everywhere and real paths fall
// through untouched. The matcher keeps middleware off api/_next/asset requests.
const ROOM_CODE = /^\/([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4,8})$/;

export function middleware(req: NextRequest) {
  const match = req.nextUrl.pathname.match(ROOM_CODE);
  if (!match) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/s/${match[1]}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Only single-segment 4–8 char alphanumeric paths reach the middleware; the
  // ROOM_CODE regex above then enforces the exact code charset.
  matcher: "/:code([A-Za-z0-9]{4,8})",
};
