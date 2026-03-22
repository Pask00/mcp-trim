/**
 * Per-session storage for auto-learned rules and stats.
 *
 * Auto-learned rules and stats are scoped to the session that generated them.
 * Global config rules apply everywhere; session rules only within their session.
 * Files are stored at .config/mcp-trim/sessions/<session_id>.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { findConfigDir } from './config-manager.js';
import type { TrimRule } from '../types.js';
import type { StatsData } from './stats-tracker.js';

const SESSIONS_DIR = 'sessions';

/** Schema for a session file (rules + stats) */
export interface SessionData {
  sessionId: string;
  rules: TrimRule[];
  stats: StatsData;
  createdAt: string;
  updatedAt: string;
}

function getDefaultSessionStats(): StatsData {
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
  };
}

/**
 * Resolves the file path for a session's data.
 */
export function resolveSessionPath(sessionId: string, startDir?: string): string {
  const configDir = findConfigDir(startDir);
  return join(configDir, SESSIONS_DIR, `${sessionId}.json`);
}

/**
 * Loads the full session data from disk.
 */
export function loadSessionData(sessionId: string, startDir?: string): SessionData {
  const sessionPath = resolveSessionPath(sessionId, startDir);
  const now = new Date().toISOString();

  if (!existsSync(sessionPath)) {
    return { sessionId, rules: [], stats: getDefaultSessionStats(), createdAt: now, updatedAt: now };
  }

  try {
    const raw = readFileSync(sessionPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SessionData>;
    return {
      sessionId: parsed.sessionId ?? sessionId,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      stats: parsed.stats ?? getDefaultSessionStats(),
      createdAt: parsed.createdAt ?? now,
      updatedAt: parsed.updatedAt ?? now,
    };
  } catch {
    return { sessionId, rules: [], stats: getDefaultSessionStats(), createdAt: now, updatedAt: now };
  }
}

/**
 * Saves session data to disk.
 */
export function saveSessionData(data: SessionData, startDir?: string): string {
  const sessionPath = resolveSessionPath(data.sessionId, startDir);
  const dir = dirname(sessionPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  data.updatedAt = new Date().toISOString();
  writeFileSync(sessionPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return sessionPath;
}

/**
 * Loads auto-learned rules for a specific session.
 */
export function loadSessionRules(sessionId: string, startDir?: string): TrimRule[] {
  return loadSessionData(sessionId, startDir).rules;
}

/**
 * Saves auto-learned rules for a specific session (preserves stats).
 */
export function saveSessionRules(
  sessionId: string,
  rules: TrimRule[],
  startDir?: string,
): string {
  const data = loadSessionData(sessionId, startDir);
  data.rules = rules;
  return saveSessionData(data, startDir);
}

/**
 * Adds or updates a single rule in the session store (matched by id).
 */
export function upsertSessionRule(
  sessionId: string,
  rule: TrimRule,
  startDir?: string,
): TrimRule[] {
  const data = loadSessionData(sessionId, startDir);
  const idx = data.rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) {
    data.rules[idx] = rule;
  } else {
    data.rules.push(rule);
  }
  saveSessionData(data, startDir);
  return data.rules;
}

/**
 * Loads stats for a specific session.
 */
export function loadSessionStats(sessionId: string, startDir?: string): StatsData {
  return loadSessionData(sessionId, startDir).stats;
}

/**
 * Saves stats for a specific session (preserves rules).
 */
export function saveSessionStats(
  sessionId: string,
  stats: StatsData,
  startDir?: string,
): string {
  const data = loadSessionData(sessionId, startDir);
  data.stats = stats;
  return saveSessionData(data, startDir);
}
