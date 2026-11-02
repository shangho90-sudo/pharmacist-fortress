// WebAudio 합성 사운드: 외부 파일 없이 효과음과 BGM을 생성한다. 음악/효과음 볼륨 별도 조절.
type BgmKind = 'title' | 'battle' | null;

const store = {
  get(k: string, d: number) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : Math.max(0, Math.min(1, parseFloat(v)));
    } catch {
      return d;
    }
  },
  set(k: string, v: number) {
    try {
      localStorage.setItem(k, String(v));
    } catch {
      /* 저장소 사용 불가 환경 */
    }
  },
};

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  musicVolume = store.get('pf_music', 0.45);
  sfxVolume = store.get('pf_sfx', 0.7);
  muted = false;
  private bgm: BgmKind = null;
  private bgmTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private whistle: { osc: OscillatorNode; gain: GainNode } | null = null;

  /** 사용자 제스처 이후 호출 (브라우저 자동재생 정책) */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.applyVolumes();
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMusicVolume(v: number) {
    this.musicVolume = v;
    store.set('pf_music', v);
    this.applyVolumes();
  }
  setSfxVolume(v: number) {
    this.sfxVolume = v;
    store.set('pf_sfx', v);
    this.applyVolumes();
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(this.muted ? 0 : this.musicVolume * 0.35, t, 0.05);
    this.sfxGain.gain.setTargetAtTime(this.muted ? 0 : this.sfxVolume, t, 0.02);
  }

  private noise(dur: number, filterFreq: number, endFreq: number, vol: number, type: BiquadFilterType = 'lowpass', delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, endFreq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, dest?: AudioNode) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  fire(special = false) {
    this.noise(0.25, 2500, 300, 0.5);
    this.tone(special ? 180 : 240, 60, 0.22, 0.5, 'triangle');
    if (special) {
      this.tone(400, 1600, 0.35, 0.18, 'sawtooth');
      this.tone(800, 2400, 0.3, 0.12, 'square', 0.05);
    }
  }

  explosion(size: number) {
    const big = size > 50;
    this.noise(big ? 1.4 : 0.8, big ? 1800 : 2600, 60, big ? 0.95 : 0.75);
    this.tone(big ? 70 : 110, 30, big ? 0.9 : 0.5, big ? 0.9 : 0.6, 'sine');
    this.noise(0.12, 6000, 2000, 0.25, 'highpass');
    if (big) this.noise(1.6, 400, 50, 0.4, 'lowpass', 0.08);
  }

  /** 포탄 비행음 시작/갱신/종료 */
  whistleStart() {
    if (!this.ctx || this.whistle) return;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.1);
    o.connect(g).connect(this.sfxGain);
    o.start();
    this.whistle = { osc: o, gain: g };
  }
  whistleUpdate(vy: number) {
    if (!this.ctx || !this.whistle) return;
    const f = 700 - Math.max(-600, Math.min(600, vy)) * 0.5;
    this.whistle.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
  }
  whistleStop() {
    if (!this.ctx || !this.whistle) return;
    const w = this.whistle;
    w.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    w.osc.stop(this.ctx.currentTime + 0.2);
    this.whistle = null;
  }

  hit() {
    this.tone(520, 180, 0.15, 0.3, 'square');
  }
  click() {
    this.tone(880, 1200, 0.06, 0.15, 'square');
  }
  turn() {
    this.tone(660, 660, 0.12, 0.18, 'triangle');
    this.tone(990, 990, 0.18, 0.18, 'triangle', 0.1);
  }
  tick() {
    this.tone(1400, 1400, 0.05, 0.1, 'square');
  }
  charge(p: number) {
    this.tone(300 + p * 9, 300 + p * 9, 0.04, 0.05, 'square');
  }
  splash(lava: boolean) {
    if (lava) {
      this.noise(0.6, 900, 120, 0.5);
      this.tone(90, 40, 0.5, 0.4, 'sawtooth');
    } else {
      this.noise(0.5, 3000, 400, 0.5, 'bandpass');
      this.tone(600, 200, 0.2, 0.15, 'sine', 0.05);
    }
  }
  strike(style: 'lightning' | 'beam' | 'sky') {
    if (style === 'lightning') {
      this.noise(0.35, 6000, 800, 0.6, 'highpass');
      this.tone(90, 40, 0.4, 0.4, 'sawtooth');
    } else {
      this.tone(1200, 300, 0.5, 0.2, 'sine');
      this.noise(0.5, 3000, 300, 0.4);
    }
  }
  dragon() {
    this.tone(120, 60, 1.0, 0.35, 'sawtooth');
    this.noise(1.2, 900, 200, 0.4);
  }
  teleport() {
    this.tone(200, 1400, 0.25, 0.18, 'triangle');
    this.tone(1400, 300, 0.3, 0.12, 'sine', 0.2);
  }
  land() {
    this.noise(0.12, 800, 200, 0.25);
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.3, 0.25, 'triangle', i * 0.12));
    this.tone(1047, 1047, 0.8, 0.2, 'square', 0.5);
  }
  lose() {
    [494, 440, 392, 330].forEach((f, i) => this.tone(f, f * 0.98, 0.4, 0.22, 'triangle', i * 0.22));
  }

  // ───────────── BGM (룩어헤드 스케줄러) ─────────────
  playBgm(kind: BgmKind) {
    if (this.bgm === kind) return;
    this.bgm = kind;
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (!kind || !this.ctx) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.bgmTimer = window.setInterval(() => this.schedule(), 50);
  }

  private schedule() {
    if (!this.ctx || !this.bgm) return;
    const battle = this.bgm === 'battle';
    const bpm = battle ? 132 : 96;
    const sixteenth = 60 / bpm / 4;
    // I–V–vi–IV (C장조) / 전투: vi–IV–I–V (a단조 느낌)
    const prog = battle
      ? [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
      : [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
    while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
      const bar = Math.floor(this.step / 16) % 4;
      const s = this.step % 16;
      const chord = prog[bar];
      const t = this.nextNoteTime - this.ctx.currentTime;
      const mf = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
      // 베이스
      if (s % (battle ? 2 : 4) === 0) this.tone(mf(chord[0] - 12), mf(chord[0] - 12), sixteenth * (battle ? 1.8 : 3.5), 0.22, 'triangle', t, this.musicGain);
      // 아르페지오
      const arp = [0, 1, 2, 1][s % 4];
      if (battle || s % 2 === 0) this.tone(mf(chord[arp] + 12), mf(chord[arp] + 12), sixteenth * 1.6, battle ? 0.07 : 0.08, 'square', t, this.musicGain);
      // 멜로디 포인트
      if (s === 0 || s === 10) this.tone(mf(chord[2] + 24), mf(chord[2] + 24), sixteenth * 4, 0.05, 'triangle', t, this.musicGain);
      // 드럼(전투)
      if (battle && this.ctx && s % 4 === 0) {
        const tt = t;
        this.tone(140, 45, 0.12, 0.25, 'sine', tt, this.musicGain);
      }
      this.nextNoteTime += sixteenth;
      this.step++;
    }
  }
}

export const audio = new AudioEngine();
