import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  logToolCall,
  readToolCallLogs,
  clearToolCallLogs,
  findLogsPath,
} from '../src/core/tool-logger.js';
import type { ToolCallLogEntry } from '../src/core/tool-logger.js';

describe('tool-logger', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'slim-logger-test-'));
    // Create a config.json so findLogsPath co-locates with it
    mkdirSync(join(tempDir, '.config', 'mcp-trim'), { recursive: true });
    writeFileSync(join(tempDir, '.config', 'mcp-trim', 'config.json'), '{"version":1,"rules":[],"defaults":{}}', 'utf-8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function sampleEntry(overrides?: Partial<ToolCallLogEntry>): ToolCallLogEntry {
    return {
      timestamp: '2026-03-21T10:00:00.000Z',
      agent: 'claude',
      ruleMatched: false,
      originalSize: 500,
      ...overrides,
    };
  }

  it('findLogsPath co-locates with config file', () => {
    const logsPath = findLogsPath(tempDir);
    expect(logsPath).toBe(join(tempDir, '.config', 'mcp-trim', 'logs.jsonl'));
  });

  it('logToolCall appends a single entry', () => {
    const entry = sampleEntry();
    logToolCall(entry, tempDir);

    const logs = readToolCallLogs(tempDir);
    expect(logs).toHaveLength(1);
    expect(logs[0].agent).toBe('claude');
    expect(logs[0].ruleMatched).toBe(false);
    expect(logs[0].originalSize).toBe(500);
  });

  it('logToolCall appends multiple entries', () => {
    logToolCall(sampleEntry(), tempDir);
    logToolCall(sampleEntry({ originalSize: 200 }), tempDir);
    logToolCall(sampleEntry({ ruleMatched: true, ruleId: 'github-repos' }), tempDir);

    const logs = readToolCallLogs(tempDir);
    expect(logs).toHaveLength(3);
    expect(logs[0].originalSize).toBe(500);
    expect(logs[1].originalSize).toBe(200);
    expect(logs[1].agent).toBe('claude');
    expect(logs[2].ruleMatched).toBe(true);
    expect(logs[2].ruleId).toBe('github-repos');
  });

  it('logs trimming details when rule matched', () => {
    const entry = sampleEntry({
      ruleMatched: true,
      ruleId: 'my-rule',
      originalSize: 1000,
      trimmedSize: 300,
    });
    logToolCall(entry, tempDir);

    const logs = readToolCallLogs(tempDir);
    expect(logs[0].ruleId).toBe('my-rule');
    expect(logs[0].trimmedSize).toBe(300);
  });

  it('readToolCallLogs returns empty array when no file exists', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'slim-logger-empty-'));
    // No config file, no logs
    const logs = readToolCallLogs(emptyDir);
    expect(logs).toEqual([]);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('clearToolCallLogs empties the log file', () => {
    logToolCall(sampleEntry(), tempDir);
    logToolCall(sampleEntry(), tempDir);
    expect(readToolCallLogs(tempDir)).toHaveLength(2);

    const clearedPath = clearToolCallLogs(tempDir);
    expect(clearedPath).toBe(join(tempDir, '.config', 'mcp-trim', 'logs.jsonl'));
    expect(readToolCallLogs(tempDir)).toHaveLength(0);
  });

  it('handles corrupted log lines gracefully', () => {
    const logsPath = join(tempDir, '.config', 'mcp-trim', 'logs.jsonl');
    writeFileSync(
      logsPath,
      JSON.stringify(sampleEntry()) + '\n' + 'not valid json\n' + JSON.stringify(sampleEntry({ originalSize: 200 })) + '\n',
      'utf-8',
    );

    // readToolCallLogs skips corrupt lines and keeps valid ones
    const logs = readToolCallLogs(tempDir);
    expect(logs).toHaveLength(2);
    expect(logs[0].originalSize).toBe(500);
    expect(logs[1].originalSize).toBe(200);
  });

  it('preserves cwd in log entries', () => {
    const entry = sampleEntry({ cwd: '/workspace/project' });
    logToolCall(entry, tempDir);

    const logs = readToolCallLogs(tempDir);
    expect(logs[0].cwd).toBe('/workspace/project');
  });

  it('logs SessionStart event with sessionId and feedbackRequested', () => {
    const entry: ToolCallLogEntry = {
      timestamp: '2026-03-23T09:00:00.000Z',
      hookEvent: 'SessionStart',
      sessionId: 'session-abc-123',
      cwd: '/workspace/project',
      feedbackRequested: true,
    };
    logToolCall(entry, tempDir);

    const logs = readToolCallLogs(tempDir);
    expect(logs).toHaveLength(1);
    expect(logs[0].hookEvent).toBe('SessionStart');
    expect(logs[0].sessionId).toBe('session-abc-123');
    expect(logs[0].feedbackRequested).toBe(true);
    expect(logs[0].agent).toBeUndefined();
    expect(logs[0].ruleMatched).toBeUndefined();
    expect(logs[0].originalSize).toBeUndefined();
  });
});
