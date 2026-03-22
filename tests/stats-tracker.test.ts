import { describe, it, expect } from 'vitest';
import {
  resetStats,
  recordInvocation,
} from '../src/core/stats-tracker.js';

describe('stats-tracker', () => {
  describe('recordInvocation', () => {
    it('creates a new profile on first invocation', () => {
      const stats = resetStats();
      const fields = new Map([
        ['id', { count: 1, totalChars: 5 }],
        ['name', { count: 1, totalChars: 20 }],
      ]);

      const updated = recordInvocation(stats, 'Bash::github', fields, 500, 100, 'my-rule');

      expect(updated.toolProfiles['Bash::github']).toBeDefined();
      expect(updated.toolProfiles['Bash::github'].invocations).toBe(1);
      expect(updated.toolProfiles['Bash::github'].totalOriginalChars).toBe(500);
      expect(updated.toolProfiles['Bash::github'].totalTrimmedChars).toBe(100);
      expect(updated.toolProfiles['Bash::github'].ruleId).toBe('my-rule');
      expect(updated.toolProfiles['Bash::github'].fields.id.seen).toBe(1);
    });

    it('accumulates across multiple invocations', () => {
      let stats = resetStats();
      const fields = new Map([['id', { count: 1, totalChars: 5 }]]);

      stats = recordInvocation(stats, 'test', fields, 100, 50);
      stats = recordInvocation(stats, 'test', fields, 200, 80);

      expect(stats.toolProfiles['test'].invocations).toBe(2);
      expect(stats.toolProfiles['test'].totalOriginalChars).toBe(300);
      expect(stats.toolProfiles['test'].totalTrimmedChars).toBe(130);
      expect(stats.toolProfiles['test'].fields.id.seen).toBe(2);
      expect(stats.toolProfiles['test'].fields.id.charContribution).toBe(10);
    });

    it('updates session stats correctly', () => {
      let stats = resetStats();
      const fields = new Map<string, { count: number; totalChars: number }>();

      stats = recordInvocation(stats, 'a', fields, 1000, 200);
      stats = recordInvocation(stats, 'b', fields, 500, 100);

      expect(stats.sessionStats.totalInvocations).toBe(2);
      expect(stats.sessionStats.totalOriginalChars).toBe(1500);
      expect(stats.sessionStats.totalTrimmedChars).toBe(300);
      expect(stats.sessionStats.totalSavedChars).toBe(1200);
      expect(stats.sessionStats.estimatedTokensSaved).toBe(300); // 1200/4
    });
  });

  describe('resetStats', () => {
    it('returns empty stats', () => {
      const stats = resetStats();
      expect(stats.toolProfiles).toEqual({});
      expect(stats.sessionStats.totalInvocations).toBe(0);
    });
  });
});
