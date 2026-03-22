/**
 * Configuration and type definitions for mcp-trim.
 */

/**
 * A keep spec node. Describes which fields to keep and how.
 *
 * - `true` = always keep (include all nested content as-is)
 * - `{ field: KeepSpec }` = keep and recurse into nested object with sub-specs
 */
export type KeepSpec = true | KeepShape;

/** Object mapping field names to their keep specifications */
export interface KeepShape {
  [field: string]: KeepSpec;
}

/** A single field-trimming rule */
export interface TrimRule {
  /** Unique identifier for this rule */
  id: string;
  /** Human-readable description */
  description?: string;
  /** Matching criteria — when this rule applies */
  match: RuleMatcher;
  /**
   * Fields to keep. A JSON shape describing which fields survive:
   * - `true` → always keep
   * - `{ ... }` → keep and filter children recursively
   */
  keep?: KeepShape;
  /** Whether this rule is currently active */
  enabled?: boolean;
}

/** Criteria for matching a rule against a tool invocation */
export interface RuleMatcher {
  /** Regex pattern matched against the tool name (e.g., "Bash", "mcp__github.*") */
  toolName?: string;
}

/** Auto-learning configuration */
export interface AutoLearnSettings {
  /** Whether auto-learning is enabled (default: true) */
  enabled?: boolean;
  /** Minimum invocations before auto-creating a rule (default: 5) */
  minInvocations?: number;
  /** Minimum feedback entries before suggesting a rule (default: 3) */
  minFeedback?: number;
}

/** Root config file schema */
export interface TrimConfig {
  version: number;
  rules: TrimRule[];
  /** Auto-learning settings */
  autoLearn?: AutoLearnSettings;
  /** Enable debug logging of tool calls to logs.jsonl (default: false) */
  debug?: boolean;
}

/** Result of JSON extraction from mixed text */
export interface JsonMatch {
  /** The parsed JSON value */
  value: unknown;
  /** The raw JSON string */
  raw: string;
  /** Start index in the original text */
  startIndex: number;
  /** End index in the original text */
  endIndex: number;
}

/** Agent type (Claude Code only) */
export type AgentType = 'claude';

/** Hook input as received on stdin from Claude Code PostToolUse */
export interface HookInput {
  session_id: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  /** Tool response — MCP format with content[] and optional structuredContent */
  tool_response: MCPToolResponse | string | unknown;
  tool_use_id?: string;
  cwd?: string;
  permission_mode?: string;
  transcript_path?: string;
}

/** MCP content item (text, image, resource, etc.) */
export interface MCPContentItem {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** MCP tool response format per https://modelcontextprotocol.io/specification/draft/server/tools */
export interface MCPToolResponse {
  /** Array of content items (text, image, audio, resource_link, resource) */
  content?: MCPContentItem[];
  /** Structured JSON output (when tool declares outputSchema) */
  structuredContent?: Record<string, unknown>;
  /** Whether the tool call resulted in an error */
  isError?: boolean;
}

/** Hook output written to stdout for MCP tool responses */
export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse';
    /** Replaces the MCP tool's output with this value */
    updatedMCPToolOutput: unknown;
  };
}

/** Normalized hook input for internal processing */
export interface NormalizedHookInput {
  agent: AgentType;
  toolName: string;
  toolInput: Record<string, unknown>;
  /** The tool response content as a string for matching and extraction */
  toolResponse: string;
  /** Whether the response had MCP structuredContent */
  hasStructuredContent: boolean;
  /** The parsed structured content (if available) */
  structuredContent?: Record<string, unknown>;
  /** The original MCP response object (if it was an MCP response with content wrapper) */
  mcpResponse?: MCPToolResponse;
  /** The original content items when tool_response is a direct array */
  contentItems?: MCPContentItem[];
  /** The original response wrapper when tool_response is { text: "..." } */
  responseWrapper?: Record<string, unknown>;
  cwd?: string;
  /** Session ID from the hook input, used for session-scoped auto-learned rules */
  sessionId?: string;
  /** The original raw input, preserved for pass-through */
  _raw: Record<string, unknown>;
}

/** Effective filter options combining rule + defaults */
export interface FilterOptions {
  keep?: KeepShape;
}
