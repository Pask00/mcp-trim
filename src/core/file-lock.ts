/**
 * Cross-process file locking utility.
 * Uses exclusive file creation (O_EXCL via 'wx' flag) for atomic lock acquisition
 * with the file descriptor held open for OS-enforced exclusion, stale-lock
 * detection, and retry logic with jitter.
 */

import { openSync, closeSync, writeSync, fdatasyncSync, unlinkSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_STALE_MS = 10_000;
const DEFAULT_RETRY_INTERVAL_MS = 50;
const DEFAULT_MAX_RETRIES = 100; // ~5-10 seconds with jitter

export interface LockOptions {
  staleMs?: number;
  retryIntervalMs?: number;
  maxRetries?: number;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function jitteredInterval(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // EPERM means the process exists but we lack permission to signal it
    // (common on Windows for processes owned by other users)
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

function isLockStale(lockPath: string, staleMs: number): boolean {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const lock = JSON.parse(content) as { pid: number; time: number };
    if (Date.now() - lock.time > staleMs) return true;
    if (typeof lock.pid === 'number' && !isProcessAlive(lock.pid)) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Acquires an exclusive lock by creating a lock file with O_EXCL and keeping
 * the file descriptor open. On Windows this prevents other processes from
 * deleting the lock file while it is held.
 */
function acquireLock(lockPath: string, options: Required<LockOptions>): number {
  const { staleMs, retryIntervalMs, maxRetries } = options;

  const dir = dirname(lockPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      const payload = JSON.stringify({ pid: process.pid, time: Date.now() });
      writeSync(fd, payload);
      fdatasyncSync(fd);
      return fd;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        if (isLockStale(lockPath, staleMs)) {
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
        sleepSync(jitteredInterval(retryIntervalMs));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to acquire file lock on ${lockPath} after ${maxRetries} retries`);
}

function releaseLock(lockPath: string, fd: number): void {
  try { closeSync(fd); } catch {}
  try { unlinkSync(lockPath); } catch {}
}

/**
 * Executes `fn` while holding an exclusive file lock on `filePath.lock`.
 * Provides cross-process mutual exclusion for read-modify-write cycles.
 */
export function withFileLock<T>(filePath: string, fn: () => T, options?: LockOptions): T {
  const lockPath = filePath + '.lock';
  const opts: Required<LockOptions> = {
    staleMs: options?.staleMs ?? DEFAULT_STALE_MS,
    retryIntervalMs: options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS,
    maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
  };

  const fd = acquireLock(lockPath, opts);
  try {
    return fn();
  } finally {
    releaseLock(lockPath, fd);
  }
}
