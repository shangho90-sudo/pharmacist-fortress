import { describe, expect, it } from 'vitest';
import { RoomHub } from '../server/rooms';
import { Game } from '../src/core/game';
import { applyCommand, type ServerMessage, type StartMatch, type Frame } from '../src/online/protocol';

function guest(h: RoomHub, token?: string) {
  const messages: ServerMessage[] = [];
  const id = h.connect(m => messages.push(m), token);
  const send = (m: object) => h.handle(id, m);
  return { id, messages, send, token: (messages[0] as any).token as string };
}
function pair(mode = 'ffa') {
  const h = new RoomHub(), a = guest(h), b = guest(h);
  a.send({ type: 'create', name: 'Host', mode });
  const room = [...h.rooms.values()][0];
  b.send({ type: 'join', room: room.id, name: 'Guest' });
  a.send({ type: 'select', character: 'paeng' }); b.send({ type: 'select', character: 'gu' });
  return { h, a, b, room };
}
function ready(p: ReturnType<typeof pair>) { p.a.send({ type: 'ready', ready: true }); p.b.send({ type: 'ready', ready: true }); }

describe('public online rooms', () => {
  it('lists public rooms without an account and assigns a host', () => {
    const { h, a, b, room } = pair(); const c = guest(h);
    expect(room.members).toHaveLength(2); expect(room.host).toBe(a.id);
    expect(c.messages.some(m => m.type === 'rooms' && m.rooms[0].members.length === 2)).toBe(true);
    b.send({ type: 'settings', mode: 'teams' }); expect(room.mode).toBe('ffa');
  });
  it('atomically locks a character for the first ready player and releases on cancel', () => {
    const { a, b, room } = pair();
    b.send({ type: 'select', character: 'paeng' });
    a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
    expect(room.members[0].ready).toBe(true); expect(room.members[1].character).toBeNull(); expect(room.members[1].ready).toBe(false);
    b.send({ type: 'select', character: 'paeng' }); expect(room.members[1].character).toBeNull();
    a.send({ type: 'ready', ready: false }); b.send({ type: 'select', character: 'paeng' }); expect(room.members[1].character).toBe('paeng');
  });
  it('requires every guest including the host to be ready and only host can start', () => {
    const p = pair(); p.a.send({ type: 'start' }); expect(p.room.playing).toBe(false);
    p.b.send({ type: 'ready', ready: true }); p.a.send({ type: 'start' }); expect(p.room.playing).toBe(false);
    ready(p); p.b.send({ type: 'start' }); expect(p.room.playing).toBe(false);
    p.a.send({ type: 'start' }); expect(p.room.playing).toBe(true);
    expect(p.room.game!.players.map(x => x.team)).toEqual([0, 1]);
  });
  it('requires both teams, resets readiness on room settings changes', () => {
    const p = pair('teams'); p.b.send({ type: 'team', team: 'blue' }); ready(p);
    p.a.send({ type: 'start' }); expect(p.room.playing).toBe(false);
    p.b.send({ type: 'ready', ready: false }); p.b.send({ type: 'team', team: 'red' }); p.b.send({ type: 'ready', ready: true });
    p.a.send({ type: 'settings', map: 'moon_base' }); expect(p.room.members.every(m => !m.ready)).toBe(true);
    ready(p); p.a.send({ type: 'start' }); expect(p.room.playing).toBe(true);
  });
  it('rejects forged kicks, locks kicked sessions out, transfers host when leaving', () => {
    const { h, a, b, room } = pair(); const c = guest(h); c.send({ type: 'join', room: room.id, name: 'Third' });
    b.send({ type: 'kick', player: a.id }); expect(room.members).toHaveLength(3);
    a.send({ type: 'kick', player: b.id }); expect(room.members).toHaveLength(2);
    b.send({ type: 'join', room: room.id, name: 'Again' }); expect(room.members).toHaveLength(2);
    h.disconnect(b.id); const reconnect = guest(h, b.token); reconnect.send({ type: 'join', room: room.id, name: 'Again' }); expect(room.members).toHaveLength(2);
    a.send({ type: 'leave' }); expect(room.host).toBe(c.id);
    c.send({ type: 'leave' }); expect(h.rooms.size).toBe(0);
  });
  it('caps rooms at eight and disallows joining running matches', () => {
    const p = pair(); for (let i = 0; i < 8; i++) guest(p.h).send({ type: 'join', room: p.room.id, name: 'Guest' });
    expect(p.room.members).toHaveLength(8);
    const q = pair(); ready(q); q.a.send({ type: 'start' }); guest(q.h).send({ type: 'join', room: q.room.id, name: 'Late' }); expect(q.room.members).toHaveLength(2);
  });
});

describe('server-authorized combat', () => {
  it('replays movement, aim, a shot and terrain destruction identically on two clients', () => {
    const p = pair(); ready(p); p.a.send({ type: 'start' });
    const start = p.a.messages.find(m => m.type === 'start') as StartMatch;
    const clones = [new Game(start.options), new Game(start.options)];
    let cursor = p.a.messages.length;
    const tick = () => {
      p.h.advance();
      for (const m of p.a.messages.slice(cursor)) if (m.type === 'frame') for (const g of clones) {
        expect(g.tick).toBe(m.from);
        for (const cmds of m.steps) { cmds.forEach(c => applyCommand(g, c)); g.step(); g.events = []; }
      }
      cursor = p.a.messages.length;
    };
    while (!p.room.game!.canControl) tick();
    const g = p.room.game!, actor = g.current === 0 ? p.a : p.b, other = g.current === 0 ? p.b : p.a;
    other.send({ type: 'command', turn: g.turnNumber, action: { kind: 'fire', weapon: 'basic', power: 50 } }); expect(p.room.queue).toHaveLength(0);
    actor.send({ type: 'command', turn: g.turnNumber - 1, action: { kind: 'skip' } }); expect(p.room.queue).toHaveLength(0);
    actor.send({ type: 'command', turn: g.turnNumber, action: { kind: 'fire', weapon: 'basic', power: Infinity } }); expect(p.room.queue).toHaveLength(0);
    actor.send({ type: 'command', turn: g.turnNumber, action: { kind: 'input', move: 1, aim: -1 } }); for (let i = 0; i < 10; i++) tick();
    actor.send({ type: 'command', turn: g.turnNumber, action: { kind: 'input', move: 0, aim: 0 } });
    actor.send({ type: 'command', turn: g.turnNumber, action: { kind: 'fire', weapon: 'basic', power: 35 } });
    for (let i = 0; i < 140; i++) tick();
    for (const client of clones) {
      expect(client.players).toEqual(g.players); expect(client.phase).toBe(g.phase);
      expect(Buffer.compare(Buffer.from(client.terrain.mask), Buffer.from(g.terrain.mask))).toBe(0); expect(client.terrain.version).toBeGreaterThan(0);
    }
  });
  it('forfeits disconnected players and unlocks a completed room for another match', () => {
    const p = pair(); ready(p); p.a.send({ type: 'start' });
    const g = p.room.game!; p.h.disconnect(p.b.id); p.h.advance();
    expect(g.players[1].alive).toBe(false); expect(g.winnerTeam).toBe(0); expect(p.room.playing).toBe(false);
    expect(p.room.members[0].ready).toBe(false);
    const frame = p.a.messages.filter(m => m.type === 'frame').at(-1) as Frame;
    expect(frame.steps[0]).toContainEqual({ forfeit: 1 });
  });
});
