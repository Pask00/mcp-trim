import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadSessionRules,
  saveSessionRules,
  upsertSessionRule,
  loadSessionStats,
  saveSessionStats,
  loadSessionData,
  saveSessionData,
  resolveSessionPath,
} from '../src/core/session-store.js';
import { recordInvocation, recordFeedback } from '../src/core/stats-tracker.js';
import type { TrimRule } from '../src/types.js';

describe('session-store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp-trim-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, '.config', 'mcp-trim'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'mcp-trim', 'config.json'),
      JSON.stringify({ version: 1, rules: [] }),
    );
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ── Rules ──────────────────────────────────────────────────────────────────

  it('returns empty array when no session file exists', () => {
    const rules = loadSessionRules('nonexistent-session', tmpDir);
    expect(rules).toEqual([]);
  });

  it('saves and loads session rules', () => {
    const rules: TrimRule[] = [
      {
        id: 'auto-test-rule',
        match: { toolName: 'mcp__test__tool' },
        keep: { id: true, name: true },
        enabled: true,
      },
    ];

    saveSessionRules('session-123', rules, tmpDir);
    const loaded = loadSessionRules('session-123', tmpDir);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('auto-test-rule');
    expect(loaded[0].keep).toEqual({ id: true, name: true });
  });

  it('resolves session path under sessions/ directory', () => {
    const path = resolveSessionPath('my-session', tmpDir);
    expect(path).toContain('sessions');
    expect(path).toContain('my-session.json');
  });

  it('upserts a new rule into an empty session', () => {
    const rule: TrimRule = {
      id: 'auto-rule-1',
      match: { toolName: 'mcp__github__get_repo' },
      keep: { id: true },
      enabled: true,
    };

    const result = upsertSessionRule('session-abc', rule, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('auto-rule-1');

    const loaded = loadSessionRules('session-abc', tmpDir);
    expect(loaded).toHaveLength(1);
  });

  it('upserts an existing rule by id', () => {
    const rule1: TrimRule = {
      id: 'auto-rule-1',
      match: { toolName: 'mcp__github__get_repo' },
      keep: { id: true },
      enabled: true,
    };

    upsertSessionRule('session-abc', rule1, tmpDir);

    const rule2: TrimRule = {
      ...rule1,
      keep: { id: true, name: true, full_name: true },
    };

    const result = upsertSessionRule('session-abc', rule2, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].keep).toEqual({ id: true, name: true, full_name: true });
  });

  it('keeps separate rules per session', () => {
    upsertSessionRule('session-A', {
      id: 'rule-a',
      match: { toolName: 'mcp__a' },
      enabled: true,
    }, tmpDir);

    upsertSessionRule('session-B', {
      id: 'rule-b',
      match: { toolName: 'mcp__b' },
      enabled: true,
    }, tmpDir);

    const rulesA = loadSessionRules('session-A', tmpDir);
    const rulesB = loadSessionRules('session-B', tmpDir);

    expect(rulesA).toHaveLength(1);
    expect(rulesA[0].id).toBe('rule-a');

    expect(rulesB).toHaveLength(1);
    expect(rulesB[0].id).toBe('rule-b');
  });

  it('preserves createdAt on updates', () => {
    saveSessionRules('session-ts', [{ id: 'r1', match: { toolName: 't' }, enabled: true }], tmpDir);

    const path = resolveSessionPath('session-ts', tmpDir);
    const first = JSON.parse(readFileSync(path, 'utf-8'));
    const createdAt = first.createdAt;

    // Update with new rule
    upsertSessionRule('session-ts', { id: 'r2', match: { toolName: 't2' }, enabled: true }, tmpDir);

    const second = JSON.parse(readFileSync(path, 'utf-8'));
    expect(second.createdAt).toBe(createdAt);
    expect(second.rules).toHaveLength(2);
  });

  it('handles corrupt session file gracefully', () => {
    const sessionsDir = join(tmpDir, '.config', 'mcp-trim', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'bad-session.json'), 'not valid json!!!');

    const rules = loadSessionRules('bad-session', tmpDir);
    expect(rules).toEqual([]);
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  it('returns default stats for a new session', () => {
    const stats = loadSessionStats('new-session', tmpDir);
    expect(stats.version).toBe(1);
    expect(stats.sessionStats.totalInvocations).toBe(0);
    expect(Object.keys(stats.toolProfiles)).toHaveLength(0);
  });

  it('saves and loads session stats', () => {
    const stats = loadSessionStats('stats-session', tmpDir);
    const fields = new Map([['id', { count: 1, totalChars: 10 }]]);
    const updated = recordInvocation(stats, 'mcp__test', fields, 100, 50);

    saveSessionStats('stats-session', updated, tmpDir);

    const loaded = loadSessionStats('stats-session', tmpDir);
    expect(loaded.sessionStats.totalInvocations).toBe(1);
    expect(loaded.toolProfiles['mcp__test']).toBeDefined();
    expect(loaded.toolProfiles['mcp__test'].invocations).toBe(1);
  });

  it('keeps stats separate per session', () => {
    const statsA = loadSessionStats('session-A', tmpDir);
    const fieldsA = new Map([['id', { count: 1, totalChars: 10 }]]);
    saveSessionStats('session-A', recordInvocation(statsA, 'mcp__tool', fieldsA, 100, 50), tmpDir);

    const statsB = loadSessionStats('session-B', tmpDir);
    expect(statsB.sessionStats.totalInvocations).toBe(0);

    const loadedA = loadSessionStats('session-A', tmpDir);
    expect(loadedA.sessionStats.totalInvocations).toBe(1);
  });

  it('preserves rules when saving stats', () => {
    upsertSessionRule('mixed-session', {
      id: 'rule-1',
      match: { toolName: 'mcp__x' },
      enabled: true,
    }, tmpDir);

    const stats = loadSessionStats('mixed-session', tmpDir);
    const fields = new Map([['name', { count: 1, totalChars: 20 }]]);
    saveSessionStats('mixed-session', recordInvocation(stats, 'mcp__x', fields, 200, 100), tmpDir);

    // Rules should still be there
    const rules = loadSessionRules('mixed-session', tmpDir);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('rule-1');

    // Stats should also be there
    const loadedStats = loadSessionStats('mixed-session', tmpDir);
    expect(loadedStats.sessionStats.totalInvocations).toBe(1);
  });

  it('preserves stats when saving rules', () => {
    const stats = loadSessionStats('mixed-session-2', tmpDir);
    const fields = new Map([['id', { count: 1, totalChars: 5 }]]);
    saveSessionStats('mixed-session-2', recordInvocation(stats, 'mcp__y', fields, 50, 30), tmpDir);

    upsertSessionRule('mixed-session-2', {
      id: 'rule-2',
      match: { toolName: 'mcp__y' },
      enabled: true,
    }, tmpDir);

    const loadedStats = loadSessionStats('mixed-session-2', tmpDir);
    expect(loadedStats.sessionStats.totalInvocations).toBe(1);

    const rules = loadSessionRules('mixed-session-2', tmpDir);
    expect(rules).toHaveLength(1);
  });

  it('records feedback into session stats', () => {
    const stats = loadSessionStats('feedback-session', tmpDir);
    const fields = new Map([
      ['id', { count: 1, totalChars: 5 }],
      ['name', { count: 1, totalChars: 20 }],
      ['extra', { count: 1, totalChars: 100 }],
    ]);
    const withInvocation = recordInvocation(stats, 'mcp__tool', fields, 125, 125);
    saveSessionStats('feedback-session', withInvocation, tmpDir);

    const current = loadSessionStats('feedback-session', tmpDir);
    const withFeedback = recordFeedback(current, 'mcp__tool', { id: 1, name: 1 });
    saveSessionStats('feedback-session', withFeedback, tmpDir);

    const loaded = loadSessionStats('feedback-session', tmpDir);
    const profile = loaded.toolProfiles['mcp__tool'];
    expect(profile.feedbackCount).toBe(1);
    expect(profile.fields['id'].usedCount).toBe(1);
    expect(profile.fields['name'].usedCount).toBe(1);
    expect(profile.fields['extra'].usedCount).toBe(0);
  });
});
