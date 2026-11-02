import { beforeEach, expect, it, vi } from 'vitest';

let players: any[];
let hidden: boolean;
let visibility: () => void;
let gains: any[];
let sources: any[];
beforeEach(() => {
  vi.resetModules();
  players = []; gains = []; sources = []; hidden = false;
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
    decodeAudioData() { return Promise.resolve({ decoded: true }); }
    createBufferSource() {
      const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
      sources.push(source); return source;
    }
    createMediaElementSource() { return { connect: vi.fn() }; }
  }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
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


it('caches character voices and stops the previous line before a new attack', async () => {
  const { audio } = await import('../src/game/audio');
  audio.unlock();
  await audio.attackVoice('paeng');
  expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/voices\/paeng.mp3$/));
  expect(sources[0].connect).toHaveBeenCalledWith(gains[2]);
  expect(sources[0].start).toHaveBeenCalledOnce();
  await audio.attackVoice('du');
  expect(sources[0].stop).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenLastCalledWith(expect.stringMatching(/voices\/du.mp3$/));
  await audio.attackVoice('paeng');
  expect(fetch).toHaveBeenCalledTimes(2);
  audio.stopVoice();
  expect(sources[2].stop).toHaveBeenCalledOnce();
});

it('cancels delayed speech when leaving battle and skips muted or hidden attacks', async () => {
  const { audio } = await import('../src/game/audio');
  audio.unlock();
  const pending = audio.attackVoice('jo');
  audio.stopVoice();
  await pending;
  expect(sources).toHaveLength(0);
  audio.setMuted(true);
  await audio.attackVoice('gu');
  audio.setMuted(false);
  hidden = true;
  await audio.attackVoice('gu');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('a missing voice never interrupts combat and can be retried', async () => {
  const { audio } = await import('../src/game/audio');
  audio.unlock();
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  await audio.attackVoice('bang');
  expect(sources).toHaveLength(0);
  await audio.attackVoice('bang');
  expect(sources[0].start).toHaveBeenCalledOnce();
});
