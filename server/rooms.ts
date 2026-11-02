import { randomUUID, randomBytes } from 'node:crypto';
import { Game } from '../src/core/game';
import { CHAR_LIST } from '../src/core/characters';
import { MAP_LIST } from '../src/core/mapgen';
import { PROTOCOL, applyCommand, type Command, type Lobby, type Member, type ServerMessage, type StartMatch } from '../src/online/protocol';

interface Peer { id: string; token: string; room?: string; send: (m: ServerMessage) => void }
interface Room extends Lobby { banned: Set<string>; game?: Game; match?: string; seats: string[]; queue: Command[]; idleAt: number }
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max) : '';
export class RoomHub {
  readonly peers = new Map<string, Peer>();
  readonly rooms = new Map<string, Room>();
  private tokens = new Map<string, number>();

  connect(send: Peer['send'], token?: string) {
    const valid = token && this.tokens.has(token) && ![...this.peers.values()].some(p => p.token === token);
    const p: Peer = { id: randomUUID(), token: valid ? token! : randomBytes(24).toString('hex'), send };
    this.tokens.set(p.token, Date.now()); this.peers.set(p.id, p);
    send({ type: 'hello', id: p.id, token: p.token, version: PROTOCOL });
    this.list(p); return p.id;
  }
  private view(r: Room): Lobby {
    return { id: r.id, title: r.title, host: r.host, mode: r.mode, map: r.map, members: r.members.map(m => ({ ...m })), playing: r.playing, max: r.max };
  }
  private list(p: Peer) { p.send({ type: 'rooms', rooms: [...this.rooms.values()].map(r => this.view(r)) }); }
  private lists() { for (const p of this.peers.values()) if (!p.room) this.list(p); }
  private publish(r: Room) { for (const m of r.members) this.peers.get(m.id)?.send({ type: 'room', room: this.view(r) }); this.lists(); }
  private error(p: Peer, message: string) { p.send({ type: 'error', message }); }

  handle(id: string, raw: unknown) {
    const p = this.peers.get(id); if (!p || !raw || typeof raw !== 'object') return;
    const m = raw as Record<string, unknown>;
    if (m.type === 'ping') { p.send({ type: 'pong' }); return; }
    if (m.type === 'list') { this.list(p); return; }
    if (m.type === 'leave') { this.leave(p, '대기실에서 나왔습니다.'); return; }
    if (m.type === 'create' || m.type === 'join') {
      if (p.room) return this.error(p, '현재 방에서 먼저 나가 주세요.');
      const name = clean(m.name, 16) || '손님';
      let r: Room | undefined;
      if (m.type === 'create') {
        if (this.rooms.size >= 80) return this.error(p, '대기실이 가득 찼습니다. 잠시 후 다시 시도해 주세요.');
        r = { id: randomBytes(4).toString('hex'), title: clean(m.title, 32) || `${name}의 대기실`, host: id,
          mode: m.mode === 'teams' ? 'teams' : 'ffa', map: MAP_LIST.includes(m.map as any) ? m.map as Lobby['map'] : 'herb_forest',
          members: [], playing: false, max: 8, banned: new Set(), seats: [], queue: [], idleAt: Date.now() };
        this.rooms.set(r.id, r);
      } else r = this.rooms.get(String(m.room));
      if (!r) return this.error(p, '대기실을 찾을 수 없습니다.');
      if (r.playing || r.members.length >= r.max) return this.error(p, '게임 중이거나 가득 찬 방입니다.');
      if (r.banned.has(p.token)) return this.error(p, '이 방에서 강퇴되어 다시 입장할 수 없습니다.');
      const taken = r.members.filter(x => x.ready).map(x => x.character);
      r.members.push({ id, name, character: CHAR_LIST.find(c => !taken.includes(c)) ?? null, team: r.members.length % 2 ? 'red' : 'blue', ready: false });
      p.room = r.id; r.idleAt = Date.now(); this.publish(r); return;
    }
    const r = p.room ? this.rooms.get(p.room) : undefined;
    const me = r?.members.find(x => x.id === id);
    if (!r || !me) return this.error(p, '대기실에 먼저 입장해 주세요.');
    r.idleAt = Date.now();
    if (m.type === 'command') {
      const g = r.game, seat = r.seats.indexOf(id);
      if (!r.playing || !g || !g.canControl || seat !== g.current || m.turn !== g.turnNumber || r.queue.length >= 120) return;
      const a = m.action as any;
      if (!a || typeof a !== 'object') return;
      let action: any;
      if (a.kind === 'input' && [-1, 0, 1].includes(a.move) && [-1, 0, 1].includes(a.aim)) action = { kind: 'input', move: a.move, aim: a.aim };
      else if (a.kind === 'fire' && ['basic', 'special', 'ultimate', 'move'].includes(a.weapon) && typeof a.power === 'number' && Number.isFinite(a.power) && a.power >= 0 && a.power <= 100) action = { kind: 'fire', weapon: a.weapon, power: a.power };
      else if (a.kind === 'skip') action = { kind: 'skip' };
      if (action) r.queue.push({ player: seat, turn: g.turnNumber, action });
      return;
    }
    if (r.playing) return this.error(p, '전투가 끝난 뒤 변경할 수 있습니다.');
    if (m.type === 'select') {
      if (me.ready) return this.error(p, '준비를 취소한 뒤 변경해 주세요.');
      if (!CHAR_LIST.includes(m.character as any)) return;
      if (r.members.some(x => x.id !== id && x.ready && x.character === m.character)) return this.error(p, '다른 플레이어가 먼저 준비한 캐릭터입니다.');
      me.character = m.character as Member['character'];
    } else if (m.type === 'team') {
      if (me.ready || r.mode !== 'teams' || !['blue', 'red'].includes(String(m.team))) return;
      me.team = m.team as Member['team'];
    } else if (m.type === 'ready') {
      if (typeof m.ready !== 'boolean') return;
      if (m.ready && (!me.character || r.members.some(x => x.id !== id && x.ready && x.character === me.character))) return this.error(p, '사용 가능한 캐릭터를 선택해 주세요.');
      me.ready = m.ready;
      if (me.ready) for (const other of r.members) if (other.id !== id && !other.ready && other.character === me.character) other.character = null;
    } else if (m.type === 'settings') {
      if (r.host !== id) return this.error(p, '방장만 설정을 변경할 수 있습니다.');
      if (m.mode === 'ffa' || m.mode === 'teams') r.mode = m.mode;
      if (MAP_LIST.includes(m.map as any)) r.map = m.map as Lobby['map'];
      r.members.forEach(x => x.ready = false);
    } else if (m.type === 'kick') {
      if (r.host !== id || m.player === id) return this.error(p, '방장만 다른 플레이어를 강퇴할 수 있습니다.');
      const target = this.peers.get(String(m.player));
      if (target?.room === r.id) { r.banned.add(target.token); this.leave(target, '방장에 의해 강퇴되었습니다.'); }
      return;
    } else if (m.type === 'start') {
      if (r.host !== id) return this.error(p, '방장만 게임을 시작할 수 있습니다.');
      if (r.members.length < 2 || r.members.some(x => !x.ready || !x.character)) return this.error(p, '2명 이상 입장하고 모두 준비 완료를 눌러야 합니다.');
      if (new Set(r.members.map(x => x.character)).size !== r.members.length) return this.error(p, '캐릭터를 중복 선택할 수 없습니다.');
      if (r.mode === 'teams' && new Set(r.members.map(x => x.team)).size !== 2) return this.error(p, 'BLUE와 RED 팀에 각각 1명 이상 있어야 합니다.');
      if ([...this.rooms.values()].filter(room => room.playing).length >= 12) return this.error(p, '진행 중인 경기가 많습니다. 잠시 후 시작해 주세요.');
      const options = { seed: randomBytes(4).readUInt32LE(), mapId: r.map, players: r.members.map((x, i) => ({ name: x.name, charType: x.character!, controller: 'human' as const, team: r.mode === 'ffa' ? i : x.team === 'blue' ? 0 : 1 })) };
      r.game = new Game(options); r.game.events = []; r.match = randomUUID(); r.playing = true; r.queue = []; r.seats = r.members.map(x => x.id);
      const start: StartMatch = { type: 'start', match: r.match, options, seats: r.seats, mode: r.mode };
      for (const x of r.members) this.peers.get(x.id)?.send(start);
      this.lists(); return;
    } else return;
    this.publish(r);
  }

  /** Called at 20 Hz. All clients replay exactly these six 120 Hz simulation ticks. */
  advance() {
    for (const r of this.rooms.values()) {
      if (!r.playing || !r.game || !r.match) continue;
      const from = r.game.tick, steps: Command[][] = [];
      for (let i = 0; i < 6; i++) {
        const commands = r.queue.splice(0);
        for (const c of commands) applyCommand(r.game, c);
        r.game.step(); r.game.events = []; steps.push(commands);
        if (r.game.phase === 'over') break;
      }
      for (const m of r.members) this.peers.get(m.id)?.send({ type: 'frame', match: r.match, from, steps });
      if (r.game.phase === 'over') {
        r.playing = false; r.game = undefined; r.members.forEach(x => x.ready = false); this.publish(r);
      }
    }
  }
  private leave(p: Peer, reason: string) {
    const r = p.room ? this.rooms.get(p.room) : undefined; p.room = undefined;
    p.send({ type: 'left', reason });
    if (!r) return;
    const seat = r.seats.indexOf(p.id);
    if (r.playing && seat >= 0) r.queue.push({ forfeit: seat });
    r.members = r.members.filter(x => x.id !== p.id);
    if (!r.members.length) this.rooms.delete(r.id);
    else { if (r.host === p.id) r.host = r.members[0].id; this.publish(r); }
    this.lists();
  }
  disconnect(id: string) { const p = this.peers.get(id); if (!p) return; this.leave(p, '연결이 종료되었습니다.'); this.peers.delete(id); }
  sweep() {
    const now = Date.now();
    for (const r of this.rooms.values()) if (!r.playing && now - r.idleAt > 60 * 60 * 1000) for (const m of [...r.members]) { const p = this.peers.get(m.id); if (p) this.leave(p, '오랫동안 사용하지 않은 대기실이 종료되었습니다.'); }
    for (const [token, time] of this.tokens) if (now - time > 86400000 && ![...this.peers.values()].some(p => p.token === token)) this.tokens.delete(token);
  }
}
