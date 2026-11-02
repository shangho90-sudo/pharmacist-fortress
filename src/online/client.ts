import { PROTOCOL, type ServerMessage } from './protocol';

export class OnlineClient {
  private ws: WebSocket | null = null;
  private heartbeat: number | null = null;
  private lastMessage = 0;
  id = '';
  onMessage: (m: ServerMessage) => void = () => {};
  onDisconnect: () => void = () => {};
  get connected() { return this.ws?.readyState === WebSocket.OPEN; }
  async connect() {
    this.close();
    const response = await fetch(import.meta.env.BASE_URL + 'online-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('온라인 서버 설정을 읽을 수 없습니다.');
    const config = await response.json();
    const url = new URL(config.url);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('서버 주소가 올바르지 않습니다.');
    let token = ''; try { token = sessionStorage.getItem('pf_guest_token') || ''; } catch {}
    if (token) url.searchParams.set('token', token);
    await new Promise<void>((resolve, reject) => {
      const ws = this.ws = new WebSocket(url);
      const timeout = window.setTimeout(() => { reject(new Error('서버 연결이 지연되고 있습니다. 다시 시도해 주세요.')); ws.close(); }, 20000);
      ws.onmessage = e => {
        this.lastMessage = Date.now();
        const m = JSON.parse(e.data) as ServerMessage;
        if (m.type === 'hello') {
          clearTimeout(timeout);
          if (m.version !== PROTOCOL) { reject(new Error('새로고침 후 다시 접속해 주세요.')); ws.close(); return; }
          this.id = m.id; try { sessionStorage.setItem('pf_guest_token', m.token); } catch {}
          resolve();
        }
        this.onMessage(m);
      };
      ws.onclose = () => { clearTimeout(timeout); reject(new Error('서버 연결이 종료되었습니다.')); this.clearHeartbeat(); this.onDisconnect(); };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('온라인 서버에 연결할 수 없습니다.')); };
    });
    this.lastMessage = Date.now();
    this.heartbeat = window.setInterval(() => {
      if (Date.now() - this.lastMessage > 18000) this.ws?.close();
      else this.send({ type: 'ping' });
    }, 5000);
  }
  send(message: object) { if (this.connected) this.ws!.send(JSON.stringify(message)); }
  private clearHeartbeat() { if (this.heartbeat !== null) clearInterval(this.heartbeat); this.heartbeat = null; }
  close() { this.clearHeartbeat(); if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; this.ws.close(); this.ws = null; } }
}
