import { withRetry, clearDeadLetters, getDeadLetters, deadLetter } from '../../src/utils/retry.js';

describe('retry util', () => {
  beforeEach(() => {
    clearDeadLetters();
  });

  it('succeeds on first try', async () => {
    const result = await withRetry(async () => 42, 'test', 'noop', {}, { maxAttempts: 3 });
    expect(result).toBe(42);
    expect(getDeadLetters()).toHaveLength(0);
  });

  it('retries 3 times then dead-letters on persistent failure', async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error('boom');
    };

    await expect(withRetry(failing, 'test-server', 'failing-tool', { x: 1 }, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow('boom');
    expect(calls).toBe(3);
    const dl = getDeadLetters();
    expect(dl).toHaveLength(1);
    expect(dl[0].server).toBe('test-server');
    expect(dl[0].tool).toBe('failing-tool');
    expect(dl[0].attempts).toBe(3);
    expect(dl[0].error).toMatch(/boom/);
  });

  it('succeeds on second attempt', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 2) throw new Error('temp fail');
      return 'ok';
    };

    const result = await withRetry(flaky, 'flaky-srv', 'flaky-tool', {}, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(getDeadLetters()).toHaveLength(0);
  });
});
