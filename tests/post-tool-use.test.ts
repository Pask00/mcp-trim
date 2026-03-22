import { describe, it, expect } from 'vitest';
import { filterFields } from '../src/core/field-filter.js';
import { extractJson, replaceJsonInText } from '../src/core/json-extractor.js';
import { findMatchingRules, buildFilterOptions } from '../src/core/config-manager.js';
import { normalizeInput } from '../src/hooks/post-tool-use.js';
import type { TrimConfig, HookInput, FilterOptions, NormalizedHookInput } from '../src/types.js';

/**
 * End-to-end test simulating the PostToolUse hook pipeline for MCP tools:
 * hook input → rule matching → JSON extraction → field filtering → output
 */
describe('post-tool-use hook (e2e simulation)', () => {
  const config: TrimConfig = {
    version: 1,
    rules: [
      {
        id: 'github-repos',
        match: { toolName: 'mcp__github__get_repository' },
        keep: {
          id: true,
          name: true,
          full_name: true,
          html_url: true,
          owner: { login: true },
        },
      },
      {
        id: 'github-issues',
        match: { toolName: 'mcp__github__list_issues' },
        keep: {
          number: true,
          title: true,
          state: true,
          labels: { name: true },
        },
      },
    ],
  };

  it('trims an MCP GitHub repo response', () => {
    const toolResponse = JSON.stringify({
      id: 123,
      name: 'hello-world',
      full_name: 'octocat/hello-world',
      html_url: 'https://github.com/octocat/hello-world',
      description: 'This is a very long description that we do not need...',
      owner: { login: 'octocat', id: 999, avatar_url: 'https://...', type: 'User' },
      private: false,
      fork: false,
      forks_count: 100,
      stargazers_count: 1000,
      watchers_count: 500,
    });

    const hookInput: HookInput = {
      session_id: 'test-session',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__get_repository',
      tool_input: { owner: 'octocat', repo: 'hello-world' },
      tool_response: toolResponse,
    };

    // Simulate the hook pipeline
    const matchingRules = findMatchingRules(hookInput.tool_name, config);

    expect(matchingRules).toHaveLength(1);
    expect(matchingRules[0].id).toBe('github-repos');

    const rule = matchingRules[0];
    const options = buildFilterOptions(rule);

    const trimmedResponse = replaceJsonInText(toolResponse, (json) => {
      return filterFields(json, options);
    });

    const parsed = JSON.parse(trimmedResponse);
    expect(parsed).toEqual({
      id: 123,
      name: 'hello-world',
      full_name: 'octocat/hello-world',
      html_url: 'https://github.com/octocat/hello-world',
      owner: { login: 'octocat' },
    });

    // Verify removed fields
    expect(parsed.description).toBeUndefined();
    expect(parsed.private).toBeUndefined();
    expect(parsed.forks_count).toBeUndefined();
    expect(parsed.owner.avatar_url).toBeUndefined();
  });

  it('trims an MCP tool response with arrays', () => {
    const issues = [
      { number: 1, title: 'Bug', state: 'open', body: 'Details...', labels: [{ name: 'bug', color: 'red', id: 1 }], assignee: { login: 'dev' } },
      { number: 2, title: 'Feature', state: 'closed', body: 'Info...', labels: [{ name: 'enhancement', color: 'blue', id: 2 }], assignee: null },
    ];

    const toolResponse = JSON.stringify(issues);

    const hookInput: HookInput = {
      session_id: 'test-session',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__list_issues',
      tool_input: { owner: 'octocat', repo: 'hello-world' },
      tool_response: toolResponse,
    };

    const matchingRules = findMatchingRules(hookInput.tool_name, config);

    expect(matchingRules).toHaveLength(1);

    const rule = matchingRules[0];
    const options = buildFilterOptions(rule);

    const trimmedResponse = replaceJsonInText(toolResponse, (json) => {
      return filterFields(json, options);
    });

    const parsed = JSON.parse(trimmedResponse);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ number: 1, title: 'Bug', state: 'open', labels: [{ name: 'bug' }] });
    expect(parsed[1]).toEqual({ number: 2, title: 'Feature', state: 'closed', labels: [{ name: 'enhancement' }] });

    // Verify removed fields
    expect(parsed[0].body).toBeUndefined();
    expect(parsed[0].assignee).toBeUndefined();
    expect(parsed[0].labels[0].color).toBeUndefined();
  });

  it('passes through when no rules match', () => {
    const hookInput: HookInput = {
      session_id: 'test-session',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__filesystem__read_file',
      tool_input: { path: '/some/file.txt' },
      tool_response: 'Just some file content, no JSON.',
    };

    const matchingRules = findMatchingRules(hookInput.tool_name, config);

    expect(matchingRules).toHaveLength(0);
  });

  it('reports token savings', () => {
    const largeResponse = {
      id: 1,
      name: 'repo',
      full_name: 'org/repo',
      html_url: 'https://github.com/org/repo',
      description: 'A'.repeat(500),
      owner: { login: 'user', id: 1, avatar_url: 'https://long-url...', type: 'User', site_admin: false },
      private: false,
      fork: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-06-01T00:00:00Z',
      pushed_at: '2024-06-01T00:00:00Z',
      size: 12345,
      forks_count: 50,
      open_issues_count: 10,
      license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT', url: 'https://...' },
      topics: ['typescript', 'ai', 'tools'],
    };

    const original = JSON.stringify(largeResponse);
    const options: FilterOptions = {
      keep: {
        id: true,
        name: true,
        full_name: true,
        html_url: true,
        owner: { login: true },
      },
    };

    const filtered = filterFields(largeResponse, options);
    const filteredStr = JSON.stringify(filtered);

    const savings = ((1 - filteredStr.length / original.length) * 100).toFixed(1);
    expect(parseFloat(savings)).toBeGreaterThan(50);
  });
});

// ── Input normalization tests ───────────────────────────────────────────────

describe('normalizeInput', () => {
  const sampleData = { id: 1, name: 'test', extra: 'removed' };

  it('normalizes MCP tool with structuredContent', () => {
    const raw = {
      session_id: 's1',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__get_repository',
      tool_input: { owner: 'octocat', repo: 'hello-world' },
      tool_response: {
        content: [{ type: 'text', text: JSON.stringify(sampleData) }],
        structuredContent: sampleData,
      },
      tool_use_id: 'toolu_01ABC123',
      cwd: '/home/user/project',
    };

    const normalized = normalizeInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.agent).toBe('claude');
    expect(normalized!.toolName).toBe('mcp__github__get_repository');
    expect(normalized!.hasStructuredContent).toBe(true);
    expect(normalized!.structuredContent).toEqual(sampleData);
    expect(normalized!.cwd).toBe('/home/user/project');
    expect(normalized!.sessionId).toBe('s1');
  });  it('normalizes MCP tool with text-only content (no structuredContent)', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__search_repositories',
      tool_input: { query: 'test' },
      tool_response: {
        content: [{ type: 'text', text: JSON.stringify(sampleData) }],
      },
    };

    const normalized = normalizeInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.hasStructuredContent).toBe(false);
    expect(normalized!.toolResponse).toBe(JSON.stringify(sampleData));
  });

  it('normalizes MCP tool with plain string tool_response', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__filesystem__read_file',
      tool_input: { path: '/file.txt' },
      tool_response: JSON.stringify(sampleData),
    };

    const normalized = normalizeInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.hasStructuredContent).toBe(false);
    expect(normalized!.toolResponse).toBe(JSON.stringify(sampleData));
    expect(normalized!.responseWrapper).toBeUndefined();
    expect(normalized!.contentItems).toBeUndefined();
  });

  it('normalizes tool_response as direct array of content items', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__vscode-mcp-gateway__search_repositories',
      tool_input: { query: 'user:Pask00 fork:only', perPage: 1 },
      tool_response: [
        { type: 'text', text: JSON.stringify(sampleData) },
      ],
    };

    const normalized = normalizeInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.hasStructuredContent).toBe(false);
    // The JSON data from inside the text content item
    expect(normalized!.toolResponse).toBe(JSON.stringify(sampleData));
    expect(normalized!.contentItems).toHaveLength(1);
    expect(normalized!.contentItems![0].type).toBe('text');
  });

  it('normalizes tool_response with text wrapper ({ text: "..." })', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__search_repositories',
      tool_input: { query: 'test' },
      tool_response: { text: JSON.stringify(sampleData) },
    };

    const normalized = normalizeInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.hasStructuredContent).toBe(false);
    expect(normalized!.toolResponse).toBe(JSON.stringify(sampleData));
    expect(normalized!.responseWrapper).toEqual({ text: JSON.stringify(sampleData) });
  });

  it('preserves extra properties on text wrapper', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__search_repositories',
      tool_input: { query: 'test' },
      tool_response: { text: '{"id":1}', type: 'text', annotations: { audience: ['user'] } },
    };

    const normalized = normalizeInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.toolResponse).toBe('{"id":1}');
    expect(normalized!.responseWrapper).toEqual({
      text: '{"id":1}',
      type: 'text',
      annotations: { audience: ['user'] },
    });
  });

  it('concatenates multiple text content items', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__some__tool',
      tool_input: {},
      tool_response: {
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'image', data: 'base64...' },
          { type: 'text', text: 'line 2' },
        ],
      },
    };

    const normalized = normalizeInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.toolResponse).toBe('line 1\nline 2');
  });

  it('returns null for non-MCP tools', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: JSON.stringify(sampleData),
    };
    expect(normalizeInput(raw)).toBeNull();
  });

  it('returns null for non-PostToolUse events', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__github__get_repository',
      tool_input: {},
      tool_response: { content: [{ type: 'text', text: '{}' }] },
    };
    expect(normalizeInput(raw)).toBeNull();
  });

  it('returns null for unrecognized input', () => {
    const raw = { random: 'data', no: 'tool info' };
    expect(normalizeInput(raw)).toBeNull();
  });

  it('handles null tool_response', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__some__tool',
      tool_input: {},
      tool_response: null,
    };

    const normalized = normalizeInput(raw);
    expect(normalized).not.toBeNull();
    expect(normalized!.toolResponse).toBe('');
  });

  it('works end-to-end with structuredContent through full pipeline', () => {
    const repoData = {
      id: 123,
      name: 'hello-world',
      full_name: 'octocat/hello-world',
      html_url: 'https://github.com/octocat/hello-world',
      description: 'Very long description...',
      owner: { login: 'octocat', id: 999, avatar_url: 'https://...', type: 'User' },
      private: false,
    };

    const mcpInput = {
      session_id: 'test-session',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__get_repository',
      tool_input: { owner: 'octocat', repo: 'hello-world' },
      tool_response: {
        content: [{ type: 'text', text: JSON.stringify(repoData) }],
        structuredContent: repoData,
      },
      tool_use_id: 'toolu_01ABC123',
    };

    const normalized = normalizeInput(mcpInput);
    expect(normalized).not.toBeNull();
    expect(normalized!.hasStructuredContent).toBe(true);

    // Filter using structuredContent directly
    const matchingRules = findMatchingRules(normalized!.toolName, {
      version: 1,
      rules: [
        {
          id: 'github-repos',
          match: { toolName: 'mcp__github__get_repository' },
          keep: { id: true, name: true, full_name: true, html_url: true, owner: { login: true } },
        },
      ],
    });

    expect(matchingRules).toHaveLength(1);

    const options = buildFilterOptions(matchingRules[0]);
    const filtered = filterFields(normalized!.structuredContent!, options);

    expect(filtered).toEqual({
      id: 123,
      name: 'hello-world',
      full_name: 'octocat/hello-world',
      html_url: 'https://github.com/octocat/hello-world',
      owner: { login: 'octocat' },
    });
  });

  it('works end-to-end with text content (no structuredContent) through full pipeline', () => {
    const mcpInput = {
      session_id: 'test-session',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__get_repository',
      tool_input: { owner: 'octocat', repo: 'hello-world' },
      tool_response: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: 456,
            name: 'hello-world',
            full_name: 'octocat/hello-world',
            html_url: 'https://github.com/octocat/hello-world',
            description: 'Unnecessary description',
            private: false,
            owner: { login: 'octocat', id: 999, avatar_url: 'https://...' },
          }),
        }],
      },
    };

    const normalized = normalizeInput(mcpInput);
    expect(normalized).not.toBeNull();
    expect(normalized!.hasStructuredContent).toBe(false);

    const matchingRules = findMatchingRules(normalized!.toolName, {
      version: 1,
      rules: [
        {
          id: 'github-repos',
          match: { toolName: 'mcp__github__get_repository' },
          keep: { id: true, name: true, full_name: true, html_url: true, owner: { login: true } },
        },
      ],
    });

    expect(matchingRules).toHaveLength(1);

    const options = buildFilterOptions(matchingRules[0]);
    const trimmed = replaceJsonInText(normalized!.toolResponse, (json) => filterFields(json, options));
    const parsed = JSON.parse(trimmed);

    expect(parsed).toEqual({
      id: 456,
      name: 'hello-world',
      full_name: 'octocat/hello-world',
      html_url: 'https://github.com/octocat/hello-world',
      owner: { login: 'octocat' },
    });
  });

  it('works end-to-end with tool_response.text wrapper through full pipeline', () => {
    const repoData = {
      id: 789,
      name: 'hello-world',
      full_name: 'octocat/hello-world',
      html_url: 'https://github.com/octocat/hello-world',
      description: 'Should be removed',
      private: false,
      owner: { login: 'octocat', id: 999, avatar_url: 'https://...', type: 'User' },
    };

    const mcpInput = {
      session_id: 'test-session',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__github__get_repository',
      tool_input: { owner: 'octocat', repo: 'hello-world' },
      tool_response: { text: JSON.stringify(repoData) },
    };

    const normalized = normalizeInput(mcpInput);
    expect(normalized).not.toBeNull();
    expect(normalized!.hasStructuredContent).toBe(false);
    expect(normalized!.responseWrapper).toBeDefined();

    // keep rules apply to the JSON inside .text, not the wrapper
    const matchingRules = findMatchingRules(normalized!.toolName, {
      version: 1,
      rules: [
        {
          id: 'github-repos',
          match: { toolName: 'mcp__github__get_repository' },
          keep: { id: true, name: true, full_name: true, html_url: true, owner: { login: true } },
        },
      ],
    });

    expect(matchingRules).toHaveLength(1);

    const options = buildFilterOptions(matchingRules[0]);
    const trimmed = replaceJsonInText(normalized!.toolResponse, (json) => filterFields(json, options));
    const parsed = JSON.parse(trimmed);

    expect(parsed).toEqual({
      id: 789,
      name: 'hello-world',
      full_name: 'octocat/hello-world',
      html_url: 'https://github.com/octocat/hello-world',
      owner: { login: 'octocat' },
    });

    // Output should preserve the wrapper structure
    const output = { ...normalized!.responseWrapper, text: trimmed };
    expect(output).toHaveProperty('text');
    expect(JSON.parse(output.text as string)).toEqual(parsed);
  });

  it('works end-to-end with direct array tool_response (real Claude Code format)', () => {
    // Exact format from real Claude Code log
    const hookInput = {
      session_id: '8e647c15-aab0-4dd6-a396-40e533fcf996',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__vscode-mcp-gateway__search_repositories',
      tool_input: { query: 'user:Pask00 fork:only', perPage: 1 },
      tool_response: [
        {
          type: 'text',
          text: JSON.stringify({
            total_count: 6,
            incomplete_results: false,
            items: [
              {
                id: 826994047,
                name: 'llvm-project',
                full_name: 'Pask00/llvm-project',
                description: 'The LLVM Project is a collection of modular and reusable compiler and toolchain technologies.',
                html_url: 'https://github.com/Pask00/llvm-project',
                language: 'LLVM',
                stargazers_count: 0,
                forks_count: 0,
                open_issues_count: 0,
                updated_at: '2024-07-19T08:37:51Z',
                created_at: '2024-07-10T19:55:08Z',
                private: false,
                fork: true,
                archived: false,
                default_branch: 'main',
              },
            ],
          }),
        },
      ],
      tool_use_id: 'toolu_bdrk_014pceZZDqv8P9gm3eaG9Fxp',
    };

    const normalized = normalizeInput(hookInput);
    expect(normalized).not.toBeNull();
    expect(normalized!.hasStructuredContent).toBe(false);
    expect(normalized!.contentItems).toHaveLength(1);

    // toolResponse should be the text INSIDE the content item, not the stringified array
    const innerData = JSON.parse(normalized!.toolResponse);
    expect(innerData.total_count).toBe(6);
    expect(innerData.items).toHaveLength(1);
    expect(innerData.items[0].name).toBe('llvm-project');

    // Apply keep rules to filter the inner data
    const config: TrimConfig = {
      version: 1,
      rules: [
        {
          id: 'search-repositories',
          match: { toolName: 'mcp__vscode-mcp-gateway__search_repositories' },
          keep: {
            total_count: true,
            items: {
              name: true,
              full_name: true,
              language: true,
              created_at: true,
            },
          },
        },
      ],
    };

    const matchingRules = findMatchingRules(normalized!.toolName, config);
    expect(matchingRules).toHaveLength(1);

    const options = buildFilterOptions(matchingRules[0]);
    const trimmed = replaceJsonInText(normalized!.toolResponse, (json) => filterFields(json, options));
    const filteredData = JSON.parse(trimmed);

    // Verify only keep fields survive
    expect(filteredData).toEqual({
      total_count: 6,
      items: [
        {
          name: 'llvm-project',
          full_name: 'Pask00/llvm-project',
          language: 'LLVM',
          created_at: '2024-07-10T19:55:08Z',
        },
      ],
    });

    // Verify description, html_url, stargazers_count, etc. are removed
    expect(filteredData.incomplete_results).toBeUndefined();
    expect(filteredData.items[0].description).toBeUndefined();
    expect(filteredData.items[0].html_url).toBeUndefined();
    expect(filteredData.items[0].stargazers_count).toBeUndefined();
    expect(filteredData.items[0].id).toBeUndefined();
  });
});
