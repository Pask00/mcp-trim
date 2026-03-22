import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { withFileLock } from '../src/core/file-lock.js';

describe('file-lock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `file-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it('executes the callback and returns its result', () => {
    const filePath = join(tmpDir, 'test.json');
    writeFileSync(filePath, '{}');

    const result = withFileLock(filePath, () => 42);
    expect(result).toBe(42);
  });

  it('cleans up the lock file after success', () => {
    const filePath = join(tmpDir, 'test.json');
    writeFileSync(filePath, '{}');

    withFileLock(filePath, () => {});
    expect(existsSync(filePath + '.lock')).toBe(false);
  });

  it('cleans up the lock file after an error', () => {
    const filePath = join(tmpDir, 'test.json');
    writeFileSync(filePath, '{}');

    expect(() => {
      withFileLock(filePath, () => { throw new Error('boom'); });
    }).toThrow('boom');

    expect(existsSync(filePath + '.lock')).toBe(false);
  });

  it('detects and removes stale lock from dead PID', () => {
    const filePath = join(tmpDir, 'test.json');
    writeFileSync(filePath, '{}');

    // Create a lock file with a non-existent PID
    const lockPath = filePath + '.lock';
    writeFileSync(lockPath, JSON.stringify({ pid: 999999999, time: Date.now() }));

    const result = withFileLock(filePath, () => 'acquired');
    expect(result).toBe('acquired');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('detects and removes stale lock from expired timestamp', () => {
    const filePath = join(tmpDir, 'test.json');
    writeFileSync(filePath, '{}');

    // Create a lock file with current PID but old timestamp
    const lockPath = filePath + '.lock';
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, time: Date.now() - 20_000 }));

    const result = withFileLock(filePath, () => 'acquired', { staleMs: 10_000 });
    expect(result).toBe('acquired');
  });

  it('provides sequential correctness for read-modify-write', () => {
    const counterPath = join(tmpDir, 'counter.json');
    writeFileSync(counterPath, JSON.stringify({ count: 0 }));

    const projectRoot = join(__dirname, '..');
    const scriptPath = join(tmpDir, 'inc.cjs');
    writeFileSync(scriptPath, `
      const { withFileLock } = require('${projectRoot.replace(/\\/g, '/')}/dist/core/file-lock.js');
      const { readFileSync, writeFileSync } = require('fs');
      const path = process.argv[2];
      withFileLock(path, () => {
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        data.count += 1;
        writeFileSync(path, JSON.stringify(data));
      });
    `);

    const nodePath = process.execPath;
    const N = 10;
    for (let i = 0; i < N; i++) {
      execFileSync(nodePath, [scriptPath, counterPath], { timeout: 15000 });
    }

    const result = JSON.parse(readFileSync(counterPath, 'utf-8'));
    expect(result.count).toBe(N);
  });

  it('provides mutual exclusion under concurrent processes', async () => {
    const counterPath = join(tmpDir, 'counter.json');
    writeFileSync(counterPath, JSON.stringify({ count: 0 }));

    const projectRoot = join(__dirname, '..');
    const scriptPath = join(tmpDir, 'inc.cjs');
    writeFileSync(scriptPath, `
      const { withFileLock } = require('${projectRoot.replace(/\\/g, '/')}/dist/core/file-lock.js');
      const { readFileSync, writeFileSync } = require('fs');
      const path = process.argv[2];
      try {
        withFileLock(path, () => {
          const data = JSON.parse(readFileSync(path, 'utf-8'));
          data.count += 1;
          writeFileSync(path, JSON.stringify(data));
        }, { maxRetries: 200 });
      } catch (e) {
        process.stderr.write(String(e));
        process.exit(1);
      }
    `);

    const nodePath = process.execPath;
    const N = 8;

    // Launch all processes concurrently, capturing stderr for diagnostics
    const results: Promise<{ code: number | null; stderr: string }>[] = [];
    for (let i = 0; i < N; i++) {
      const child = spawn(nodePath, [scriptPath, counterPath], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      results.push(new Promise((resolve) => {
        child.on('exit', (code) => resolve({ code, stderr }));
      }));
    }

    const outcomes = await Promise.all(results);
    const failures = outcomes.filter((o) => o.code !== 0);
    expect(failures.map((f) => f.stderr)).toEqual([]);

    const result = JSON.parse(readFileSync(counterPath, 'utf-8'));
    expect(result.count).toBe(N);
  }, 30_000);
});
