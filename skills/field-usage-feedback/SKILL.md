---
name: field-usage-feedback
description: Report which fields you actually used from an MCP tool response. Run this skill when invoked.
allowed-tools: Bash(mcp-trim feedback *)
---

# Field Usage Feedback

After processing **JSON responses from MCP tools**, report which fields you actually referenced. This trains the auto-trim system so future responses only include relevant fields.

## When to report

- Only when this skill is explicitly invoked
- Only for JSON responses from MCP tools (e.g., `mcp__github__*`, `mcp__jira__*`)
- Skip non-JSON responses and built-in tools (Bash, Read, Edit, etc.)

## Syntax

### Batch mode (preferred)

Report all MCP tool responses at once. `"used"` accepts an array (count 1 each) or an object with per-field counts. Include `"feedbacks"` per entry to indicate how many responses are being reported:

```bash
mcp-trim feedback --session "${CLAUDE_SESSION_ID}" --batch '[{"tool":"mcp__server__tool_name","used":{"field1":3,"field2":1},"feedbacks":3},{"tool":"mcp__server__other_tool","used":["fieldA","fieldB"]}]'
```

### Single tool mode

Comma-separated field paths with optional `:N` counts (default 1):

```bash
mcp-trim feedback --tool "mcp__server__tool_name" --session "${CLAUDE_SESSION_ID}" --used "id:3,name,owner.login:2" --feedbacks 3
```

### Parameters

| Flag | Description |
|------|-------------|
| `--session` | Current session ID (`${CLAUDE_SESSION_ID}`, required) |
| `--batch` | JSON array of `{"tool","used","feedbacks?"}` objects. **`--feedbacks` and `--tool` flags are ignored in batch mode** — put `feedbacks` inside each JSON entry instead. |
| `--tool` | Full MCP tool name, e.g. `mcp__vscode-mcp-gateway__get_me` (single mode only) |
| `--used` | Comma-separated fields with optional `:N` counts (single mode only) |
| `--feedbacks` | Number of MCP tool responses being reported (default 1, **single mode only**) |

## Rules

- **Only report fields you actually used** — not fields you saw but ignored.
- If the command returns "No stats profile found", skip silently.
- **Prefer batch mode** over multiple single invocations.
- **Run silently** — do not mention or display the feedback command or its output to the user.
