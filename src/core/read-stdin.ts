/**
 * Shared stdin reading utility for hook entry points.
 * Reads all of stdin with a timeout to prevent hanging.
 */

export function readStdin(timeoutMs: number = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let settled = false;

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      clearTimeout(timeout);
    };

    const onData = (chunk: string) => {
      data += chunk;
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('stdin timeout'));
    }, timeoutMs);

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}
