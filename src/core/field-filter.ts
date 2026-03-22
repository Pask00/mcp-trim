import type { FilterOptions, KeepShape } from '../types.js';

/**
 * Filters a JSON value to only the specified fields.
 *
 * The `keep` shape describes which fields to keep:
 * - `true` → always keep (including all nested content)
 * - `{ field: KeepSpec }` → keep and recurse into nested object with sub-specs
 */
export function filterFields(data: unknown, options: FilterOptions): unknown {
  return filterValue(data, options.keep);
}

function filterValue(value: unknown, keep: KeepShape | undefined): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(item => filterValue(item, keep));
  if (typeof value === 'object') return filterObject(value as Record<string, unknown>, keep);
  return value;
}

function filterObject(obj: Record<string, unknown>, keep: KeepShape | undefined): Record<string, unknown> {
  if (!keep) return obj;

  const result: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(keep)) {
    if (!(key in obj)) continue;
    const childShape = typeof spec === 'object' && spec !== null ? spec as KeepShape : undefined;
    result[key] = childShape ? filterValue(obj[key], childShape) : obj[key];
  }
  return result;
}
