import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OnlineClient } from '../src/online/client';
import { PROTOCOL } from '../src/online/protocol';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Socket.instances.push(this); }
  send() {}
  close() { this.readyState = 3; }
  hello() { this.onmessage?.({ data: JSON.stringify({ type: 'hello', version: PROTOCOL, id: 'guest', token: 'token' }) }); }
}
let client: OnlineClient;
let readyAt: number;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('WebSocket', Socket);
  Socket.instances = [];
  readyAt = Date.now() + 60000;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => String(url).includes('online-config.json')
    ? { ok: true, json: async () => ({ url: 'wss://example.test/ws' }) }
    : { ok: Date.now() >= readyAt, json: async () => ({ ok: true }) }));
  client = new OnlineClient();
});
afterEach(() => { client.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('waits through a one-minute cold start before opening the game connection', async () => {
  const connected = client.connect();
  await vi.advanceTimersByTimeAsync(59000);
  expect(Socket.instances).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(Socket.instances).toHaveLength(1);
  Socket.instances[0].hello();
  await connected;
  expect(client.id).toBe('guest');
  expect(client.connected).toBe(true);
});

it('cancels server wake-up when the player leaves without making a hidden connection', async () => {
  const result = client.connect().catch(e => e);
  await vi.advanceTimersByTimeAsync(1000);
  client.close();
  expect((await result).name).toBe('AbortError');
  await vi.advanceTimersByTimeAsync(90000);
  expect(Socket.instances).toHaveLength(0);
});

it('ends an unavailable-server attempt after 90 seconds so the player can retry', async () => {
  readyAt = Infinity;
  const result = client.connect().catch(e => e);
  await vi.advanceTimersByTimeAsync(90000);
  expect((await result).message).toContain('다시 시도');
  readyAt = Date.now();
  const retry = client.connect();
  await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].hello();
  await retry;
  expect(client.connected).toBe(true);
});
