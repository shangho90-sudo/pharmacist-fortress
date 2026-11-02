import { beforeEach, expect, it, vi } from 'vitest';

let players: any[];
let hidden: boolean;
let visibility: () => void;
let gains: any[];
beforeEach(() => {
  vi.resetModules();
  players = []; gains = []; hidden = false;
  class Player {
    src = ''; loop = false; preload = ''; paused = true;
    play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
    pause = vi.fn(() => { this.paused = true; });
    constructor() { players.push(this); }
  }
  class Context {
    currentTime = 0; sampleRate = 10; destination = {}; state = 'running';
    createGain() {
      const g = { gain: { setTargetAtTime: vi.fn() }, connect: vi.fn() };
      gains.push(g); return g;
    }
    createBuffer() { return { getChannelData: () => new Float32Array(10) }; }
    createMediaElementSource() { return { connect: vi.fn() }; }
  }
  vi.stubGlobal('window', { AudioContext: Context });
  vi.stubGlobal('Audio', Player);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('document', { get hidden() { return hidden; }, addEventListener: (_: string, cb: () => void) => { visibility = cb; } });
});

it('starts the pending title after the first gesture and switches without duplicate players', async () => {
  const { audio } = await import('../src/game/audio');
  audio.playBgm('title');
  expect(players).toHaveLength(0);
  audio.unlock();
  const p = players[0];
  expect(p.src).toMatch(/audio\/title.mp3$/);
  expect(p.loop).toBe(true);
  expect(p.paused).toBe(false);
  audio.playBgm('title');
  expect(p.play).toHaveBeenCalledTimes(1);
  audio.playBgm('battle');
  expect(players).toHaveLength(1);
  expect(p.pause).toHaveBeenCalledTimes(1);
  expect(p.src).toMatch(/audio\/battle.mp3$/);
  audio.playBgm('title');
  expect(p.src).toMatch(/audio\/title.mp3$/);
  audio.playBgm(null);
  audio.unlock();
  expect(p.paused).toBe(true);
});

it('pauses hidden tabs, resumes, and routes volume and mute through the music gain', async () => {
  const { audio } = await import('../src/game/audio');
  audio.playBgm('battle'); audio.unlock();
  hidden = true; visibility();
  expect(players[0].paused).toBe(true);
  hidden = false; visibility();
  expect(players[0].paused).toBe(false);
  audio.setMusicVolume(0.8);
  expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.8 * 0.35, 0, 0.05);
  audio.setMuted(true);
  expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.05);
});

it('retries playback after a blocked autoplay attempt', async () => {
  const { audio } = await import('../src/game/audio');
  audio.unlock();
  players[0].play.mockImplementationOnce(() => Promise.reject(new Error('blocked')));
  audio.playBgm('title');
  await Promise.resolve();
  audio.unlock();
  expect(players[0].play).toHaveBeenCalledTimes(2);
  expect(players[0].paused).toBe(false);
});
