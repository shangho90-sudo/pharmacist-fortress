import { PROTOCOL, type ServerMessage } from './protocol';

export class OnlineClient {
  private ws: WebSocket | null = null;
  private heartbeat: number | null = null;
  private lastMessage = 0;
  private pending: AbortController | null = null;
  id = '';
  onMessage: (m: ServerMessage) => void = () => {};
  onDisconnect: () => void = () => {};
  get connected() { return this.ws?.readyState === WebSocket.OPEN; }
  async connect() {
    this.close();
    const pending = this.pending = new AbortController();
    const deadline = window.setTimeout(() => pending.abort(new Error('서버 연결이 지연되고 있습니다. 다시 시도해 주세요.')), 90000);
    try {
      const response = await fetch(import.meta.env.BASE_URL + 'online-config.json', { cache: 'no-store', signal: pending.signal });
      if (!response.ok) throw new Error('온라인 서버 설정을 읽을 수 없습니다.');
      const config = await response.json();
      const url = new URL(config.url);
      if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('서버 주소가 올바르지 않습니다.');
      // Free hosting may need time to wake before it accepts a WebSocket upgrade.
      const health = new URL('/health', url);
      health.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      for (;;) {
        pending.signal.throwIfAborted();
        let ready = false;
        try {
          const result = await fetch(health, { cache: 'no-store', signal: AbortSignal.any([pending.signal, AbortSignal.timeout(10000)]) });
          ready = result.ok && (await result.json()).ok === true;
        } catch { pending.signal.throwIfAborted(); }
        if (ready) break;
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(timer); reject(pending.signal.reason); };
          const timer = window.setTimeout(() => { pending.signal.removeEventListener('abort', cancel); resolve(); }, 1500);
          pending.signal.addEventListener('abort', cancel, { once: true });
        });
      }
      pending.signal.throwIfAborted();
      let token = ''; try { token = sessionStorage.getItem('pf_guest_token') || ''; } catch {}
      if (token) url.searchParams.set('token', token);
      await new Promise<void>((resolve, reject) => {
        const ws = this.ws = new WebSocket(url);
        const cancel = () => { reject(pending.signal.reason); ws.close(); };
        pending.signal.addEventListener('abort', cancel, { once: true });
        const done = () => pending.signal.removeEventListener('abort', cancel);
        ws.onmessage = e => {
          this.lastMessage = Date.now();
          const m = JSON.parse(e.data) as ServerMessage;
          if (m.type === 'hello') {
            done();
            if (m.version !== PROTOCOL) { reject(new Error('새로고침 후 다시 접속해 주세요.')); ws.close(); return; }
            this.id = m.id; try { sessionStorage.setItem('pf_guest_token', m.token); } catch {}
            resolve();
          }
          this.onMessage(m);
        };
        ws.onclose = () => { done(); reject(new Error('서버 연결이 종료되었습니다.')); this.clearHeartbeat(); this.onDisconnect(); };
        ws.onerror = () => { done(); reject(new Error('온라인 서버에 연결할 수 없습니다.')); };
      });
      this.lastMessage = Date.now();
      this.heartbeat = window.setInterval(() => {
        if (Date.now() - this.lastMessage > 18000) this.ws?.close();
        else this.send({ type: 'ping' });
      }, 5000);
    } finally {
      clearTimeout(deadline);
      if (this.pending === pending) this.pending = null;
    }
  }
  send(message: object) { if (this.connected) this.ws!.send(JSON.stringify(message)); }
  private clearHeartbeat() { if (this.heartbeat !== null) clearInterval(this.heartbeat); this.heartbeat = null; }
  close() { this.clearHeartbeat(); if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; this.ws.onerror = null; this.ws.close(); this.ws = null; } this.pending?.abort(); this.pending = null; }
}
