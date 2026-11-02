import { expect, it } from 'vitest';
import { OnlinePlayback } from '../src/online/playback';
import { applyCommand, type Frame, type StartMatch } from '../src/online/protocol';
import { RoomHub } from '../server/rooms';
import { Game } from '../src/core/game';

const packet = (from: number, length = 6): Frame => ({ type: 'frame', match: 'test', from, steps: Array.from({ length }, () => []) });

it('spreads 20 Hz packets over 60 rendered frames instead of jumping six ticks at once', () => {
  const replay = new OnlinePlayback();
  let received = 0, played = 0;
  const increments: number[] = [];
  for (let frame = 0; frame < 180; frame++) {
    if (frame % 3 === 0) { replay.receive(packet(received)); received += 6; }
    increments.push(replay.advance(1 / 60, () => played++));
    expect(played).toBeLessThanOrEqual(received);
  }
  expect(increments.slice(6).every(n => n === 2)).toBe(true);
  expect(received - played).toBeLessThanOrEqual(12);
});

it('preserves command order through uneven delivery and bounded catch-up', () => {
  const replay = new OnlinePlayback(), consumed: number[] = [];
  for (let from = 0; from < 600; from += 6) {
    const frame = packet(from);
    frame.steps = frame.steps.map((_, i) => [{ forfeit: from + i }]);
    expect(replay.receive(frame)).toBe(true);
  }
  let budget = 7;
  expect(replay.advance(0.25, commands => consumed.push((commands[0] as { forfeit: number }).forfeit), () => budget-- > 0)).toBe(7);
  while (replay.pendingTicks) replay.advance(0.25, commands => consumed.push((commands[0] as { forfeit: number }).forfeit));
  expect(consumed).toEqual(Array.from({ length: 600 }, (_, i) => i));
  expect(replay.receive(packet(594))).toBe(false);
  expect(replay.receive(packet(606))).toBe(false);
});

it('plays a final short packet even when a match ends before the startup buffer fills', () => {
  const replay = new OnlinePlayback();
  replay.receive(packet(0, 1));
  let played = 0;
  for (let i = 0; i < 10; i++) replay.advance(1 / 60, () => played++);
  expect(played).toBe(1);
  expect(replay.alpha).toBe(1);
});

it('keeps the server and guest advancing while the host renders at 10 FPS or stalls', () => {
  const hub = new RoomHub(), fast = new OnlinePlayback(), slow = new OnlinePlayback();
  let start!: StartMatch;
  const host = hub.connect(m => { if (m.type === 'start') start = m; if (m.type === 'frame') slow.receive(m); });
  const guest = hub.connect(m => { if (m.type === 'frame') fast.receive(m); });
  hub.handle(host, { type: 'create', name: 'Host' });
  const room = [...hub.rooms.values()][0];
  hub.handle(guest, { type: 'join', room: room.id, name: 'Guest' });
  hub.handle(host, { type: 'select', character: 'paeng' });
  hub.handle(guest, { type: 'select', character: 'gu' });
  for (const id of [host, guest]) hub.handle(id, { type: 'ready', ready: true });
  hub.handle(host, { type: 'start' });
  const server = room.game!, hostGame = new Game(start.options), guestGame = new Game(start.options);
  const consume = (game: Game) => (commands: Frame['steps'][number]) => {
    commands.forEach(command => applyCommand(game, command)); game.step(); game.events = [];
  };
  for (let frame = 0; frame < 360; frame++) {
    if (frame === 90) {
      const actor = server.current === 0 ? host : guest;
      hub.handle(actor, { type: 'command', turn: server.turnNumber, action: { kind: 'fire', weapon: 'basic', power: 35 } });
    }
    if (frame % 3 === 0) hub.advance();
    fast.advance(1 / 60, consume(guestGame));
    // Host has a two-second rendering stall; server and guest continue normally.
    if (frame % 6 === 0 && !(frame >= 120 && frame < 240)) slow.advance(0.1, consume(hostGame));
    if (frame === 239) {
      expect(server.tick).toBe(480);
      expect(server.tick - guestGame.tick).toBeLessThan(20);
      expect(server.tick - hostGame.tick).toBeGreaterThan(220);
    }
  }
  for (const [replay, game] of [[fast, guestGame], [slow, hostGame]] as const) {
    while (replay.pendingTicks) replay.advance(0.25, consume(game));
    expect(game.tick).toBe(server.tick);
    expect(game.players).toEqual(server.players);
    expect(Buffer.compare(Buffer.from(game.terrain.mask), Buffer.from(server.terrain.mask))).toBe(0);
  }
  expect(server.tick).toBe(720);
});
