/**
 * Logs every tool call that invokes the mcp-trim hook.
 * Appends JSON Lines to .config/mcp-trim/logs.jsonl, co-located with the config file.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveColocatedPath } from './config-manager.js';
import type { AgentType } from '../types.js';

const LOGS_FILENAME = 'logs.jsonl';

/** A single logged tool call entry */
export interface ToolCallLogEntry {
  timestamp: string;
  /** Which hook event produced this log entry */
  hookEvent?: 'SessionStart' | 'PostToolUse';
  /** Session ID from Claude Code */
  sessionId?: string;
  cwd?: string;
  agent?: AgentType;
  ruleMatched?: boolean;
  ruleId?: string;
  originalSize?: number;
  trimmedSize?: number;
  /** The original tool response content (text extracted from tool_response) */
  originalResponse?: string;
  /** The filtered tool response after applying keep rules */
  trimmedResponse?: string;
  /** Whether additionalContext was injected (SessionStart) */
  feedbackRequested?: boolean;
}

/**
 * Resolves the log file path. Co-locates with config.json if found,
 * otherwise defaults to .config/mcp-trim/ in startDir or CWD.
 */
export function findLogsPath(startDir?: string): string {
  return resolveColocatedPath(LOGS_FILENAME, startDir);
}

/**
 * Appends a tool call log entry to the JSONL log file.
 */
export function logToolCall(entry: ToolCallLogEntry, startDir?: string): string {
  const logsPath = findLogsPath(startDir);
  const dir = dirname(logsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  appendFileSync(logsPath, JSON.stringify(entry) + '\n', 'utf-8');
  return logsPath;
}

/**
 * Reads all log entries from the JSONL log file.
 * Skips corrupt lines gracefully. Returns an empty array if no file exists.
 */
export function readToolCallLogs(startDir?: string): ToolCallLogEntry[] {
  const logsPath = findLogsPath(startDir);
  if (!existsSync(logsPath)) return [];

  try {
    const content = readFileSync(logsPath, 'utf-8');
    const entries: ToolCallLogEntry[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as ToolCallLogEntry);
      } catch {
        // Skip corrupt lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Clears the log file by writing an empty file.
 * Returns the path of the cleared file.
 */
export function clearToolCallLogs(startDir?: string): string {
  const logsPath = findLogsPath(startDir);
  const dir = dirname(logsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(logsPath, '', 'utf-8');
  return logsPath;
}
