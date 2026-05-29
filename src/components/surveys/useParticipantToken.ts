"use client";

import { useEffect, useState } from "react";

const KEY = "pspm_survey_participant_token";

/**
 * Client-minted anonymous device id, stored in localStorage AND a cookie so it
 * survives reloads. Used for one-response-per-device de-dup on informal polls —
 * this is friction (incognito / a second phone defeats it), NOT a vote wall.
 * Deliberately no server-side IP hashing: cleaner PII posture.
 */
export function useParticipantToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Deferred so the setState isn't called synchronously in the effect body.
    const handle = setTimeout(() => {
      let value: string | null = null;
      try {
        value = localStorage.getItem(KEY);
      } catch {
        // localStorage blocked (private mode quirks) — fall through to mint.
      }
      if (!value) {
        value =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `pt_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        try {
          localStorage.setItem(KEY, value);
        } catch {
          /* ignore */
        }
        // Mirror to a 30-day cookie as a backup signal.
        document.cookie = `${KEY}=${value}; Max-Age=2592000; Path=/; SameSite=Lax`;
      }
      setToken(value);
    }, 0);
    return () => clearTimeout(handle);
  }, []);

  return token;
}
