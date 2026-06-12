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
      // Literal: always show when preceding tokens are satisfied.
      if (inputIdx < input.length || out.length > 0) {
        out.push(token);
        if (inputIdx < input.length && input[inputIdx] === token) {
          inputIdx += 1;
        }
      }
    }
  }

  return out.join("");
}