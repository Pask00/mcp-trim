/**
 * Install/uninstall logic for the mcp-trim hook in Claude Code.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { withFileLock } from '../core/file-lock.js';

const HOOK_COMMAND = 'npx mcp-trim hook';
const SESSION_START_COMMAND = 'npx mcp-trim session-start';
const MCP_MATCHER = 'mcp__.*';
const SESSION_START_MATCHER = 'startup|resume|clear|compact';
const POST_EVENT_KEY = 'PostToolUse';
const SESSION_START_EVENT_KEY = 'SessionStart';
const SKILL_NAME = 'field-usage-feedback';
const SKILL_FILENAME = 'SKILL.md';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

interface AgentSettings {
  hooks?: {
    [key: string]: HookEntry[] | unknown;
  };
  [key: string]: unknown;
}

export interface InstallOptions {
  global?: boolean;
}

export function installHook(options: InstallOptions = {}): void {
  const settingsDir = options.global
    ? join(homedir(), '.claude')
    : join(process.cwd(), '.claude');
  const settingsPath = join(settingsDir, 'settings.json');

  const installed = withFileLock(settingsPath, () => {
    if (!existsSync(settingsDir)) {
      mkdirSync(settingsDir, { recursive: true });
    }

    let settings: AgentSettings = {};
    if (existsSync(settingsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          console.error(`  Error: ${settingsPath} is not a JSON object. Aborting to avoid data loss.`);
          return false;
        }
        settings = parsed;
      } catch {
        console.error(`  Error: Could not parse ${settingsPath}. Aborting to avoid data loss.`);
        return false;
      }
    }

    if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
      settings.hooks = {};
    }

    let anyInstalled = false;

    // Install SessionStart hook
    anyInstalled = installSingleHook(settings, SESSION_START_EVENT_KEY, SESSION_START_COMMAND, SESSION_START_MATCHER) || anyInstalled;

    // Install PostToolUse hook
    anyInstalled = installSingleHook(settings, POST_EVENT_KEY, HOOK_COMMAND, MCP_MATCHER) || anyInstalled;

    if (!anyInstalled) {
      console.log(`✓ Already installed in ${settingsPath}`);
      return false;
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    console.log(`✓ Installed hooks in ${settingsPath}`);
    return true;
  });

  // Install skill (always attempt, even if hooks were already present)
  installSkill(settingsDir);

  if (installed) {
    console.log(`\nNext steps:`);
    console.log(`  1. Create rules: mcp-trim init`);
    console.log(`  2. Add your rules: mcp-trim set <id> --tool <pattern> --keep <fields>`);
  }
}

function installSingleHook(
  settings: AgentSettings,
  eventKey: string,
  command: string,
  matcher: string,
): boolean {
  const existing = settings.hooks![eventKey];
  if (!Array.isArray(existing)) {
    settings.hooks![eventKey] = [];
  }

  const hookEntries = settings.hooks![eventKey] as HookEntry[];

  const alreadyInstalled = hookEntries.some((entry) =>
    entry.hooks?.some((h) => h.command === command),
  );

  if (alreadyInstalled) return false;

  hookEntries.push({
    matcher,
    hooks: [{ type: 'command', command }],
  });

  return true;
}

export function uninstallHook(options: InstallOptions = {}): void {
  const settingsDir = options.global
    ? join(homedir(), '.claude')
    : join(process.cwd(), '.claude');
  const settingsPath = join(settingsDir, 'settings.json');

  // Remove skill
  uninstallSkill(settingsDir);

  if (!existsSync(settingsPath)) {
    console.log(`  No settings file found at ${settingsPath}. Nothing to uninstall.`);
    return;
  }

  withFileLock(settingsPath, () => {
    let settings: AgentSettings;
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      console.error(`  Could not parse ${settingsPath}`);
      return;
    }

    const eventKeys = [SESSION_START_EVENT_KEY, POST_EVENT_KEY];
    const commands = [SESSION_START_COMMAND, HOOK_COMMAND];

    let removed = false;

    for (let i = 0; i < eventKeys.length; i++) {
      const eventKey = eventKeys[i];
      const command = commands[i];

      if (!settings.hooks?.[eventKey]) continue;

      const hookEntries = settings.hooks[eventKey] as HookEntry[];
      const filtered = hookEntries.filter(
        (entry) => !entry.hooks?.some((h) => h.command === command),
      );

      if (filtered.length !== hookEntries.length) {
        removed = true;
        settings.hooks[eventKey] = filtered;

        if (filtered.length === 0) {
          delete settings.hooks[eventKey];
        }
      }
    }

    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    if (removed) {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      console.log(`✓ Removed hooks from ${settingsPath}`);
    } else {
      console.log(`  No hooks found. Nothing to uninstall.`);
    }
  });
}

/**
 * Resolves the path to the bundled SKILL.md source file.
 * Works from both src/ (dev) and dist/ (published).
 */
export function findSkillSource(): string | null {
  // From dist/cli/install.js → ../../skills/field-usage-feedback/SKILL.md
  // From src/cli/install.ts  → ../../skills/field-usage-feedback/SKILL.md
  const candidate = join(__dirname, '..', '..', 'skills', 'field-usage-feedback', 'SKILL.md');
  return existsSync(candidate) ? candidate : null;
}

function installSkill(settingsDir: string): boolean {
  const sourcePath = findSkillSource();
  if (!sourcePath) {
    console.error(`  Warning: Could not find skill source file. Skill not installed.`);
    return false;
  }

  const skillDir = join(settingsDir, 'skills', SKILL_NAME);
  const destPath = join(skillDir, SKILL_FILENAME);

  if (existsSync(destPath)) {
    const existing = readFileSync(destPath, 'utf-8');
    const source = readFileSync(sourcePath, 'utf-8');
    if (existing === source) {
      return false;
    }
  }

  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true });
  }

  copyFileSync(sourcePath, destPath);
  console.log(`✓ Installed skill in ${destPath}`);
  return true;
}

function uninstallSkill(settingsDir: string): void {
  const skillDir = join(settingsDir, 'skills', SKILL_NAME);
  const destPath = join(skillDir, SKILL_FILENAME);
  if (!existsSync(destPath)) return;

  try {
    unlinkSync(destPath);
    // Remove the skill directory if empty
    try { rmSync(skillDir, { recursive: false }); } catch {}
    console.log(`✓ Removed skill from ${skillDir}`);
  } catch {
    console.error(`  Warning: Could not remove skill at ${skillDir}`);
  }
}
