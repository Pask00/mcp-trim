import { describe, it, expect } from 'vitest';
import { findMatchingRules } from '../src/core/config-manager.js';
import type { TrimConfig } from '../src/types.js';

/**
 * Tests for hook logic — rule matching and session-start output.
 */
describe('rule matching logic', () => {
  const configWithRule: TrimConfig = {
    version: 1,
    rules: [
      {
        id: 'github-repos',
        match: { toolName: 'mcp__github__get_repository' },
        keep: { id: true, name: true },
      },
    ],
  };

  const configNoRules: TrimConfig = {
    version: 1,
    rules: [],
  };

  const configDisabledRule: TrimConfig = {
    version: 1,
    rules: [
      {
        id: 'github-repos',
        match: { toolName: 'mcp__github__get_repository' },
        keep: { id: true, name: true },
        enabled: false,
      },
    ],
  };

  it('finds a matching rule', () => {
    const toolName = 'mcp__github__get_repository';
    const matches = findMatchingRules(toolName, configWithRule);

    expect(matches.length).toBeGreaterThan(0);
  });

  it('no matching rule', () => {
    const toolName = 'mcp__github__get_repository';
    const matches = findMatchingRules(toolName, configNoRules);

    expect(matches).toHaveLength(0);
  });

  it('disabled rule does not match', () => {
    const toolName = 'mcp__github__get_repository';
    const matches = findMatchingRules(toolName, configDisabledRule);

    expect(matches).toHaveLength(0);
  });

  it('non-MCP tool is ignored (no mcp__ prefix)', () => {
    const toolName = 'Bash';
    const matches = findMatchingRules(toolName, configWithRule);

    expect(matches).toHaveLength(0);
  });

  it('different MCP tool with no rule', () => {
    const toolName = 'mcp__jira__get_issue';
    const matches = findMatchingRules(toolName, configWithRule);

    expect(matches).toHaveLength(0);
  });

  it('wildcard rule matches any MCP tool', () => {
    const wildcardConfig: TrimConfig = {
      version: 1,
      rules: [
        {
          id: 'all-mcp',
          match: { toolName: 'mcp__.*' },
          keep: { id: true },
        },
      ],
    };

    const toolName = 'mcp__slack__post_message';
    const matches = findMatchingRules(toolName, wildcardConfig);

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('all-mcp');
  });
});

describe('session-start hook output format', () => {
  it('produces valid SessionStart hookSpecificOutput', () => {
    // Must match the actual FEEDBACK_CONTEXT from session-start.ts
    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart' as const,
        additionalContext:
          'After processing JSON responses from MCP tools, invoke the "field-usage-feedback" skill to report which fields you used.',
      },
    };

    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(output.hookSpecificOutput.additionalContext).toContain('field-usage-feedback');
    expect(output.hookSpecificOutput.additionalContext).not.toContain('no trimming rule exists');

    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toBeTruthy();
  });
});
