export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface DeadLetterEntry {
  timestamp: string;
  server: string;
  tool: string;
  args: unknown;
  error: string;
  attempts: number;
}

const defaultDeadLetters: DeadLetterEntry[] = [];

export function getDeadLetters(): DeadLetterEntry[] {
  return [...defaultDeadLetters];
}

export function clearDeadLetters(): void {
  defaultDeadLetters.length = 0;
}

export function deadLetter(server: string, tool: string, args: unknown, error: Error, attempts: number): void {
  defaultDeadLetters.push({
    timestamp: new Date().toISOString(),
    server,
    tool,
    args,
    error: error.message,
    attempts
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  server: string,
  tool: string,
  args: unknown,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 100;
  const maxDelay = opts.maxDelayMs ?? 1000;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxAttempts) {
        deadLetter(server, tool, args, lastError, attempt);
        throw lastError;
      }
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError!;
}
