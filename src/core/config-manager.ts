import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { TrimConfig, TrimRule, FilterOptions, AutoLearnSettings } from '../types.js';
import { withFileLock } from './file-lock.js';

const CONFIG_DIR = join('.config', 'mcp-trim');
const CONFIG_FILENAME = 'config.json';

const DEFAULT_AUTO_LEARN: Required<AutoLearnSettings> = {
  enabled: true, minInvocations: 5, minFeedback: 3,
};

export function getDefaultConfig(): TrimConfig {
  return {
    version: 1,
    rules: [],
    autoLearn: { ...DEFAULT_AUTO_LEARN },
    debug: false,
  };
}

/**
 * Searches for .config/mcp-trim/config.json starting from startDir, walking up to root,
 * then checking the home directory. Returns the first found path, or null.
 */
export function findConfigPath(startDir?: string): string | null {
  const cwd = startDir || process.cwd();
  let dir = resolve(cwd);

  while (true) {
    const candidate = join(dir, CONFIG_DIR, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  // Check home directory
  const homeConfig = join(homedir(), CONFIG_DIR, CONFIG_FILENAME);
  if (existsSync(homeConfig)) return homeConfig;

  return null;
}

/**
 * Loads the config from disk. If no config file found, returns defaults.
 */
export function loadConfig(startDir?: string): TrimConfig {
  const configPath = findConfigPath(startDir);
  if (!configPath) return getDefaultConfig();

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TrimConfig>;
    return normalizeConfig(parsed);
  } catch {
    return getDefaultConfig();
  }
}

/**
 * Writes config to disk WITHOUT acquiring a file lock.
 * Use inside an existing withFileLock callback to avoid nested-lock deadlocks.
 */
export function writeConfigFile(config: TrimConfig, configPath?: string): string {
  const target = configPath || join(process.cwd(), CONFIG_DIR, CONFIG_FILENAME);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return target;
}

/**
 * Saves config to disk. If path is not provided, saves to .config/mcp-trim/config.json in CWD.
 */
export function saveConfig(config: TrimConfig, configPath?: string): string {
  const target = configPath || join(process.cwd(), CONFIG_DIR, CONFIG_FILENAME);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  withFileLock(target, () => {
    writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  });
  return target;
}

/**
 * Ensures a config file exists on disk, creating one with defaults if needed.
 * Returns the resolved config path.
 */
export function ensureConfigExists(startDir?: string): string {
  const existing = findConfigPath(startDir);
  if (existing) return existing;

  const target = join(startDir || process.cwd(), CONFIG_DIR, CONFIG_FILENAME);
  writeConfigFile(getDefaultConfig(), target);
  return target;
}

/**
 * Finds all rules matching a given tool name.
 */
export function findMatchingRules(
  toolName: string,
  config: TrimConfig,
): TrimRule[] {
  return config.rules.filter((rule) => {
    if (rule.enabled === false) return false;
    return matchesRule(toolName, rule);
  });
}

/** Detects regex patterns prone to catastrophic backtracking (ReDoS) */
function hasNestedQuantifiers(pattern: string): boolean {
  return /[+*]\)\s*[+*?{]/.test(pattern) || /\{[^}]+\}\)\s*[+*?{]/.test(pattern);
}

function matchesRule(toolName: string, rule: TrimRule): boolean {
  const { match } = rule;

  if (!match.toolName) return false;

  try {
    if (hasNestedQuantifiers(match.toolName)) throw new Error('unsafe pattern');
    const regex = new RegExp(match.toolName, 'i');
    if (!regex.test(toolName)) return false;
  } catch {
    if (toolName.toLowerCase() !== match.toolName.toLowerCase()) return false;
  }

  return true;
}

/**
 * Builds FilterOptions from a rule.
 */
export function buildFilterOptions(rule: TrimRule): FilterOptions {
  return {
    keep: rule.keep,
  };
}

/**
 * Adds or updates a rule in the config (matched by id).
 */
export function upsertRule(config: TrimConfig, rule: TrimRule): TrimConfig {
  const idx = config.rules.findIndex((r) => r.id === rule.id);
  const newRules = [...config.rules];
  if (idx >= 0) {
    newRules[idx] = rule;
  } else {
    newRules.push(rule);
  }
  return { ...config, rules: newRules };
}

/**
 * Removes a rule by id.
 */
export function removeRule(config: TrimConfig, ruleId: string): TrimConfig {
  return { ...config, rules: config.rules.filter((r) => r.id !== ruleId) };
}

/**
 * Returns the config directory path for a given startDir (or CWD).
 * Used by co-located files (stats, logs) to resolve their paths.
 */
export function findConfigDir(startDir?: string): string {
  const configPath = findConfigPath(startDir);
  if (configPath) return dirname(configPath);
  return join(startDir || process.cwd(), CONFIG_DIR);
}

/**
 * Resolves the effective config file path (for locking).
 * Returns the found config path or the default location.
 */
export function resolveConfigPath(startDir?: string): string {
  return findConfigPath(startDir) || join(startDir || process.cwd(), CONFIG_DIR, CONFIG_FILENAME);
}

/**
 * Resolves a file path co-located with the config directory.
 * Used by stats, logs, and other files that live alongside config.json.
 */
export function resolveColocatedPath(filename: string, startDir?: string): string {
  const configPath = findConfigPath(startDir);
  if (configPath) return join(dirname(configPath), filename);
  return join(findConfigDir(startDir), filename);
}

function normalizeConfig(raw: Partial<TrimConfig>): TrimConfig {
  return {
    version: raw.version ?? 1,
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    autoLearn: { ...DEFAULT_AUTO_LEARN, ...(raw.autoLearn || {}) },
    debug: raw.debug ?? false,
  };
}
