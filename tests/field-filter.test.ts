import { describe, it, expect } from 'vitest';
import { filterFields } from '../src/core/field-filter.js';
import type { FilterOptions } from '../src/types.js';

const defaultOptions: FilterOptions = {};

describe('filterFields', () => {
  describe('keep shape (allowlist)', () => {
    it('keeps only specified top-level fields', () => {
      const data = { id: 1, name: 'test', secret: 'hidden', extra: 'gone' };
      const result = filterFields(data, { ...defaultOptions, keep: { id: true, name: true } });
      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('returns empty object when no fields match', () => {
      const data = { a: 1, b: 2 };
      const result = filterFields(data, { ...defaultOptions, keep: { x: true, y: true } });
      expect(result).toEqual({});
    });

    it('passes through all fields when keep is undefined', () => {
      const data = { a: 1, b: 2 };
      const result = filterFields(data, defaultOptions);
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });

  describe('nested object filtering', () => {
    it('filters nested object fields', () => {
      const data = {
        id: 1,
        name: 'repo',
        owner: { login: 'user', id: 42, avatar_url: 'http://...', type: 'User' },
      };
      const result = filterFields(data, {
        ...defaultOptions,
        keep: {
          id: true,
          name: true,
          owner: { login: true, id: true },
        },
      });
      expect(result).toEqual({
        id: 1,
        name: 'repo',
        owner: { login: 'user', id: 42 },
      });
    });

    it('filters arrays of nested objects', () => {
      const data = {
        items: [
          { name: 'label1', color: 'red', id: 1 },
          { name: 'label2', color: 'blue', id: 2 },
        ],
      };
      const result = filterFields(data, {
        ...defaultOptions,
        keep: {
          items: { name: true, color: true },
        },
      });
      expect(result).toEqual({
        items: [
          { name: 'label1', color: 'red' },
          { name: 'label2', color: 'blue' },
        ],
      });
    });
  });

  describe('deep nested filtering', () => {
    it('filters multiple levels deep', () => {
      const data = {
        id: 1,
        owner: {
          login: 'octocat',
          company: {
            name: 'GitHub',
            revenue: 1000000,
            address: { city: 'SF', zip: '94107', country: 'US' },
          },
        },
      };
      const result = filterFields(data, {
        ...defaultOptions,
        keep: {
          id: true,
          owner: {
            login: true,
            company: {
              name: true,
              address: { city: true },
            },
          },
        },
      });
      expect(result).toEqual({
        id: 1,
        owner: {
          login: 'octocat',
          company: {
            name: 'GitHub',
            address: { city: 'SF' },
          },
        },
      });
    });

    it('handles deep nested arrays of objects', () => {
      const data = {
        org: {
          teams: [
            { name: 'core', members: [{ login: 'a', role: 'admin', email: 'a@x' }, { login: 'b', role: 'dev', email: 'b@x' }] },
            { name: 'docs', members: [{ login: 'c', role: 'dev', email: 'c@x' }] },
          ],
        },
      };
      const result = filterFields(data, {
        ...defaultOptions,
        keep: {
          org: {
            teams: {
              name: true,
              members: { login: true, role: true },
            },
          },
        },
      });
      expect(result).toEqual({
        org: {
          teams: [
            { name: 'core', members: [{ login: 'a', role: 'admin' }, { login: 'b', role: 'dev' }] },
            { name: 'docs', members: [{ login: 'c', role: 'dev' }] },
          ],
        },
      });
    });
  });

  describe('array handling', () => {
    it('passes through all array items', () => {
      const data = { results: Array.from({ length: 50 }, (_, i) => i) };
      const result = filterFields(data, {
        ...defaultOptions,
        keep: { results: true },
      }) as { results: unknown[] };
      expect(result.results).toHaveLength(50);
    });

    it('handles top-level arrays', () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = filterFields(data, defaultOptions) as unknown[];
      expect(result).toHaveLength(3);
    });
  });

  describe('edge cases', () => {
    it('handles null', () => {
      expect(filterFields(null, defaultOptions)).toBeNull();
    });

    it('handles undefined', () => {
      expect(filterFields(undefined, defaultOptions)).toBeUndefined();
    });

    it('handles primitives', () => {
      expect(filterFields(42, defaultOptions)).toBe(42);
      expect(filterFields(true, defaultOptions)).toBe(true);
    });

    it('handles empty objects', () => {
      expect(filterFields({}, { ...defaultOptions, keep: { x: true } })).toEqual({});
    });

    it('handles empty arrays', () => {
      expect(filterFields([], defaultOptions)).toEqual([]);
    });
  });
});
