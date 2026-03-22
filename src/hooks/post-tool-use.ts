/**
 * Post-tool-use hook logic for Claude Code.
 *
 * Applies to MCP tool responses only. Reads hook input from stdin,
 * applies field-trimming rules, and outputs `updatedMCPToolOutput` to stdout.
 *
 * See: https://code.claude.com/docs/en/hooks#posttooluse
 */

import { loadConfig, findMatchingRules, buildFilterOptions } from '../core/config-manager.js';
import { extractJson, replaceJsonInText } from '../core/json-extractor.js';
import { filterFields } from '../core/field-filter.js';
import { collectFieldPaths } from '../core/field-analyzer.js';
import { recordInvocation } from '../core/stats-tracker.js';
import { suggestRules, suggestionToRule } from '../core/suggestion-engine.js';
import { loadSessionRules, loadSessionStats, saveSessionStats, loadSessionData, saveSessionData, upsertSessionRule, resolveSessionPath } from '../core/session-store.js';
import { logToolCall } from '../core/tool-logger.js';
import { withFileLock } from '../core/file-lock.js';
import { readStdin } from '../core/read-stdin.js';
import type { HookInput, HookOutput, NormalizedHookInput, MCPToolResponse, MCPContentItem } from '../types.js';
import type { ToolCallLogEntry } from '../core/tool-logger.js';

const CLAUDE_POST_TOOL_USE = 'PostToolUse';

export async function runHook(): Promise<void> {
  let rawInput: string;
  try {
    rawInput = await readStdin();
  } catch {
    process.exit(0);
  }

  let rawJson: Record<string, unknown>;
  try {
    rawJson = JSON.parse(rawInput!) as Record<string, unknown>;
  } catch {
    process.exit(0);
  }

  const normalized = normalizeInput(rawJson!);
  if (!normalized) process.exit(0);

  // Load config early so debug flag is available for logging
  const config = loadConfig(normalized.cwd);

  const responseText = normalized.toolResponse;
  if (!responseText) {
    if (config.debug) safeLog(normalized, false, undefined, 0);
    process.exit(0);
  }

  // Extract JSON from the response
  const jsonMatches: Array<{ value: unknown }> =
    normalized.hasStructuredContent && normalized.structuredContent
      ? [{ value: normalized.structuredContent }]
      : extractJson(responseText);

  if (jsonMatches.length === 0) process.exit(0);

  // Find matching rules (global config + session-scoped auto-learned rules)
  const matchingRules = findMatchingRulesWithSession(normalized.toolName, config, normalized.sessionId, normalized.cwd);

  if (matchingRules.length === 0) {
    try { recordStats(normalized, jsonMatches, responseText.length, responseText.length); } catch {}

    if (config.autoLearn?.enabled && normalized.sessionId) {
      try { autoLearnRules(normalized.sessionId, normalized.cwd); } catch {}
    }

    if (config.debug) safeLog(normalized, false, undefined, responseText.length, undefined, responseText);
    process.exit(0);
  }

  // Apply the first matching rule
  const rule = matchingRules[0];
  const options = buildFilterOptions(rule);

  let trimmedResponse: string;
  let updatedMCPOutput: unknown;

  if (normalized.hasStructuredContent && normalized.structuredContent) {
    const filtered = filterFields(normalized.structuredContent, options);
    trimmedResponse = JSON.stringify(filtered);
    updatedMCPOutput = updateMCPContent(
      normalized.mcpResponse!,
      JSON.stringify(filtered),
      filtered as Record<string, unknown>,
    );
  } else {
    trimmedResponse = replaceJsonInText(responseText, (json) => filterFields(json, options));

    if (normalized.contentItems) {
      updatedMCPOutput = replaceContentItemText(normalized.contentItems, trimmedResponse);
    } else if (normalized.responseWrapper) {
      updatedMCPOutput = { ...normalized.responseWrapper, text: trimmedResponse };
    } else {
      updatedMCPOutput = updateMCPContent(normalized.mcpResponse, trimmedResponse);
    }
  }

  // Track stats once with actual trimming results
  try { recordStats(normalized, jsonMatches, responseText.length, trimmedResponse.length, rule.id); } catch {}

  if (config.debug) safeLog(normalized, true, rule.id, responseText.length, trimmedResponse.length, responseText, trimmedResponse);

  process.stdout.write(JSON.stringify(formatOutput(updatedMCPOutput)));
  process.exit(0);
}

// ── Input normalization ─────────────────────────────────────────────────────

/**
 * Normalizes Claude Code PostToolUse hook input to the internal format.
 * Returns null if the input is not a PostToolUse event or not an MCP tool.
 */
export function normalizeInput(raw: Record<string, unknown>): NormalizedHookInput | null {
  const input = raw as unknown as HookInput;
  if (input.hook_event_name !== CLAUDE_POST_TOOL_USE) return null;
  if (!input.tool_name?.startsWith('mcp__')) return null;

  const parsed = parseMCPResponse(input.tool_response);

  return {
    agent: 'claude',
    toolName: input.tool_name,
    toolInput: input.tool_input ?? {},
    toolResponse: parsed.textForProcessing,
    hasStructuredContent: parsed.hasStructuredContent,
    structuredContent: parsed.structuredContent,
    mcpResponse: parsed.mcpResponse,
    contentItems: parsed.contentItems,
    responseWrapper: parsed.responseWrapper,
    cwd: input.cwd,
    sessionId: input.session_id,
    _raw: raw,
  };
}

interface ParsedMCPResponse {
  textForProcessing: string;
  hasStructuredContent: boolean;
  structuredContent?: Record<string, unknown>;
  mcpResponse?: MCPToolResponse;
  contentItems?: MCPContentItem[];
  responseWrapper?: Record<string, unknown>;
}

/**
 * Parses the tool_response into a normalized form.
 *
 * Handles these formats (in priority order):
 * 1. Plain string — treated as raw text
 * 2. Direct array of content items — Claude Code sends [{ type: "text", text: "..." }]
 * 3. MCP object with structuredContent — uses it directly
 * 4. MCP object with content[] — concatenates text items
 * 5. Object with a `text` property — extracts .text
 * 6. Unknown object — stringifies as fallback
 */
function parseMCPResponse(response: unknown): ParsedMCPResponse {
  if (typeof response === 'string') {
    return { textForProcessing: response, hasStructuredContent: false };
  }

  if (response === null || response === undefined) {
    return { textForProcessing: '', hasStructuredContent: false };
  }

  if (Array.isArray(response)) {
    const items = response as MCPContentItem[];
    const text = items
      .filter((item): item is MCPContentItem => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text!)
      .join('\n');
    return { textForProcessing: text, hasStructuredContent: false, contentItems: items };
  }

  if (typeof response === 'object') {
    const mcpResponse = response as MCPToolResponse;

    if (mcpResponse.structuredContent && typeof mcpResponse.structuredContent === 'object') {
      return {
        textForProcessing: JSON.stringify(mcpResponse.structuredContent),
        hasStructuredContent: true,
        structuredContent: mcpResponse.structuredContent,
        mcpResponse,
      };
    }

    if (Array.isArray(mcpResponse.content)) {
      const text = mcpResponse.content
        .filter((item): item is MCPContentItem => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text!)
        .join('\n');
      return { textForProcessing: text, hasStructuredContent: false, mcpResponse };
    }

    const asRecord = response as Record<string, unknown>;
    if (typeof asRecord.text === 'string') {
      return { textForProcessing: asRecord.text, hasStructuredContent: false, responseWrapper: asRecord };
    }
  }

  return { textForProcessing: JSON.stringify(response), hasStructuredContent: false };
}

// ── Output formatting ───────────────────────────────────────────────────────

function formatOutput(updatedMCPOutput: unknown): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedMCPToolOutput: updatedMCPOutput,
    },
  };
}

/**
 * Builds an MCP response with updated text content and optional structuredContent.
 * Returns plain text if no original MCP response existed.
 */
function updateMCPContent(
  originalMCP: MCPToolResponse | undefined,
  newText: string,
  structuredContent?: Record<string, unknown>,
): unknown {
  if (!originalMCP) return newText;

  const updatedContent: MCPContentItem[] = originalMCP.content
    ? originalMCP.content.map((item) => (item.type === 'text' ? { ...item, text: newText } : item))
    : [{ type: 'text', text: newText }];

  return {
    ...originalMCP,
    content: updatedContent,
    ...(structuredContent && { structuredContent }),
  };
}

/**
 * Replaces text in a direct content items array.
 * Merges multiple text items into the first one.
 */
function replaceContentItemText(
  originalItems: MCPContentItem[],
  trimmedText: string,
): MCPContentItem[] {
  let replaced = false;
  return originalItems
    .map((item) => {
      if (item.type !== 'text') return item;
      if (replaced) return null;
      replaced = true;
      return { ...item, text: trimmedText };
    })
    .filter((item): item is MCPContentItem => item !== null);
}

// ── Stats & Logging ─────────────────────────────────────────────────────────

function collectFieldsFromMatches(
  jsonMatches: Array<{ value: unknown }>,
): Map<string, { count: number; totalChars: number }> {
  const fields = new Map<string, { count: number; totalChars: number }>();
  for (const match of jsonMatches) {
    for (const [path, info] of collectFieldPaths(match.value)) {
      const existing = fields.get(path);
      if (existing) {
        existing.count += info.count;
        existing.totalChars += info.totalChars;
      } else {
        fields.set(path, { ...info });
      }
    }
  }
  return fields;
}

function recordStats(
  input: NormalizedHookInput,
  jsonMatches: Array<{ value: unknown }>,
  originalChars: number,
  trimmedChars: number,
  ruleId?: string,
): void {
  if (!input.sessionId) return;

  const fields = collectFieldsFromMatches(jsonMatches);
  const sessionPath = resolveSessionPath(input.sessionId, input.cwd);

  withFileLock(sessionPath, () => {
    const sessionData = loadSessionData(input.sessionId!, input.cwd);
    const updatedStats = recordInvocation(sessionData.stats, input.toolName, fields, originalChars, trimmedChars, ruleId);
    sessionData.stats = updatedStats;
    saveSessionData(sessionData, input.cwd);
  });
}

function safeLog(
  input: NormalizedHookInput,
  ruleMatched: boolean,
  ruleId: string | undefined,
  originalSize: number,
  trimmedSize?: number,
  originalResponse?: string,
  trimmedResponse?: string,
): void {
  try {
    const entry: ToolCallLogEntry = {
      timestamp: new Date().toISOString(),
      agent: input.agent,
      ruleMatched,
      ruleId,
      originalSize,
      trimmedSize,
      originalResponse,
      trimmedResponse,
      cwd: input.cwd,
    };
    logToolCall(entry, input.cwd);
  } catch {
    // Logging should never break the hook
  }
}

/**
 * Merges global config rules with session-scoped auto-learned rules for matching.
 */
function findMatchingRulesWithSession(
  toolName: string,
  config: import('../types.js').TrimConfig,
  sessionId?: string,
  cwd?: string,
): import('../types.js').TrimRule[] {
  // First check global config rules
  const globalMatches = findMatchingRules(toolName, config);
  if (globalMatches.length > 0) return globalMatches;

  // Then check session-scoped auto-learned rules
  if (sessionId) {
    const sessionRules = loadSessionRules(sessionId, cwd);
    if (sessionRules.length > 0) {
      const sessionConfig = { ...config, rules: sessionRules };
      return findMatchingRules(toolName, sessionConfig);
    }
  }

  return [];
}

function autoLearnRules(sessionId: string, cwd: string | undefined): void {
  const sessionPath = resolveSessionPath(sessionId, cwd);

  withFileLock(sessionPath, () => {
    const config = loadConfig(cwd);
    const autoLearn = config.autoLearn;
    if (!autoLearn?.enabled) return;

    const sessionData = loadSessionData(sessionId, cwd);
    const suggestions = suggestRules(sessionData.stats, config, {
      minInvocations: autoLearn.minInvocations ?? 5,
      minFeedback: autoLearn.minFeedback ?? 3,
    });

    // Exclude rules that already exist in global config or this session
    const globalRuleIds = new Set(config.rules.map((r) => r.id));
    const sessionRuleIds = new Set(sessionData.rules.map((r) => r.id));
    const newSuggestions = suggestions.filter(
      (s) => !globalRuleIds.has(s.id) && !sessionRuleIds.has(s.id),
    );

    if (newSuggestions.length === 0) return;

    for (const suggestion of newSuggestions.slice(0, 3)) {
      const rule = suggestionToRule(suggestion);
      const idx = sessionData.rules.findIndex((r) => r.id === rule.id);
      if (idx >= 0) {
        sessionData.rules[idx] = rule;
      } else {
        sessionData.rules.push(rule);
      }
    }

    saveSessionData(sessionData, cwd);
  });
}

// When run directly (e.g. via plugin hooks.json), execute the hook
const isDirectRun = process.argv[1]?.endsWith('post-tool-use.js');
if (isDirectRun) {
  runHook().catch(() => {
    process.exit(1);
  });
}
