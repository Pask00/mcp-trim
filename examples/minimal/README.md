# Minimal

A bare-bones starting point with a single rule.

## Scenario

You're setting up mcp-trim for the first time and want the simplest possible config to understand how rules work. This example contains one rule that matches a single MCP tool and keeps only two fields.

Use this as a template — replace the tool name and fields with your own.

## Usage

```bash
# Copy and edit
cp examples/minimal/config.json .config/mcp-trim/config.json

# Or just use the CLI directly
mcp-trim init
mcp-trim set my-rule \
  --tool "mcp__myserver__my_tool" \
  --keep "id,name"
```

## What to change

1. **`match.toolName`** — Replace `mcp__myserver__my_tool` with the actual MCP tool name you want to trim.
2. **`keep`** — List the fields you want to preserve. Use `true` for simple fields or nested objects for deeper filtering.
3. **`id`** — Give the rule a descriptive name (e.g., `github-repos`, `jira-issues`).
