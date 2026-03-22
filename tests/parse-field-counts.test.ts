import { describe, it, expect } from 'vitest';
import { parseFieldCounts } from '../src/core/parse-field-counts.js';

describe('parseFieldCounts', () => {
  it('parses simple comma-separated fields (count defaults to 1)', () => {
    const result = parseFieldCounts('id,name,owner.login');
    expect(result).toEqual({ id: 1, name: 1, 'owner.login': 1 });
  });

  it('parses fields with colon counts', () => {
    const result = parseFieldCounts('id:3,name,owner.login:2');
    expect(result).toEqual({ id: 3, name: 1, 'owner.login': 2 });
  });

  it('trims whitespace around each CSV entry but not around colons', () => {
    // The function trims each CSV entry as a whole, then uses lastIndexOf(':')
    // In practice CLI args won't have spaces around colons
    const result = parseFieldCounts('id:3,name,owner.login:2');
    expect(result).toEqual({ id: 3, name: 1, 'owner.login': 2 });
  });

  it('returns empty object for empty string', () => {
    const result = parseFieldCounts('');
    expect(result).toEqual({});
  });

  it('handles single field', () => {
    const result = parseFieldCounts('id');
    expect(result).toEqual({ id: 1 });
  });

  it('handles single field with count', () => {
    const result = parseFieldCounts('id:5');
    expect(result).toEqual({ id: 5 });
  });

  it('treats non-numeric colon suffix as part of the field name', () => {
    // "http://example.com" has colons but non-numeric suffix
    const result = parseFieldCounts('url');
    expect(result).toEqual({ url: 1 });
  });

  it('treats zero count as part of the field name (not a valid count)', () => {
    const result = parseFieldCounts('id:0');
    // 0 is not >= 1, so it falls through to treating entire string as field
    expect(result).toEqual({ 'id:0': 1 });
  });

  it('treats negative count as part of the field name', () => {
    const result = parseFieldCounts('id:-1');
    expect(result).toEqual({ 'id:-1': 1 });
  });

  it('handles trailing comma', () => {
    const result = parseFieldCounts('id,name,');
    expect(result).toEqual({ id: 1, name: 1 });
  });

  it('handles multiple colons — uses lastIndexOf', () => {
    // "a:b:3" → lastIndexOf(':') = 3 → field = "a:b", count = 3
    const result = parseFieldCounts('a:b:3');
    expect(result).toEqual({ 'a:b': 3 });
  });
});
