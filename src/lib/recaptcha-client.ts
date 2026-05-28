// Client-side reCAPTCHA v3 helper shared by FormEngine and any other form that
// posts to /api/submit directly (e.g. the legacy insurance page). When no site
// key is configured, loadRecaptchaScript is a no-op and getRecaptchaToken
// returns undefined — and the server fails open in that case.

export const RECAPTCHA_SITE_KEY =
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

type Grecaptcha = NonNullable<Window["grecaptcha"]>;

/**
 * Inject the reCAPTCHA v3 script once. Safe to call from any client component's
 * mount effect; no-op when unconfigured or already present.
 */
export function loadRecaptchaScript(): void {
  if (!RECAPTCHA_SITE_KEY || typeof document === "undefined") return;
  if (document.getElementById("recaptcha-v3")) return;
  const s = document.createElement("script");
  s.id = "recaptcha-v3";
  s.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
  s.async = true;
  document.head.appendChild(s);
}

// The script loads asynchronously, so window.grecaptcha may not exist yet when
// a fast user submits. Poll briefly instead of returning no token (which would
// make the server reject recaptcha-required forms with a 403).
function waitForGrecaptcha(timeoutMs = 8000): Promise<Grecaptcha | undefined> {
  if (typeof window === "undefined") return Promise.resolve(undefined);
  if (window.grecaptcha) return Promise.resolve(window.grecaptcha);
  return new Promise((resolve) => {
    const start = Date.now();
    const id = window.setInterval(() => {
      if (window.grecaptcha) {
        window.clearInterval(id);
        resolve(window.grecaptcha);
      } else if (Date.now() - start > timeoutMs) {
        window.clearInterval(id);
        resolve(undefined);
      }
    }, 100);
  });
}

/**
 * Fetch a reCAPTCHA token for the given action. Returns undefined when
 * unconfigured or the script never loads, so the caller submits without one.
 */
export async function getRecaptchaToken(
  action: string,
): Promise<string | undefined> {
  if (!RECAPTCHA_SITE_KEY || typeof window === "undefined") return undefined;
  try {
    const grecaptcha = await waitForGrecaptcha();
    if (!grecaptcha) return undefined;
    return await new Promise<string>((resolve, reject) => {
      grecaptcha.ready(() => {
        grecaptcha
          .execute(RECAPTCHA_SITE_KEY, { action })
          .then(resolve)
          .catch(reject);
      });
    });
  } catch {
    return undefined;
  }
}
