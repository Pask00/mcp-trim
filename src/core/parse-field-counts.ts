/**
 * Parses a "field:count" CSV string into a field→count map.
 * Fields without ":N" default to 1. E.g., "id:3,name,owner.login:2"
 */
export function parseFieldCounts(csv: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const raw of csv.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx > 0) {
      const maybeCount = parseInt(trimmed.slice(colonIdx + 1), 10);
      if (!isNaN(maybeCount) && maybeCount >= 1) {
        result[trimmed.slice(0, colonIdx)] = maybeCount;
        continue;
      }
    }
    result[trimmed] = 1;
  }
  return result;
}
