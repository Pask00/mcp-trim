/**
 * mcp-trim
 *
 * Token-saving response trimmer for Claude Code.
 * Intercepts tool/API responses and trims to only the fields the agent needs.
 */

export { filterFields } from './core/field-filter.js';
export { extractJson, replaceJsonInText } from './core/json-extractor.js';
export {
  loadConfig,
  saveConfig,
  findConfigPath,
  findConfigDir,
  getDefaultConfig,
  findMatchingRules,
  buildFilterOptions,
  upsertRule,
  removeRule,
} from './core/config-manager.js';
export {
  collectFieldPaths,
  totalJsonSize,
  topLevelFields,
  groupNestedFields,
} from './core/field-analyzer.js';
export {
  resetStats,
  recordInvocation,
  recordFeedback,
} from './core/stats-tracker.js';
export {
  suggestRules,
  suggestionToRule,
} from './core/suggestion-engine.js';
export {
  logToolCall,
  readToolCallLogs,
  clearToolCallLogs,
  findLogsPath,
} from './core/tool-logger.js';
export {
  loadSessionRules,
  saveSessionRules,
  upsertSessionRule,
  loadSessionStats,
  saveSessionStats,
  loadSessionData,
  saveSessionData,
  resolveSessionPath,
} from './core/session-store.js';
export {
  normalizeInput,
} from './hooks/post-tool-use.js';
export {
  runSessionStartHook,
} from './hooks/session-start.js';
export {
  readStdin,
} from './core/read-stdin.js';
export {
  parseFieldCounts,
} from './core/parse-field-counts.js';
export type { SessionStartHookOutput } from './hooks/session-start.js';
export type {
  TrimConfig,
  TrimRule,
  AutoLearnSettings,
  RuleMatcher,
  FilterOptions,
  KeepSpec,
  KeepShape,
  JsonMatch,
  HookInput,
  HookOutput,
  MCPToolResponse,
  MCPContentItem,
  AgentType,
  NormalizedHookInput,
} from './types.js';
export type { FieldInfo } from './core/field-analyzer.js';
export type { StatsData, ToolProfile, SessionStats, FieldStat } from './core/stats-tracker.js';
export type { SuggestedRule, SuggestionOptions } from './core/suggestion-engine.js';
export type { ToolCallLogEntry } from './core/tool-logger.js';
export type { SessionData } from './core/session-store.js';

