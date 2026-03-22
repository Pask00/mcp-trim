# Auto-Learn Only

Zero manual rules — relies entirely on auto-learning to discover and create trimming rules.

## Scenario

You're using MCP tools but don't yet know which fields the agent needs. Instead of guessing, start with an empty rule set and let mcp-trim learn from actual usage. After a few sessions with feedback, it will auto-create rules scoped to each session, and you can promote the best ones to your global config.

This config uses lower thresholds (`minInvocations: 3`, `minFeedback: 2`) so rules are suggested faster — useful when you're experimenting or onboarding a new MCP server.

## Usage

```bash
cp examples/auto-learn-only/config.json .config/mcp-trim/config.json
```

## How it works

1. Use Claude Code normally — call MCP tools as you would.
2. The `field-usage-feedback` skill (or `mcp-trim feedback`) records which fields the agent used.
3. After 3 invocations and 2 feedback entries, mcp-trim auto-creates session-scoped rules.
4. Review and promote to your global config when ready:

```bash
# See what was learned
mcp-trim suggest --session <session-id>

# Promote to config.json for all future sessions
mcp-trim suggest --session <session-id> --apply
```

## When to use this

- You're trying out a new MCP server and want to see what fields matter before writing rules.
- You want a hands-off setup that improves over time.
- You prefer data-driven rules over manual field selection.
