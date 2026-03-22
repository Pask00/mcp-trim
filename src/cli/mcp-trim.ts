#!/usr/bin/env node

/**
 * mcp-trim — unified CLI for managing rules, hooks, and installation.
 *
 * Usage:
 *   mcp-trim list                          # Show all rules
 *   mcp-trim show <id>                     # Show a specific rule
 *   mcp-trim set <id> [options]            # Add/update a rule
 *   mcp-trim remove <id>                   # Remove a rule
 *   mcp-trim test <id> --input <file>      # Dry-run filter on sample data
 *   mcp-trim init                          # Create a default config
 *   mcp-trim reset                         # Reset to default config
 *   mcp-trim stats                         # Show token savings statistics
 *   mcp-trim suggest                       # Show suggested rules based on usage
 *   mcp-trim feedback [options]            # Record which fields the agent used
 *   mcp-trim logs                          # Show logged tool calls
 *   mcp-trim install [--global]            # Install the hook in Claude Code
 *   mcp-trim uninstall [--global]          # Remove the hook from Claude Code
 *   mcp-trim hook                          # Run the post-tool-use hook (stdin→stdout)
 */

import { readFileSync } from 'node:fs';
import {
  loadConfig,
  saveConfig,
  writeConfigFile,
  ensureConfigExists,
  findConfigPath,
  getDefaultConfig,
  upsertRule,
  removeRule,
  buildFilterOptions,
} from '../core/config-manager.js';
import { filterFields } from '../core/field-filter.js';
import { resetStats, recordFeedback } from '../core/stats-tracker.js';
import { loadSessionData, saveSessionData, resolveSessionPath } from '../core/session-store.js';
import { suggestRules, suggestionToRule } from '../core/suggestion-engine.js';
import { readToolCallLogs, clearToolCallLogs, findLogsPath } from '../core/tool-logger.js';
import { parseFieldCounts } from '../core/parse-field-counts.js';
import { installHook, uninstallHook } from './install.js';
import { runHook } from '../hooks/post-tool-use.js';
import { runSessionStartHook } from '../hooks/session-start.js';
import { withFileLock } from '../core/file-lock.js';
import type { TrimRule, KeepShape } from '../types.js';

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log(`mcp-trim — Token-saving response trimmer for Claude Code

Commands:
  list                        Show all rules
  show <id>                   Show a specific rule
  set <id> [options]          Add or update a rule
  remove <id>                 Remove a rule
  test <id> --input <file>    Dry-run filter on sample JSON data
  init                        Create a default config in .config/mcp-trim/
  reset                       Reset config to defaults
  stats --session <id>        Show token savings statistics for a session
  stats --session <id> --reset  Reset statistics for a session
  suggest --session <id>      Show suggested rules from a session's stats
  suggest --session <id> --apply  Auto-apply suggested rules to global config
  feedback [options]          Record which fields the agent actually used
  logs                        Show logged tool calls
  logs --clear                Clear the tool call log
  logs --last <n>             Show only the last n entries
  logs --json                 Output logs as JSON array
  install [--global]          Install hooks in Claude Code
  uninstall [--global]        Remove hooks from Claude Code
  hook                        Run the post-tool-use hook (stdin→stdout, used internally)
  session-start               Run the session-start hook (stdin→stdout, used internally)

Options for 'set':
  --tool <pattern>            Tool name regex (e.g., "mcp__github__get_repository", "mcp__github.*")
  --keep <fields>             Comma-separated field names to keep (e.g., "id,name,owner")
  --keep-json <json>          Full keep shape as JSON (e.g., '{"id":true,"owner":{"login":true}}')
  --description <text>        Human-readable description
  --disable                   Disable this rule
  --enable                    Enable this rule

Options for 'feedback':
  --tool <name>               Tool name (e.g., "mcp__github__get_repository")
  --session <id>              Session ID (required — feedback is session-scoped)
  --used <fields>             Comma-separated field paths with optional per-field counts
                              (e.g., "id:3,name,owner.login:2")
  --used-json <json>          Field paths as JSON array or {field: count} object
  --feedbacks <n>             Number of feedback entries to record (default: 1)
  --batch <json>              Batch multiple feedbacks as JSON array:
                              '[{"tool":"...","used":{"f1":3,"f2":1},"feedbacks":3}, ...]'

Examples:
  mcp-trim set github-repos --tool "mcp__github__get_repository" --keep "id,name,full_name,html_url"
  mcp-trim set github-repos --tool "mcp__github__get_repository" --keep-json '{"id":true,"name":true,"owner":{"login":true}}'
  mcp-trim list
  mcp-trim test github-repos --input sample.json
  mcp-trim install --global
`);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function main(): void {
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case 'list':
      cmdList();
      break;
    case 'show':
      cmdShow(args[1]);
      break;
    case 'set':
      cmdSet(args[1]);
      break;
    case 'remove':
      cmdRemove(args[1]);
      break;
    case 'test':
      cmdTest(args[1]);
      break;
    case 'init':
      cmdInit();
      break;
    case 'reset':
      cmdReset();
      break;
    case 'stats':
      cmdStats();
      break;
    case 'suggest':
      cmdSuggest();
      break;
    case 'feedback':
      cmdFeedback();
      break;
    case 'logs':
      cmdLogs();
      break;
    case 'install':
      installHook({ global: hasFlag('--global') });
      break;
    case 'uninstall':
      uninstallHook({ global: hasFlag('--global') });
      break;
    case 'hook':
      runHook().catch(() => process.exit(1));
      break;
    case 'session-start':
      runSessionStartHook().catch(() => process.exit(1));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function cmdList(): void {
  const config = loadConfig();
  const configPath = findConfigPath();

  if (config.rules.length === 0) {
    console.log('No rules configured.');
    if (configPath) console.log(`Config file: ${configPath}`);
    else console.log('No config file found. Run "mcp-trim init" to create one.');
    return;
  }

  console.log(`Rules (from ${configPath || 'defaults'}):\n`);
  for (const rule of config.rules) {
    const status = rule.enabled === false ? ' [DISABLED]' : '';
    console.log(`  ${rule.id}${status}`);
    if (rule.description) console.log(`    ${rule.description}`);
    if (rule.match.toolName) console.log(`    tool: ${rule.match.toolName}`);
    if (rule.keep) console.log(`    keep: ${formatKeepShape(rule.keep)}`);
    console.log();
  }
}

function cmdShow(id: string | undefined): void {
  if (!id) {
    console.error('Usage: mcp-trim show <rule-id>');
    process.exit(1);
  }

  const config = loadConfig();
  const rule = config.rules.find((r) => r.id === id);

  if (!rule) {
    console.error(`Rule "${id}" not found.`);
    process.exit(1);
  }

  console.log(JSON.stringify(rule, null, 2));
}

function cmdSet(id: string | undefined): void {
  if (!id) {
    console.error('Usage: mcp-trim set <rule-id> [options]');
    process.exit(1);
  }

  // Parse args before acquiring lock (no file I/O needed)
  const toolName = getArg('--tool');
  const keepStr = getArg('--keep');
  const keepJsonStr = getArg('--keep-json');
  const description = getArg('--description');

  let keepJson: unknown | undefined;
  if (keepJsonStr) {
    try {
      keepJson = JSON.parse(keepJsonStr);
    } catch {
      console.error('Invalid JSON for --keep-json');
      process.exit(1);
    }
  }

  const lockTarget = ensureConfigExists();

  withFileLock(lockTarget, () => {
    const config = loadConfig();
    const existing = config.rules.find((r) => r.id === id);

    const rule: TrimRule = existing ? { ...existing } : { id, match: {} };

    if (toolName) rule.match = { ...rule.match, toolName };
    if (description) rule.description = description;

    if (keepJson !== undefined) {
      rule.keep = keepJson as KeepShape;
    } else if (keepStr) {
      const shape: Record<string, true> = {};
      for (const field of keepStr.split(',').map((s) => s.trim())) {
        shape[field] = true;
      }
      rule.keep = { ...(rule.keep || {}), ...shape };
    }

    if (hasFlag('--disable')) rule.enabled = false;
    if (hasFlag('--enable')) rule.enabled = true;

    const updated = upsertRule(config, rule);
    const savedPath = writeConfigFile(updated, lockTarget);

    console.log(`Rule "${id}" ${existing ? 'updated' : 'created'} in ${savedPath}`);
  });
}

function cmdRemove(id: string | undefined): void {
  if (!id) {
    console.error('Usage: mcp-trim remove <rule-id>');
    process.exit(1);
  }

  const lockTarget = ensureConfigExists();

  const found = withFileLock(lockTarget, () => {
    const config = loadConfig();
    if (!config.rules.find((r) => r.id === id)) {
      return false;
    }

    const updated = removeRule(config, id);
    const savedPath = writeConfigFile(updated, lockTarget);
    console.log(`Rule "${id}" removed from ${savedPath}`);
    return true;
  });

  if (!found) {
    console.error(`Rule "${id}" not found.`);
    process.exit(1);
  }
}

function cmdTest(id: string | undefined): void {
  if (!id) {
    console.error('Usage: mcp-trim test <rule-id> --input <file>');
    process.exit(1);
  }

  const inputFile = getArg('--input');
  if (!inputFile) {
    console.error('Missing --input <file> argument');
    process.exit(1);
  }

  const config = loadConfig();
  const rule = config.rules.find((r) => r.id === id);
  if (!rule) {
    console.error(`Rule "${id}" not found.`);
    process.exit(1);
  }

  let inputData: unknown;
  try {
    const raw = readFileSync(inputFile, 'utf-8');
    inputData = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to read/parse ${inputFile}: ${err}`);
    process.exit(1);
  }

  const options = buildFilterOptions(rule);
  const originalStr = JSON.stringify(inputData);
  const filtered = filterFields(inputData, options);
  const filteredStr = JSON.stringify(filtered);

  console.log('--- Filtered output ---');
  console.log(JSON.stringify(filtered, null, 2));
  console.log();
  console.log(`Original: ${originalStr.length} chars`);
  console.log(`Filtered: ${filteredStr.length} chars`);
  console.log(`Savings:  ${originalStr.length - filteredStr.length} chars (${Math.round((1 - filteredStr.length / originalStr.length) * 100)}%)`);
}

function cmdInit(): void {
  const configPath = findConfigPath();
  if (configPath) {
    console.log(`Config already exists at ${configPath}`);
    process.exit(0);
  }

  const config = getDefaultConfig();
  // Add an example rule for an MCP tool
  config.rules.push({
    id: 'example-github-repos',
    description: 'Example: trim GitHub MCP repository responses',
    match: {
      toolName: 'mcp__github__get_repository',
    },
    keep: {
      id: true,
      name: true,
      full_name: true,
      description: true,
      html_url: true,
      language: true,
      stargazers_count: true,
      updated_at: true,
      owner: {
        login: true,
        id: true,
      },
    },
    enabled: false,
  });

  const savedPath = saveConfig(config);
  console.log(`Created ${savedPath} with example rule (disabled by default).`);
  console.log('Edit the file or use "mcp-trim set" to add your own rules.');
}

function cmdReset(): void {
  const configPath = findConfigPath();
  if (!configPath) {
    console.log('No config file found. Nothing to reset.');
    process.exit(0);
  }

  const config = getDefaultConfig();
  saveConfig(config, configPath);
  console.log(`Reset ${configPath} to defaults.`);
}

function cmdStats(): void {
  const sessionId = getArg('--session');
  if (!sessionId) {
    console.error('Error: --session <id> is required. Stats are tracked per session.');
    console.error('  Usage: mcp-trim stats --session <session-id>');
    process.exit(1);
  }

  if (hasFlag('--reset')) {
    const sessionPath = resolveSessionPath(sessionId);
    withFileLock(sessionPath, () => {
      const sessionData = loadSessionData(sessionId);
      sessionData.stats = resetStats();
      saveSessionData(sessionData);
    });
    console.log(`✓ Statistics reset for session "${sessionId}".`);
    return;
  }

  const { stats } = loadSessionData(sessionId);
  const { sessionStats, toolProfiles } = stats;

  if (sessionStats.totalInvocations === 0) {
    console.log(`No statistics recorded for session "${sessionId}".`);
    return;
  }

  console.log(`Token Savings Statistics (session: ${sessionId})\n`);
  console.log(`  Total invocations:     ${sessionStats.totalInvocations}`);
  console.log(`  Total original chars:  ${sessionStats.totalOriginalChars.toLocaleString()}`);
  console.log(`  Total trimmed chars:   ${sessionStats.totalTrimmedChars.toLocaleString()}`);
  console.log(`  Total saved chars:     ${sessionStats.totalSavedChars.toLocaleString()}`);
  console.log(`  Est. tokens saved:     ~${sessionStats.estimatedTokensSaved.toLocaleString()}`);

  const overallPercent = sessionStats.totalOriginalChars > 0
    ? Math.round((sessionStats.totalSavedChars / sessionStats.totalOriginalChars) * 100)
    : 0;
  console.log(`  Overall savings:       ${overallPercent}%`);

  const profileEntries = Object.entries(toolProfiles);
  if (profileEntries.length > 0) {
    console.log(`\nPer-Tool Profiles:\n`);
    profileEntries.sort((a, b) => {
      const aSaved = a[1].totalOriginalChars - a[1].totalTrimmedChars;
      const bSaved = b[1].totalOriginalChars - b[1].totalTrimmedChars;
      return bSaved - aSaved;
    });

    for (const [key, profile] of profileEntries) {
      const saved = profile.totalOriginalChars - profile.totalTrimmedChars;
      const pct = profile.totalOriginalChars > 0
        ? Math.round((saved / profile.totalOriginalChars) * 100)
        : 0;
      console.log(`  ${key}`);
      console.log(`    Invocations: ${profile.invocations} | Saved: ${saved.toLocaleString()} chars (${pct}%)${profile.ruleId ? ` | Rule: ${profile.ruleId}` : ''}`);
      console.log(`    Feedback: ${profile.feedbackCount ?? 0} | Fields tracked: ${Object.keys(profile.fields).length}`);
    }
  }
}

function cmdSuggest(): void {
  const sessionId = getArg('--session');
  if (!sessionId) {
    console.error('Error: --session <id> is required. Stats are tracked per session.');
    console.error('  Usage: mcp-trim suggest --session <session-id> [--apply]');
    process.exit(1);
  }

  const config = loadConfig();
  const sessionData = loadSessionData(sessionId);
  const stats = sessionData.stats;

  if (stats.sessionStats.totalInvocations === 0) {
    console.log(`No usage data collected for session "${sessionId}".`);
    return;
  }

  const suggestions = suggestRules(stats, config);

  if (suggestions.length === 0) {
    console.log('No rule suggestions at this time.');
    console.log('Need more invocations or feedback data.');
    return;
  }

  console.log(`Suggested Rules (${suggestions.length}) from session ${sessionId}:\n`);

  for (const s of suggestions) {
    console.log(`  ${s.id}`);
    console.log(`    Based on: ${s.toolName} (${s.invocations} invocations)`);
    console.log(`    Confidence: ${Math.round(s.confidence * 100)}%`);
    console.log(`    Est. savings: ~${s.estimatedSavingsPercent}% (~${s.estimatedSavingsChars} chars/call)`);
    console.log(`    Keep: ${formatKeepShape(s.keep)}`);
    if (s.match.toolName) console.log(`    Match tool: ${s.match.toolName}`);
    console.log();
  }

  if (hasFlag('--apply')) {
    const lockTarget = ensureConfigExists();

    withFileLock(lockTarget, () => {
      let updatedConfig = loadConfig();
      for (const s of suggestions) {
        const rule = suggestionToRule(s);
        updatedConfig = upsertRule(updatedConfig, rule);
      }
      const savedPath = writeConfigFile(updatedConfig, lockTarget);
      console.log(`✓ Applied ${suggestions.length} suggested rule(s) to ${savedPath}`);
    });
  } else {
    console.log('Run with --apply to add these rules to your config.');
  }
}

interface FeedbackEntry {
  tool: string;
  used: Record<string, number>;
  feedbacks: number;
}

function parsePositiveIntFlag(flag: string): number {
  const raw = getArg(flag);
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) {
    console.error(`Error: ${flag} must be a positive integer.`);
    process.exit(1);
  }
  return n;
}

/**
 * Normalizes the "used" value from a batch entry.
 * Accepts either an array of strings (count=1 each) or a {field: count} object.
 */
function parseBatchUsed(value: unknown, idx: number): Record<string, number> {
  if (Array.isArray(value)) {
    if (!value.every((f: unknown) => typeof f === 'string')) {
      throw new Error(`entry ${idx}: "used" array must contain only strings`);
    }
    const result: Record<string, number> = {};
    for (const f of value as string[]) result[f] = 1;
    return result;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [field, count] of Object.entries(obj)) {
      if (typeof count !== 'number' || count < 1) {
        throw new Error(`entry ${idx}: "used" object values must be positive numbers`);
      }
      result[field] = count;
    }
    return result;
  }
  throw new Error(`entry ${idx}: "used" must be an array of strings or an object of {field: count}`);
}

function parseBatchPositiveInt(value: unknown, name: string, idx: number): number {
  if (value === undefined || value === null) return 1;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  throw new Error(`entry ${idx}: "${name}" must be a positive integer`);
}

function cmdFeedback(): void {
  const sessionId = getArg('--session');
  if (!sessionId) {
    console.error('Error: --session is required for feedback.');
    process.exit(1);
  }

  const batchJsonStr = getArg('--batch');
  let entries: FeedbackEntry[];

  if (batchJsonStr) {
    // Batch mode: --batch '[{"tool":"...","used":["f1"]}, ...]' or '{"tool":"...","used":{"f1":3}}'
    try {
      const parsed = JSON.parse(batchJsonStr);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      entries = parsed.map((item: unknown, i: number) => {
        const obj = item as Record<string, unknown>;
        if (typeof obj.tool !== 'string' || !obj.tool) {
          throw new Error(`entry ${i}: "tool" must be a non-empty string`);
        }
        return { tool: obj.tool, used: parseBatchUsed(obj.used, i), feedbacks: parseBatchPositiveInt(obj.feedbacks, 'feedbacks', i) };
      });
      if (entries.length === 0) {
        console.error('Error: --batch array must not be empty.');
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: --batch must be a valid JSON array of {tool, used} objects. ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    // Single mode: --tool + --used / --used-json
    const toolName = getArg('--tool');
    if (!toolName) {
      console.error('Error: --tool is required for feedback (or use --batch for multiple).');
      process.exit(1);
    }

    const usedCsv = getArg('--used');
    const usedJsonStr = getArg('--used-json');

    if (!usedCsv && !usedJsonStr) {
      console.error('Error: --used or --used-json is required.');
      process.exit(1);
    }

    let usedFields: Record<string, number>;
    if (usedJsonStr) {
      try {
        const parsed = JSON.parse(usedJsonStr);
        if (Array.isArray(parsed)) {
          if (!parsed.every((f: unknown) => typeof f === 'string')) throw new Error('not strings');
          usedFields = {};
          for (const f of parsed as string[]) usedFields[f] = 1;
        } else if (parsed !== null && typeof parsed === 'object') {
          usedFields = {};
          for (const [field, count] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof count !== 'number' || count < 1) throw new Error('values must be positive numbers');
            usedFields[field] = count;
          }
        } else {
          throw new Error('not an array or object');
        }
      } catch {
        console.error('Error: --used-json must be a JSON array of strings or an object of {field: count}.');
        process.exit(1);
      }
    } else {
      usedFields = parseFieldCounts(usedCsv!);
    }

    entries = [{ tool: toolName, used: usedFields, feedbacks: parsePositiveIntFlag('--feedbacks') }];
  }

  const sessionPath = resolveSessionPath(sessionId);

  const results = withFileLock(sessionPath, () => {
    const sessionData = loadSessionData(sessionId);
    const profiles = sessionData.stats.toolProfiles;
    const output: Array<{ tool: string; found: boolean; feedbackCount: number; used: Record<string, number> }> = [];

    let stats = sessionData.stats;

    for (const entry of entries) {
      const profile = profiles[entry.tool];

      if (!profile) {
        output.push({ tool: entry.tool, found: false, feedbackCount: 0, used: entry.used });
        continue;
      }

      stats = recordFeedback(stats, entry.tool, entry.used, entry.feedbacks);
      output.push({
        tool: entry.tool,
        found: true,
        feedbackCount: stats.toolProfiles[entry.tool].feedbackCount,
        used: entry.used,
      });
    }

    sessionData.stats = stats;
    saveSessionData(sessionData);
    return output;
  });

  for (const r of results) {
    if (!r.found) {
      console.error(`⚠ No stats profile found for "${r.tool}" — skipped.`);
    } else {
      const fieldNames = Object.keys(r.used);
      const fieldSummary = fieldNames.map((f) => r.used[f] > 1 ? `${f}:${r.used[f]}` : f).join(', ');
      console.log(`✓ Feedback recorded for "${r.tool}" (session: ${sessionId})`);
      console.log(`  Feedback entries: ${r.feedbackCount}`);
      console.log(`  Fields marked used: ${fieldNames.length} (${fieldSummary})`);
    }
  }
}

function cmdLogs(): void {
  if (hasFlag('--clear')) {
    const clearedPath = clearToolCallLogs();
    console.log(`✓ Tool call logs cleared: ${clearedPath}`);
    return;
  }

  let entries = readToolCallLogs();
  const logsPath = findLogsPath();

  if (entries.length === 0) {
    console.log('No tool call logs recorded yet.');
    console.log(`Log file: ${logsPath}`);
    return;
  }

  // Limit to last N entries
  const lastN = getArg('--last');
  if (lastN) {
    const n = parseInt(lastN, 10);
    if (!isNaN(n) && n > 0) {
      entries = entries.slice(-n);
    }
  }

  // JSON output mode
  if (hasFlag('--json')) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(`Tool Call Logs (${entries.length} entries from ${logsPath})\n`);

  for (const entry of entries) {
    const time = entry.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z');

    if (entry.hookEvent === 'SessionStart') {
      console.log(`  [${time}] SessionStart session:${entry.sessionId ?? 'unknown'} feedbackRequested:${entry.feedbackRequested ?? false}`);
      continue;
    }

    const origSize = entry.originalSize ?? 0;
    const savedChars = entry.trimmedSize !== undefined ? origSize - entry.trimmedSize : 0;
    const savingsPercent = entry.trimmedSize !== undefined && origSize > 0
      ? Math.round((1 - entry.trimmedSize / origSize) * 100)
      : 0;
    const status = entry.ruleMatched
      ? `✂ rule:${entry.ruleId} saved ${savedChars} chars (${savingsPercent}%)`
      : '→ passthrough';
    console.log(`  [${time}] ${entry.agent ?? 'unknown'} (${origSize} chars) ${status}`);
  }

  // Summary
  const matched = entries.filter((e) => e.ruleMatched).length;
  const totalSaved = entries.reduce((sum, e) => sum + (e.trimmedSize !== undefined ? (e.originalSize ?? 0) - e.trimmedSize : 0), 0);
  console.log(`\n  Total: ${entries.length} calls | ${matched} trimmed | ${totalSaved.toLocaleString()} chars saved`);
}

/**
 * Formats a KeepShape for display in the terminal.
 */
function formatKeepShape(shape: Record<string, unknown>): string {
  const entries = Object.entries(shape);
  if (entries.length === 0) return '{}';

  const parts: string[] = [];
  for (const [key, spec] of entries) {
    if (spec === true) {
      parts.push(`${key}`);
    } else if (typeof spec === 'object' && spec !== null) {
      parts.push(`${key}: { ${formatKeepShape(spec as Record<string, unknown>)} }`);
    }
  }
  return parts.join(', ');
}

main();
