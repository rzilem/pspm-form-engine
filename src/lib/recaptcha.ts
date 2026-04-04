import { logger } from "@/lib/logger";

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY ?? "";
const RECAPTCHA_THRESHOLD = 0.5;

interface RecaptchaResponse {
  success: boolean;
  score?: number;
  action?: string;
  "error-codes"?: string[];
}

/**
 * Verify a reCAPTCHA v3 token server-side.
 * Returns true if:
 *   - reCAPTCHA is not configured (graceful skip)
 *   - Token is valid and score >= threshold
 * Returns false if token is invalid or score is too low.
 */
export async function verifyRecaptcha(token: string | undefined | null): Promise<boolean> {
  if (!RECAPTCHA_SECRET_KEY) {
    // Not configured — skip verification
    return true;
  }

  if (!token) {
    logger.warn("reCAPTCHA token missing");
    return false;
  }

  try {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${encodeURIComponent(RECAPTCHA_SECRET_KEY)}&response=${encodeURIComponent(token)}`,
    });

    const data = (await res.json()) as RecaptchaResponse;

    if (!data.success) {
      logger.warn("reCAPTCHA verification failed", { errors: data["error-codes"] });
      return false;
    }

    const score = data.score ?? 0;
    if (score < RECAPTCHA_THRESHOLD) {
      logger.warn("reCAPTCHA score too low", { score, threshold: RECAPTCHA_THRESHOLD });
      return false;
    }

    return true;
  } catch (err) {
    logger.error("reCAPTCHA verification error", { error: String(err) });
    // Fail open on network errors to not block legitimate users
    return true;
  }
}
