import { describe, it, expect } from 'vitest';
import { suggestRules, suggestionToRule } from '../src/core/suggestion-engine.js';
import { recordFeedback, resetStats, recordInvocation } from '../src/core/stats-tracker.js';
import type { StatsData } from '../src/core/stats-tracker.js';
import type { TrimConfig } from '../src/types.js';

function makeStats(overrides?: Partial<StatsData>): StatsData {
  return {
    version: 1,
    toolProfiles: {},
    sessionStats: {
      totalInvocations: 0,
      totalOriginalChars: 0,
      totalTrimmedChars: 0,
      totalSavedChars: 0,
      estimatedTokensSaved: 0,
    },
    ...overrides,
  };
}

const emptyConfig: TrimConfig = {
  version: 1,
  rules: [],
};

describe('suggestion-engine', () => {
  describe('suggestRules (requires feedback)', () => {
    it('suggests a rule when feedback meets threshold', () => {
      const stats = makeStats({
        toolProfiles: {
          'mcp__github__get_repository::api.github.com/repos': {
            invocations: 10,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-02T00:00:00Z',
            feedbackCount: 5,
            fields: {
              id: { seen: 10, charContribution: 50, usedCount: 5 },
              name: { seen: 10, charContribution: 200, usedCount: 4 },
              html_url: { seen: 10, charContribution: 500, usedCount: 3 },
              description: { seen: 10, charContribution: 5000, usedCount: 0 },
              owner: { seen: 10, charContribution: 3000, usedCount: 0 },
              'owner.login': { seen: 10, charContribution: 150, usedCount: 4 },
              'owner.avatar_url': { seen: 10, charContribution: 2000, usedCount: 0 },
              forks_count: { seen: 10, charContribution: 30, usedCount: 0 },
              stargazers_count: { seen: 10, charContribution: 40, usedCount: 0 },
              topics: { seen: 8, charContribution: 800, usedCount: 0 },
            },
            totalOriginalChars: 20000,
            totalTrimmedChars: 20000,
          },
        },
      });

      const suggestions = suggestRules(stats, emptyConfig, {});
      expect(suggestions.length).toBeGreaterThan(0);

      const s = suggestions[0];
      expect(s.invocations).toBe(10);
      // Keeps fields used at least once
      expect(Object.keys(s.keep)).toContain('id');
      expect(Object.keys(s.keep)).toContain('name');
      expect(Object.keys(s.keep)).toContain('html_url');
      // Drops fields never used
      expect(Object.keys(s.keep)).not.toContain('forks_count');
      expect(Object.keys(s.keep)).not.toContain('stargazers_count');
      expect(Object.keys(s.keep)).not.toContain('topics');
    });

    it('does NOT suggest when there is no feedback', () => {
      const stats = makeStats({
        toolProfiles: {
          'mcp__github__get_repository::api.github.com/repos': {
            invocations: 10,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-02T00:00:00Z',
            feedbackCount: 0,
            fields: {
              id: { seen: 10, charContribution: 50, usedCount: 0 },
              name: { seen: 10, charContribution: 200, usedCount: 0 },
              description: { seen: 10, charContribution: 5000, usedCount: 0 },
              owner: { seen: 10, charContribution: 3000, usedCount: 0 },
            },
            totalOriginalChars: 20000,
            totalTrimmedChars: 20000,
          },
        },
      });

      const suggestions = suggestRules(stats, emptyConfig);
      expect(suggestions).toHaveLength(0);
    });

    it('does NOT suggest when feedback is below threshold', () => {
      const stats = makeStats({
        toolProfiles: {
          'mcp__github__get_repository::test': {
            invocations: 10,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-02T00:00:00Z',
            feedbackCount: 1,
            fields: {
              id: { seen: 10, charContribution: 50, usedCount: 1 },
              body: { seen: 10, charContribution: 10000, usedCount: 1 },
            },
            totalOriginalChars: 20000,
            totalTrimmedChars: 20000,
          },
        },
      });

      // minFeedback=3, but only 1 feedback entry → no suggestion
      const suggestions = suggestRules(stats, emptyConfig, { minFeedback: 3 });
      expect(suggestions).toHaveLength(0);
    });

    it('skips tools with too few invocations', () => {
      const stats = makeStats({
        toolProfiles: {
          'mcp__github__get_repository::rare': {
            invocations: 1,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-01T00:00:00Z',
            feedbackCount: 0,
            fields: { id: { seen: 1, charContribution: 5, usedCount: 0 } },
            totalOriginalChars: 100,
            totalTrimmedChars: 100,
          },
        },
      });

      const suggestions = suggestRules(stats, emptyConfig, { minInvocations: 3 });
      expect(suggestions).toHaveLength(0);
    });

    it('skips tools that already have an active rule', () => {
      const stats = makeStats({
        toolProfiles: {
          'mcp__github__get_repository::github': {
            invocations: 20,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-02T00:00:00Z',
            feedbackCount: 5,
            fields: {
              id: { seen: 20, charContribution: 100, usedCount: 5 },
              description: { seen: 20, charContribution: 10000, usedCount: 0 },
            },
            totalOriginalChars: 50000,
            totalTrimmedChars: 50000,
            ruleId: 'existing-rule',
          },
        },
      });

      const configWithRule: TrimConfig = {
        ...emptyConfig,
        rules: [{ id: 'existing-rule', match: { toolName: 'mcp__github__get_repository' }, keep: { id: true } }],
      };

      const suggestions = suggestRules(stats, configWithRule);
      expect(suggestions).toHaveLength(0);
    });

    it('returns empty for no data', () => {
      const suggestions = suggestRules(makeStats(), emptyConfig);
      expect(suggestions).toHaveLength(0);
    });
  });

  describe('suggestRules (used-at-least-once details)', () => {
    it('keeps fields used at least once and drops never-used fields', () => {
      const stats = makeStats({
        toolProfiles: {
          'mcp__github__get_repository::api.github.com/repos': {
            invocations: 10,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-02T00:00:00Z',
            feedbackCount: 5,
            fields: {
              id: { seen: 10, charContribution: 50, usedCount: 5 },
              name: { seen: 10, charContribution: 200, usedCount: 4 },
              description: { seen: 10, charContribution: 5000, usedCount: 5 },
              permissions: { seen: 10, charContribution: 3000, usedCount: 0 },
              node_id: { seen: 10, charContribution: 100, usedCount: 0 },
              topics: { seen: 8, charContribution: 800, usedCount: 1 },
            },
            totalOriginalChars: 20000,
            totalTrimmedChars: 20000,
          },
        },
      });

      const suggestions = suggestRules(stats, emptyConfig, { minFeedback: 3 });
      expect(suggestions.length).toBe(1);

      const s = suggestions[0];
      const keepKeys = Object.keys(s.keep);
      // id (5), name (4), description (5), topics (1) — all used at least once → kept
      expect(keepKeys).toContain('id');
      expect(keepKeys).toContain('name');
      expect(keepKeys).toContain('description');
      expect(keepKeys).toContain('topics');
      // permissions (0), node_id (0) — never used → dropped
      expect(keepKeys).not.toContain('permissions');
      expect(keepKeys).not.toContain('node_id');
    });
  });

  describe('recordFeedback', () => {
    it('increments feedbackCount and usedCount on matching fields', () => {
      let stats = resetStats();
      const fields = new Map([
        ['id', { count: 1, totalChars: 5 }],
        ['name', { count: 1, totalChars: 20 }],
        ['body', { count: 1, totalChars: 500 }],
      ]);
      stats = recordInvocation(stats, 'test', fields, 1000, 1000);

      stats = recordFeedback(stats, 'test', { id: 1, name: 1 });

      const profile = stats.toolProfiles['test'];
      expect(profile.feedbackCount).toBe(1);
      expect(profile.fields.id.usedCount).toBe(1);
      expect(profile.fields.name.usedCount).toBe(1);
      expect(profile.fields.body.usedCount).toBe(0);
    });

    it('accumulates across multiple feedback calls', () => {
      let stats = resetStats();
      const fields = new Map([
        ['id', { count: 1, totalChars: 5 }],
        ['name', { count: 1, totalChars: 20 }],
      ]);
      stats = recordInvocation(stats, 'test', fields, 100, 100);

      stats = recordFeedback(stats, 'test', { id: 1, name: 1 });
      stats = recordFeedback(stats, 'test', { id: 1 });
      stats = recordFeedback(stats, 'test', { id: 1, name: 1 });

      const profile = stats.toolProfiles['test'];
      expect(profile.feedbackCount).toBe(3);
      expect(profile.fields.id.usedCount).toBe(3);
      expect(profile.fields.name.usedCount).toBe(2);
    });

    it('ignores unknown fields gracefully', () => {
      let stats = resetStats();
      const fields = new Map([['id', { count: 1, totalChars: 5 }]]);
      stats = recordInvocation(stats, 'test', fields, 100, 100);

      stats = recordFeedback(stats, 'test', { id: 1, nonexistent: 1 });

      expect(stats.toolProfiles['test'].fields.id.usedCount).toBe(1);
      expect(stats.toolProfiles['test'].fields['nonexistent']).toBeUndefined();
    });

    it('returns unchanged stats when profile does not exist', () => {
      const stats = resetStats();
      const result = recordFeedback(stats, 'nonexistent', { id: 1 });
      expect(result).toBe(stats);
    });

    it('normalizes array bracket notation in field paths', () => {
      let stats = resetStats();
      const fields = new Map<string, { count: number; totalChars: number }>();
      fields.set('items.login', { count: 1, totalChars: 50 });
      fields.set('items.id', { count: 1, totalChars: 10 });
      stats = recordInvocation(stats, 'test', fields, 200, 200);

      // Agent reports "items[].login" but stats stores "items.login"
      stats = recordFeedback(stats, 'test', { 'items[].login': 1 });

      expect(stats.toolProfiles['test'].fields['items.login'].usedCount).toBe(1);
      expect(stats.toolProfiles['test'].fields['items.id'].usedCount).toBe(0);
    });

    it('increments usedCount by per-field count values', () => {
      let stats = resetStats();
      const fields = new Map<string, { count: number; totalChars: number }>();
      fields.set('id', { count: 1, totalChars: 10 });
      fields.set('name', { count: 1, totalChars: 20 });
      stats = recordInvocation(stats, 'test', fields, 100, 100);

      stats = recordFeedback(stats, 'test', { id: 5, name: 2 });

      const profile = stats.toolProfiles['test'];
      expect(profile.feedbackCount).toBe(1);
      expect(profile.fields.id.usedCount).toBe(5);
      expect(profile.fields.name.usedCount).toBe(2);
    });

    it('increments feedbackCount by the feedbacks parameter', () => {
      let stats = resetStats();
      const fields = new Map<string, { count: number; totalChars: number }>();
      fields.set('id', { count: 1, totalChars: 10 });
      stats = recordInvocation(stats, 'test', fields, 100, 100);

      stats = recordFeedback(stats, 'test', { id: 3 }, 5);

      const profile = stats.toolProfiles['test'];
      expect(profile.feedbackCount).toBe(5);
      expect(profile.fields.id.usedCount).toBe(3);
    });
  });

  describe('rule ID generation', () => {
    it('does not truncate long profile keys', () => {
      const stats = makeStats({
        toolProfiles: {
          'mcp__vscode-mcp-gateway__search_users::api.github.com/search/users': {
            invocations: 10,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-02T00:00:00Z',
            feedbackCount: 3,
            fields: {
              id: { seen: 10, charContribution: 50, usedCount: 3 },
              login: { seen: 10, charContribution: 100, usedCount: 0 },
            },
            totalOriginalChars: 5000,
            totalTrimmedChars: 5000,
          },
        },
      });

      const suggestions = suggestRules(stats, emptyConfig);
      expect(suggestions).toHaveLength(1);
      // Full profile key should be preserved in the ID
      expect(suggestions[0].id).toContain('search-users');
      expect(suggestions[0].id).toContain('api-github-com');
    });
  });

  describe('savings calculation', () => {
    it('does not exceed 99% even with nested field double-counting data', () => {
      const stats = makeStats({
        toolProfiles: {
          'test::api': {
            invocations: 5,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-02T00:00:00Z',
            feedbackCount: 3,
            fields: {
              // parent includes children char sizes
              owner: { seen: 5, charContribution: 5000, usedCount: 0 },
              'owner.login': { seen: 5, charContribution: 500, usedCount: 0 },
              'owner.avatar_url': { seen: 5, charContribution: 3000, usedCount: 0 },
              id: { seen: 5, charContribution: 25, usedCount: 3 },
            },
            totalOriginalChars: 5500,
            totalTrimmedChars: 5500,
          },
        },
      });

      const suggestions = suggestRules(stats, emptyConfig);
      expect(suggestions).toHaveLength(1);
      // Must not exceed 99%
      expect(suggestions[0].estimatedSavingsPercent).toBeLessThanOrEqual(99);
      expect(suggestions[0].estimatedSavingsPercent).toBeGreaterThan(0);
    });

    it('deduplicates hierarchical drops (parent already includes children)', () => {
      const stats = makeStats({
        toolProfiles: {
          'test::nested': {
            invocations: 10,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-02T00:00:00Z',
            feedbackCount: 5,
            fields: {
              id: { seen: 10, charContribution: 100, usedCount: 5 },
              // parent "data" (5000) includes children data.x (2000) + data.y (2500)
              data: { seen: 10, charContribution: 5000, usedCount: 0 },
              'data.x': { seen: 10, charContribution: 2000, usedCount: 0 },
              'data.y': { seen: 10, charContribution: 2500, usedCount: 0 },
            },
            totalOriginalChars: 10000,
            totalTrimmedChars: 10000,
          },
        },
      });

      const suggestions = suggestRules(stats, emptyConfig);
      expect(suggestions).toHaveLength(1);
      // Only "data" should be counted (5000), not data + data.x + data.y (9500)
      // 5000/10 = 500 per invocation, 10000/10 = 1000 avg original → 50%
      expect(suggestions[0].estimatedSavingsChars).toBe(500);
      expect(suggestions[0].estimatedSavingsPercent).toBe(50);
    });
  });

  describe('suggestionToRule', () => {
    it('converts suggestion to a valid TrimRule', () => {
      const suggestion = {
        id: 'auto-bash-github',
        toolName: 'Bash',
        invocations: 10,
        keep: { id: true, name: true, owner: { login: true } } as const,
        match: { toolName: 'Bash' },
        estimatedSavingsChars: 500,
        estimatedSavingsPercent: 60,
        confidence: 1,
      };

      const rule = suggestionToRule(suggestion);
      expect(rule.id).toBe('auto-bash-github');
      expect(rule.keep).toEqual({ id: true, name: true, owner: { login: true } });
      expect(rule.enabled).toBe(true);
      expect(rule.description).toContain('60%');
    });

    it('omits keep when empty', () => {
      const suggestion = {
        id: 'test',
        toolName: 'test',
        invocations: 5,
        keep: {},
        match: { toolName: 'test' },
        estimatedSavingsChars: 100,
        estimatedSavingsPercent: 50,
        confidence: 0.5,
      };

      const rule = suggestionToRule(suggestion);
      expect(rule.keep).toBeUndefined();
    });
  });
});
