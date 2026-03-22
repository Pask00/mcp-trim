import { describe, it, expect } from 'vitest';
import {
  collectFieldPaths,
  totalJsonSize,
  topLevelFields,
  groupNestedFields,
} from '../src/core/field-analyzer.js';

describe('field-analyzer', () => {
  describe('collectFieldPaths', () => {
    it('collects top-level fields', () => {
      const data = { id: 1, name: 'test', active: true };
      const fields = collectFieldPaths(data);

      expect(fields.has('id')).toBe(true);
      expect(fields.has('name')).toBe(true);
      expect(fields.has('active')).toBe(true);
      expect(fields.get('id')!.count).toBe(1);
    });

    it('collects nested field paths with dot notation', () => {
      const data = { owner: { login: 'user', id: 42 } };
      const fields = collectFieldPaths(data);

      expect(fields.has('owner')).toBe(true);
      expect(fields.has('owner.login')).toBe(true);
      expect(fields.has('owner.id')).toBe(true);
    });

    it('aggregates across array items', () => {
      const data = [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
        { id: 3, name: 'c' },
      ];
      const fields = collectFieldPaths(data);

      expect(fields.get('id')!.count).toBe(3);
      expect(fields.get('name')!.count).toBe(3);
    });

    it('tracks char contribution', () => {
      const data = { short: 'hi', long: 'x'.repeat(1000) };
      const fields = collectFieldPaths(data);

      expect(fields.get('long')!.totalChars).toBeGreaterThan(fields.get('short')!.totalChars);
    });

    it('handles null and empty objects', () => {
      expect(collectFieldPaths(null).size).toBe(0);
      expect(collectFieldPaths({}).size).toBe(0);
      expect(collectFieldPaths([]).size).toBe(0);
    });

    it('handles deeply nested objects', () => {
      const data = { a: { b: { c: { d: 'deep' } } } };
      const fields = collectFieldPaths(data);

      expect(fields.has('a')).toBe(true);
      expect(fields.has('a.b')).toBe(true);
      expect(fields.has('a.b.c')).toBe(true);
      expect(fields.has('a.b.c.d')).toBe(true);
    });
  });

  describe('totalJsonSize', () => {
    it('returns JSON.stringify length', () => {
      const data = { id: 1, name: 'test' };
      expect(totalJsonSize(data)).toBe(JSON.stringify(data).length);
    });

    it('returns 0 for non-serializable', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(totalJsonSize(circular)).toBe(0);
    });
  });

  describe('topLevelFields', () => {
    it('extracts top-level names from dot-notation paths', () => {
      const result = topLevelFields(['id', 'name', 'owner.login', 'owner.id', 'labels.name']);
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).toContain('owner');
      expect(result).toContain('labels');
      expect(result).not.toContain('owner.login');
    });
  });

  describe('groupNestedFields', () => {
    it('groups nested paths by parent', () => {
      const result = groupNestedFields(['id', 'owner.login', 'owner.id', 'labels.name', 'labels.color']);
      expect(result).toEqual({
        owner: ['login', 'id'],
        labels: ['name', 'color'],
      });
    });

    it('ignores deeply nested paths (more than 1 dot)', () => {
      const result = groupNestedFields(['a.b.c', 'a.b']);
      expect(result).toEqual({ a: ['b'] });
    });
  });
});
