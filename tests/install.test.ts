import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installHook, uninstallHook, findSkillSource } from '../src/cli/install.js';

describe('install / uninstall hooks', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp-trim-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  function readSettings(): Record<string, unknown> {
    const settingsPath = join(tmpDir, '.claude', 'settings.json');
    return JSON.parse(readFileSync(settingsPath, 'utf-8'));
  }

  describe('installHook', () => {
    it('creates settings file with both hooks when none exists', () => {
      installHook();

      const settingsPath = join(tmpDir, '.claude', 'settings.json');
      expect(existsSync(settingsPath)).toBe(true);

      const settings = readSettings();
      expect(settings.hooks).toBeDefined();

      const hooks = settings.hooks as Record<string, unknown[]>;
      expect(hooks.PostToolUse).toHaveLength(1);
      expect(hooks.SessionStart).toHaveLength(1);

      const postHook = hooks.PostToolUse[0] as Record<string, unknown>;
      expect(postHook.matcher).toBe('mcp__.*');
      expect((postHook.hooks as Array<{ command: string }>)[0].command).toBe('npx mcp-trim hook');

      const sessionHook = hooks.SessionStart[0] as Record<string, unknown>;
      expect(sessionHook.matcher).toBe('startup|resume|clear|compact');
      expect((sessionHook.hooks as Array<{ command: string }>)[0].command).toBe('npx mcp-trim session-start');
    });

    it('does not duplicate hooks on second install', () => {
      installHook();
      installHook();

      const hooks = readSettings().hooks as Record<string, unknown[]>;
      expect(hooks.PostToolUse).toHaveLength(1);
      expect(hooks.SessionStart).toHaveLength(1);
    });

    it('preserves existing settings and hooks', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(
        join(settingsDir, 'settings.json'),
        JSON.stringify({
          customSetting: 'keep-me',
          hooks: {
            PostToolUse: [
              { matcher: 'other-tool', hooks: [{ type: 'command', command: 'echo other' }] },
            ],
          },
        }) + '\n',
        'utf-8',
      );

      installHook();

      const settings = readSettings();
      expect(settings.customSetting).toBe('keep-me');

      const hooks = settings.hooks as Record<string, unknown[]>;
      // Existing hook preserved + new one added
      expect(hooks.PostToolUse).toHaveLength(2);
      expect(hooks.SessionStart).toHaveLength(1);
    });

    it('does not overwrite corrupted settings file', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, 'settings.json');
      writeFileSync(settingsPath, 'not valid json {{{', 'utf-8');

      installHook();

      // File should be untouched
      expect(readFileSync(settingsPath, 'utf-8')).toBe('not valid json {{{');
    });

    it('does not overwrite settings file that is not a JSON object', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, 'settings.json');
      writeFileSync(settingsPath, '"just a string"', 'utf-8');

      installHook();

      expect(readFileSync(settingsPath, 'utf-8')).toBe('"just a string"');
    });

    it('handles non-array hooks[eventKey] without corruption', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(
        join(settingsDir, 'settings.json'),
        JSON.stringify({
          customSetting: 'keep-me',
          hooks: {
            PostToolUse: 'not-an-array',
            CustomHook: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo hi' }] }],
          },
        }) + '\n',
        'utf-8',
      );

      installHook();

      const settings = readSettings();
      expect(settings.customSetting).toBe('keep-me');

      const hooks = settings.hooks as Record<string, unknown>;
      // PostToolUse was invalid, so it was reset to an array with our hook
      expect(Array.isArray(hooks.PostToolUse)).toBe(true);
      expect((hooks.PostToolUse as unknown[]).length).toBe(1);
      // Other hook entries are preserved
      expect(Array.isArray(hooks.CustomHook)).toBe(true);
      expect((hooks.CustomHook as unknown[]).length).toBe(1);
    });

    it('handles non-object hooks value without losing settings', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(
        join(settingsDir, 'settings.json'),
        JSON.stringify({
          customSetting: 'keep-me',
          hooks: 'invalid',
        }) + '\n',
        'utf-8',
      );

      installHook();

      const settings = readSettings();
      expect(settings.customSetting).toBe('keep-me');
      expect(typeof settings.hooks).toBe('object');

      const hooks = settings.hooks as Record<string, unknown[]>;
      expect(hooks.PostToolUse).toHaveLength(1);
      expect(hooks.SessionStart).toHaveLength(1);
    });
  });

  describe('uninstallHook', () => {
    it('removes both hooks', () => {
      installHook();
      uninstallHook();

      const settings = readSettings();
      // hooks key should be removed if empty
      expect(settings.hooks).toBeUndefined();
    });

    it('preserves other hooks when uninstalling', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(
        join(settingsDir, 'settings.json'),
        JSON.stringify({
          hooks: {
            PostToolUse: [
              { matcher: 'other-tool', hooks: [{ type: 'command', command: 'echo other' }] },
              { matcher: 'mcp__.*', hooks: [{ type: 'command', command: 'npx mcp-trim hook' }] },
            ],
            SessionStart: [
              { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: 'npx mcp-trim session-start' }] },
            ],
          },
        }) + '\n',
        'utf-8',
      );

      uninstallHook();

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown[]>;
      expect(hooks.PostToolUse).toHaveLength(1);
      expect((hooks.PostToolUse[0] as Record<string, unknown>).matcher).toBe('other-tool');
      // SessionStart should be deleted entirely since it only had our hook
      expect(hooks.SessionStart).toBeUndefined();
    });

    it('handles missing settings file gracefully', () => {
      // Should not throw
      expect(() => uninstallHook()).not.toThrow();
    });

    it('handles settings with no hooks gracefully', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(join(settingsDir, 'settings.json'), '{}', 'utf-8');

      expect(() => uninstallHook()).not.toThrow();
    });

    it('does not modify corrupted settings file on uninstall', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, 'settings.json');
      writeFileSync(settingsPath, 'corrupted {{{', 'utf-8');

      uninstallHook();

      expect(readFileSync(settingsPath, 'utf-8')).toBe('corrupted {{{');
    });

    it('preserves all other settings keys after uninstall', () => {
      const settingsDir = join(tmpDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(
        join(settingsDir, 'settings.json'),
        JSON.stringify({
          customSetting: 'keep-me',
          anotherKey: [1, 2, 3],
          hooks: {
            PostToolUse: [
              { matcher: 'mcp__.*', hooks: [{ type: 'command', command: 'npx mcp-trim hook' }] },
            ],
            SessionStart: [
              { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: 'npx mcp-trim session-start' }] },
            ],
          },
        }) + '\n',
        'utf-8',
      );

      uninstallHook();

      const settings = readSettings();
      expect(settings.customSetting).toBe('keep-me');
      expect(settings.anotherKey).toEqual([1, 2, 3]);
      expect(settings.hooks).toBeUndefined();
    });
  });

  describe('skill installation', () => {
    it('installs the skill file alongside hooks', () => {
      installHook();

      const skillPath = join(tmpDir, '.claude', 'skills', 'field-usage-feedback', 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);

      const sourcePath = findSkillSource();
      expect(sourcePath).not.toBeNull();
      expect(readFileSync(skillPath, 'utf-8')).toBe(readFileSync(sourcePath!, 'utf-8'));
    });

    it('does not duplicate skill on second install', () => {
      installHook();
      installHook();

      const skillPath = join(tmpDir, '.claude', 'skills', 'field-usage-feedback', 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);
    });

    it('removes skill on uninstall', () => {
      installHook();
      const skillPath = join(tmpDir, '.claude', 'skills', 'field-usage-feedback', 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);

      uninstallHook();
      expect(existsSync(skillPath)).toBe(false);
    });

    it('preserves other skills when uninstalling', () => {
      installHook();

      // Add another skill alongside ours
      const otherSkillDir = join(tmpDir, '.claude', 'skills', 'other-skill');
      mkdirSync(otherSkillDir, { recursive: true });
      writeFileSync(join(otherSkillDir, 'SKILL.md'), '# Other skill', 'utf-8');

      uninstallHook();

      // Our skill removed
      expect(existsSync(join(tmpDir, '.claude', 'skills', 'field-usage-feedback', 'SKILL.md'))).toBe(false);
      // Other skill untouched
      expect(readFileSync(join(otherSkillDir, 'SKILL.md'), 'utf-8')).toBe('# Other skill');
    });
  });
});
