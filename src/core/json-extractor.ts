import type { JsonMatch } from '../types.js';

/**
 * Extracts JSON objects/arrays from mixed text content.
 * Handles: pure JSON, JSON after HTTP headers, multiple JSON blocks.
 */
export function extractJson(text: string): JsonMatch[] {
  const matches: JsonMatch[] = [];
  const len = text.length;
  let i = 0;

  while (i < len) {
    // Skip whitespace
    while (i < len && isWhitespace(text[i])) i++;
    if (i >= len) break;

    // Look for JSON start characters
    if (text[i] === '{' || text[i] === '[') {
      const result = tryParseJsonAt(text, i);
      if (result) {
        matches.push(result);
        i = result.endIndex;
        continue;
      }
    }

    // Skip to next potential JSON start
    i++;
  }

  return matches;
}

/**
 * Tries to extract a single JSON value starting at the given position.
 * Uses bracket/brace counting to find the end of the JSON, then validates with JSON.parse.
 */
function tryParseJsonAt(text: string, startIndex: number): JsonMatch | null {
  const openChar = text[startIndex];
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;
  let i = startIndex;

  while (i < text.length) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      i++;
      continue;
    }

    if (inString) {
      i++;
      continue;
    }

    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0 && ch === closeChar) {
        const raw = text.slice(startIndex, i + 1);
        try {
          const value = JSON.parse(raw);
          return {
            value,
            raw,
            startIndex,
            endIndex: i + 1,
          };
        } catch {
          return null;
        }
      }
    }

    i++;
  }

  return null;
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Replaces JSON segments in mixed text with filtered versions.
 * Non-JSON text is preserved as-is.
 */
export function replaceJsonInText(
  text: string,
  transform: (json: unknown) => unknown,
): string {
  const matches = extractJson(text);
  if (matches.length === 0) return text;

  let result = '';
  let lastEnd = 0;

  for (const match of matches) {
    // Preserve text before this JSON block
    result += text.slice(lastEnd, match.startIndex);
    // Transform and re-serialize the JSON
    const transformed = transform(match.value);
    result += JSON.stringify(transformed);
    lastEnd = match.endIndex;
  }

  // Preserve text after the last JSON block
  result += text.slice(lastEnd);

  return result;
}
