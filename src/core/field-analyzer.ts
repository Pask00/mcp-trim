/**
 * Analyzes JSON structures to collect field paths and their character contributions.
 * Used for auto-learning which fields are worth keeping/trimming.
 */

/** Info about a single field path */
export interface FieldInfo {
  /** Number of times this field path was encountered (across array items, etc.) */
  count: number;
  /** Total characters contributed by this field's values (JSON.stringify length) */
  totalChars: number;
}

/**
 * Walks a JSON value recursively and collects all field paths with their
 * character contributions. Uses dot-notation for nested paths (e.g., "owner.login").
 *
 * For arrays of objects, it aggregates field info across all items.
 */
export function collectFieldPaths(data: unknown): Map<string, FieldInfo> {
  const fields = new Map<string, FieldInfo>();
  walkValue(data, '', fields);
  return fields;
}

function walkValue(value: unknown, prefix: string, fields: Map<string, FieldInfo>): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      walkValue(item, prefix, fields);
    }
    return;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const chars = charSize(val);
      addField(fields, path, chars);

      // Recurse into nested objects (but not arrays — they're handled above)
      if (val !== null && typeof val === 'object') {
        walkValue(val, path, fields);
      }
    }
  }
}

function addField(fields: Map<string, FieldInfo>, path: string, chars: number): void {
  const existing = fields.get(path);
  if (existing) {
    existing.count += 1;
    existing.totalChars += chars;
  } else {
    fields.set(path, { count: 1, totalChars: chars });
  }
}

function charSize(value: unknown): number {
  if (value === null || value === undefined) return 4; // "null"
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/**
 * Computes the total character size of a JSON value.
 */
export function totalJsonSize(data: unknown): number {
  try {
    return JSON.stringify(data).length;
  } catch {
    return 0;
  }
}

/**
 * Given field paths, extracts only the top-level field names (no dots).
 * Useful for building `keep` arrays from collected paths.
 */
export function topLevelFields(paths: string[]): string[] {
  const topLevel = new Set<string>();
  for (const path of paths) {
    const dotIdx = path.indexOf('.');
    topLevel.add(dotIdx >= 0 ? path.slice(0, dotIdx) : path);
  }
  return [...topLevel];
}

/**
 * Groups field paths by their top-level parent, returning nested field maps.
 * e.g., "owner.login" and "owner.id" → { owner: ["login", "id"] }
 */
export function groupNestedFields(paths: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const path of paths) {
    const dotIdx = path.indexOf('.');
    if (dotIdx >= 0) {
      const parent = path.slice(0, dotIdx);
      const child = path.slice(dotIdx + 1);
      // Only include direct children (one level of nesting)
      if (!child.includes('.')) {
        if (!groups[parent]) groups[parent] = [];
        if (!groups[parent].includes(child)) groups[parent].push(child);
      }
    }
  }
  return groups;
}
