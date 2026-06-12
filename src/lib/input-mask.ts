/**
 * GF-style input masks (dependency-free).
 * Tokens: 9 = digit, a = letter, * = alphanumeric; all other chars are literals.
 */

function maskAcceptsDigit(mask: string): boolean {
  return mask.includes("9") || mask.includes("*");
}

function maskAcceptsLetter(mask: string): boolean {
  return mask.includes("a") || mask.includes("*");
}

/** Extract user-typed characters that can fill mask token slots (literals stripped). */
export function extractMaskInputChars(mask: string, raw: string): string {
  const allowDigit = maskAcceptsDigit(mask);
  const allowLetter = maskAcceptsLetter(mask);
  const out: string[] = [];
  for (const ch of raw) {
    if (/\d/.test(ch) && allowDigit) out.push(ch);
    else if (/[a-zA-Z]/.test(ch) && allowLetter) out.push(ch);
  }
  return out.join("");
}

function maskTokenMatches(ch: string, token: string): boolean {
  if (token === "9") return /\d/.test(ch);
  if (token === "a") return /[a-zA-Z]/.test(ch);
  if (token === "*") return /[a-zA-Z0-9]/.test(ch);
  return false;
}

/**
 * Format `raw` against `mask`. Non-matching characters in `raw` are ignored.
 * Literals from the mask are inserted as the user types (e.g. parens, dashes).
 */
export function applyInputMask(mask: string, raw: string): string {
  if (!mask) return raw;
  const input = extractMaskInputChars(mask, raw);
  const out: string[] = [];
  let inputIdx = 0;

  for (let i = 0; i < mask.length; i++) {
    const token = mask[i];
    if (token === "9" || token === "a" || token === "*") {
      if (inputIdx >= input.length) break;
      const ch = input[inputIdx];
      if (!maskTokenMatches(ch, token)) break;
      out.push(ch);
      inputIdx += 1;
    } else {
      // Literal: emit only while more raw input remains — opening parens
      // before the first digit, and separators between filled token groups.
      // Never append trailing literals after the last entered digit (so
      // backspace from "(123) " does not re-add ") ").
      if (inputIdx < input.length) {
        out.push(token);
        if (input[inputIdx] === token) {
          inputIdx += 1;
        }
      }
    }
  }

  return out.join("");
}

/** Lightweight regression checks (no test runner). Throws on failure. */
export function runInputMaskSelfTest(): void {
  const mask = "(999) 999-9999";
  const assert = (label: string, actual: string, expected: string) => {
    if (actual !== expected) {
      throw new Error(
        `input-mask self-test "${label}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  };

  assert("1 digit", applyInputMask(mask, "1"), "(1");
  assert("3 digits", applyInputMask(mask, "123"), "(123");
  assert("4 digits", applyInputMask(mask, "1234"), "(123) 4");
  assert("full phone", applyInputMask(mask, "5122516122"), "(512) 251-6122");

  // Simulated backspace: fewer digits must not re-append trailing literals.
  assert("backspace from 4 to 3", applyInputMask(mask, "123"), "(123");
  assert("backspace from 3 to 2", applyInputMask(mask, "12"), "(12");
}