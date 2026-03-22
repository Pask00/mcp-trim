import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  saveConfig,
  findMatchingRules,
  buildFilterOptions,
  upsertRule,
  removeRule,
  getDefaultConfig,
} from '../src/core/config-manager.js';
import type { TrimConfig, TrimRule } from '../src/types.js';

describe('config-manager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp-trim-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  describe('getDefaultConfig', () => {
    it('returns valid defaults', () => {
      const config = getDefaultConfig();
      expect(config.version).toBe(1);
      expect(config.rules).toEqual([]);
    });
  });

  describe('saveConfig / loadConfig', () => {
    it('round-trips config through save and load', () => {
      const config: TrimConfig = {
        version: 1,
        rules: [
          {
            id: 'test-rule',
            match: { toolName: 'Bash' },
            keep: { id: true, name: true },
          },
        ],
      };

      const filePath = join(tmpDir, '.config', 'mcp-trim', 'config.json');
      mkdirSync(join(tmpDir, '.config', 'mcp-trim'), { recursive: true });
      saveConfig(config, filePath);
      const loaded = loadConfig(tmpDir);

      expect(loaded.rules).toHaveLength(1);
      expect(loaded.rules[0].id).toBe('test-rule');
      expect(loaded.rules[0].keep).toEqual({ id: true, name: true });
    });
  });

  describe('findMatchingRules', () => {
    const config: TrimConfig = {
      version: 1,
      rules: [
        { id: 'bash-rule', match: { toolName: 'Bash' }, keep: { id: true } },
        { id: 'mcp-issues', match: { toolName: 'mcp__github.*list_issues' }, keep: { number: true, title: true } },
        { id: 'disabled-rule', match: { toolName: 'Bash' }, keep: { x: true }, enabled: false },
      ],
    };

    it('matches by tool name', () => {
      const rules = findMatchingRules('mcp__github__list_issues', config);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('mcp-issues');
    });

    it('matches by tool name regex', () => {
      const rules = findMatchingRules('Bash', config);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('bash-rule');
    });

    it('does not match different tool name', () => {
      const rules = findMatchingRules('Read', config);
      expect(rules).toHaveLength(0);
    });

    it('skips disabled rules', () => {
      const rules = findMatchingRules('Bash', config);
      // disabled-rule matches toolName "Bash" but is disabled
      expect(rules.find((r) => r.id === 'disabled-rule')).toBeUndefined();
    });

    it('does not match rules with no matchers', () => {
      const configWithEmptyMatcher: TrimConfig = {
        version: 1,
        rules: [
          { id: 'empty-matcher', match: {}, keep: { id: true } },
        ],
      };
      const rules = findMatchingRules('mcp__github__get_repository', configWithEmptyMatcher);
      expect(rules).toHaveLength(0);
    });
  });

  describe('buildFilterOptions', () => {
    it('merges rule with defaults', () => {
      const rule: TrimRule = { id: 'test', match: { toolName: 'X' }, keep: { a: true, b: true } };
      const options = buildFilterOptions(rule);
      expect(options.keep).toEqual({ a: true, b: true });
    });
  });

  describe('upsertRule', () => {
    it('adds a new rule', () => {
      const config = getDefaultConfig();
      const rule: TrimRule = { id: 'new', match: { toolName: 'Test' }, keep: { x: true } };
      const updated = upsertRule(config, rule);
      expect(updated.rules).toHaveLength(1);
      expect(updated.rules[0].id).toBe('new');
    });

    it('updates an existing rule', () => {
      const config: TrimConfig = {
        version: 1,
        rules: [{ id: 'existing', match: { toolName: 'Old' }, keep: { a: true } }],
      };
      const updated = upsertRule(config, { id: 'existing', match: { toolName: 'New' }, keep: { b: true } });
      expect(updated.rules).toHaveLength(1);
      expect(updated.rules[0].keep).toEqual({ b: true });
    });
  });

  describe('removeRule', () => {
    it('removes a rule by id', () => {
      const config: TrimConfig = {
        version: 1,
        rules: [
          { id: 'keep-me', match: { toolName: 'A' } },
          { id: 'remove-me', match: { toolName: 'B' } },
        ],
      };
      const updated = removeRule(config, 'remove-me');
      expect(updated.rules).toHaveLength(1);
    });
  });
});
