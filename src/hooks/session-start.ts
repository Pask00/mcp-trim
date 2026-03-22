/**
 * SessionStart hook logic for Claude Code.
 *
 * Fires once when a session starts or resumes. Injects additionalContext
 * asking Claude to invoke the field-usage-feedback skill after processing
 * MCP tool responses that have no trimming rule.
 *
 * See: https://docs.anthropic.com/en/docs/claude-code/hooks#sessionstart
 */

import { loadConfig } from '../core/config-manager.js';
import { readStdin } from '../core/read-stdin.js';
import { logToolCall } from '../core/tool-logger.js';

const CLAUDE_SESSION_START = 'SessionStart';

/** SessionStart hook input */
export interface SessionStartInput {
  session_id: string;
  hook_event_name: string;
  source: string;
  model?: string;
  agent_type?: string;
  cwd?: string;
  transcript_path?: string;
}

/** Output shape for SessionStart hooks */
export interface SessionStartHookOutput {
  hookSpecificOutput: {
    hookEventName: 'SessionStart';
    additionalContext: string;
  };
}

const FEEDBACK_CONTEXT =
  'Right after processing any JSON response from MCP tools, you MUST invoke the "field-usage-feedback" skill to report which fields you used.';

export async function runSessionStartHook(): Promise<void> {
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

  const input = rawJson! as unknown as SessionStartInput;

  if (input.hook_event_name !== CLAUDE_SESSION_START) process.exit(0);

  const config = loadConfig(input.cwd);

  // Only inject feedback context if auto-learn is enabled or there are rules
  // (meaning the system is actively being used)
  if (!config.autoLearn?.enabled && config.rules.length === 0) {
    process.exit(0);
  }

  const output: SessionStartHookOutput = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: FEEDBACK_CONTEXT,
    },
  };

  process.stdout.write(JSON.stringify(output));

  if (config.debug) {
    try {
      logToolCall(
        {
          timestamp: new Date().toISOString(),
          hookEvent: 'SessionStart',
          sessionId: input.session_id,
          cwd: input.cwd,
          feedbackRequested: true,
        },
        input.cwd,
      );
    } catch {
      // Logging should never break the hook
    }
  }

  process.exit(0);
}

// When run directly (e.g. via plugin hooks.json), execute the hook
const isDirectRun = process.argv[1]?.endsWith('session-start.js');
if (isDirectRun) {
  runSessionStartHook().catch(() => {
    process.exit(1);
  });
}
