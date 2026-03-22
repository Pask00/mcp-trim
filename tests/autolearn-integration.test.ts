import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { suggestRules, suggestionToRule } from '../src/core/suggestion-engine.js';
import { recordInvocation, recordFeedback, resetStats } from '../src/core/stats-tracker.js';
import {
  loadSessionData,
  saveSessionData,
  upsertSessionRule,
  loadSessionRules,
  loadSessionStats,
  saveSessionStats,
} from '../src/core/session-store.js';
import { loadConfig, saveConfig, getDefaultConfig, upsertRule } from '../src/core/config-manager.js';
import type { TrimConfig, TrimRule } from '../src/types.js';

/**
 * Integration tests for the auto-learn flow:
 * invocations → feedback → suggestion → rule creation → session scoping
 */
describe('auto-learn integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp-trim-autolearn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, '.config', 'mcp-trim'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'mcp-trim', 'config.json'),
      JSON.stringify(getDefaultConfig()),
    );
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('produces rule suggestions after accumulating invocations + feedback', () => {
    const sessionId = 'autolearn-session';
    const toolName = 'mcp__github__get_repository';

    // Simulate 5 invocations with field data
    let stats = resetStats();
    const fields = new Map([
      ['id', { count: 1, totalChars: 10 }],
      ['name', { count: 1, totalChars: 50 }],
      ['description', { count: 1, totalChars: 500 }],
      ['owner', { count: 1, totalChars: 300 }],
      ['owner.login', { count: 1, totalChars: 50 }],
      ['owner.avatar_url', { count: 1, totalChars: 200 }],
      ['topics', { count: 1, totalChars: 100 }],
    ]);

    for (let i = 0; i < 5; i++) {
      stats = recordInvocation(stats, toolName, fields, 1210, 1210);
    }

    // No suggestion yet without feedback
    const config = loadConfig(tmpDir);
    let suggestions = suggestRules(stats, config);
    expect(suggestions).toHaveLength(0);

    // Add feedback — mark id, name, owner.login as used (3 entries to meet minFeedback default)
    stats = recordFeedback(stats, toolName, { id: 1, name: 1, 'owner.login': 1 }, 3);

    // Now suggestion should be generated
    suggestions = suggestRules(stats, config);
    expect(suggestions).toHaveLength(1);

    const s = suggestions[0];
    expect(Object.keys(s.keep)).toContain('id');
    expect(Object.keys(s.keep)).toContain('name');
    expect(Object.keys(s.keep)).toContain('owner');
    // Dropped fields
    expect(Object.keys(s.keep)).not.toContain('description');
    expect(Object.keys(s.keep)).not.toContain('topics');

    // Convert to rule and save to session
    const rule = suggestionToRule(s);
    expect(rule.enabled).toBe(true);
    expect(rule.match.toolName).toBe(toolName);

    upsertSessionRule(sessionId, rule, tmpDir);
    const sessionRules = loadSessionRules(sessionId, tmpDir);
    expect(sessionRules).toHaveLength(1);
    expect(sessionRules[0].id).toBe(rule.id);
  });

  it('session rules are isolated from global config', () => {
    const sessionA = 'session-A';
    const sessionB = 'session-B';

    const rule: TrimRule = {
      id: 'auto-rule',
      match: { toolName: 'mcp__github__get_repository' },
      keep: { id: true, name: true },
      enabled: true,
    };

    upsertSessionRule(sessionA, rule, tmpDir);

    // Session B should have no rules
    expect(loadSessionRules(sessionB, tmpDir)).toHaveLength(0);

    // Global config should have no rules
    const globalConfig = loadConfig(tmpDir);
    expect(globalConfig.rules).toHaveLength(0);

    // Session A should have the rule
    expect(loadSessionRules(sessionA, tmpDir)).toHaveLength(1);
  });

  it('skips suggestion when tool already has active global rule', () => {
    const toolName = 'mcp__github__get_repository';

    // Add a global rule
    let config = loadConfig(tmpDir);
    config = upsertRule(config, {
      id: 'global-github',
      match: { toolName },
      keep: { id: true },
    });
    saveConfig(config, join(tmpDir, '.config', 'mcp-trim', 'config.json'));

    // Build stats with feedback
    let stats = resetStats();
    const fields = new Map([
      ['id', { count: 1, totalChars: 10 }],
      ['name', { count: 1, totalChars: 50 }],
    ]);
    for (let i = 0; i < 10; i++) {
      stats = recordInvocation(stats, toolName, fields, 100, 100, 'global-github');
    }
    stats = recordFeedback(stats, toolName, { id: 1 }, 3);

    // Should NOT suggest — tool already has active rule
    const suggestions = suggestRules(stats, loadConfig(tmpDir));
    expect(suggestions).toHaveLength(0);
  });

  it('full flow: invocations → feedback → suggest → apply to global config', () => {
    const toolName = 'mcp__slack__list_channels';
    const sessionId = 'suggest-apply-session';

    // Simulate invocations
    let stats = resetStats();
    const fields = new Map([
      ['id', { count: 1, totalChars: 20 }],
      ['name', { count: 1, totalChars: 30 }],
      ['purpose', { count: 1, totalChars: 200 }],
      ['topic', { count: 1, totalChars: 150 }],
      ['num_members', { count: 1, totalChars: 5 }],
    ]);
    for (let i = 0; i < 8; i++) {
      stats = recordInvocation(stats, toolName, fields, 405, 405);
    }
    stats = recordFeedback(stats, toolName, { id: 1, name: 1 }, 3);

    // Save session stats
    saveSessionStats(sessionId, stats, tmpDir);

    // Generate suggestions
    const config = loadConfig(tmpDir);
    const suggestions = suggestRules(stats, config);
    expect(suggestions).toHaveLength(1);

    // Apply to global config
    let updatedConfig = loadConfig(tmpDir);
    for (const s of suggestions) {
      updatedConfig = upsertRule(updatedConfig, suggestionToRule(s));
    }
    saveConfig(updatedConfig, join(tmpDir, '.config', 'mcp-trim', 'config.json'));

    // Verify global config now has the rule
    const finalConfig = loadConfig(tmpDir);
    expect(finalConfig.rules).toHaveLength(1);
    expect(finalConfig.rules[0].match.toolName).toBe(toolName);
    expect(finalConfig.rules[0].keep).toBeDefined();
    expect(Object.keys(finalConfig.rules[0].keep!)).toContain('id');
    expect(Object.keys(finalConfig.rules[0].keep!)).toContain('name');
    expect(Object.keys(finalConfig.rules[0].keep!)).not.toContain('purpose');
  });
});
