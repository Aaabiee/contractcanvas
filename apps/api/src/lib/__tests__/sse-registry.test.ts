import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('ioredis', () => {
  return {
    Redis: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(1),
      unsubscribe: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
    })),
  };
});

const { addClient, removeClient, pushToUser, connectedUserCount } = await import('../sse-registry.js');

describe('sse-registry (local mode, no Redis)', () => {
  let mockRes: any;

  beforeEach(() => {
    mockRes = { write: vi.fn() };
  });

  it('addClient and connectedUserCount', () => {
    addClient('user-1', mockRes);
    expect(connectedUserCount()).toBeGreaterThanOrEqual(1);
  });

  it('pushToUser writes SSE payload to local clients', () => {
    addClient('user-2', mockRes);
    pushToUser('user-2', 'notification', { title: 'hello' });
    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('event: notification'),
    );
    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('"title":"hello"'),
    );
  });

  it('pushToUser does nothing for unknown user', () => {
    pushToUser('unknown-user', 'test', {});
    expect(mockRes.write).not.toHaveBeenCalled();
  });

  it('removeClient removes the connection', () => {
    const res2: any = { write: vi.fn() };
    addClient('user-3', res2);
    removeClient('user-3', res2);
    pushToUser('user-3', 'test', {});
    expect(res2.write).not.toHaveBeenCalled();
  });

  it('pushToUser removes client on write error', () => {
    const badRes: any = { write: vi.fn().mockImplementation(() => { throw new Error('closed'); }) };
    addClient('user-4', badRes);
    pushToUser('user-4', 'test', { x: 1 });
    pushToUser('user-4', 'test', { x: 2 });
    expect(badRes.write).toHaveBeenCalledTimes(1);
  });
});
