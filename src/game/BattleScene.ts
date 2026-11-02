import Phaser from 'phaser';
import { planShot, type AiPlan } from '../core/ai';
import { CHAR_TYPES, CHAR_LIST, type CharTypeId } from '../core/characters';
import { DT, MAX_GAUGE, MUZZLE_HEIGHT, MUZZLE_LENGTH, TICK_RATE } from '../core/constants';
import { Game, type GameEvent, type Player, type PlayerSetup } from '../core/game';
import { cosDeg, sinDeg } from '../core/physics';
import { WEAPONS, type WeaponId } from '../core/weapons';
import { CHAR_SCALE, drawGun, drawProjectile, GUN_H, GUN_PIVOT_X, GUN_PIVOT_Y, GUN_W, makeCanvas, pixelSquare, smokePuff, softCircle } from './art';
import { audio } from './audio';
import { buildForestLayers, cloudsCanvas, skyCanvas } from './background';
import { Effects } from './effects';
import { TerrainView } from './terrainView';

export const VIEW_W = 960; // 월드 기준 화면 폭 (줌 2 → 캔버스 1920)
export const VIEW_H = 540;
export const ZOOM = 2;
const CAM_TOP = -420;
const CHARGE_TIME = 2.0; // 파워 0→100 (초)

export interface BattleConfig {
  seed: number;
  players: PlayerSetup[];
  demo?: boolean;
}

export interface BattleHooks {
  onGameOver?(g: Game): void;
  onEvent?(e: GameEvent, g: Game): void;
}

interface CharView {
  body: Phaser.GameObjects.Image;
  gun: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  shownHp: number;
  lastX: number;
  walkDist: number;
  hitTimer: number;
  shootTimer: number;
  blinkTimer: number;
  knock: number;
  fallen: boolean;
}

type CamMode = 'player' | 'projectile' | 'point' | 'free';

export class BattleScene extends Phaser.Scene {
  game2!: Game;
  cfg!: BattleConfig;
  hooks: BattleHooks = {};
  private terrainView: TerrainView | null = null;
  private views: CharView[] = [];
  private projSprites = new Map<number, { img: Phaser.GameObjects.Image; trail: Phaser.GameObjects.Particles.ParticleEmitter }>();
  private fx!: Effects;
  private acc = 0;
  private bgImages: { img: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite; factor: number; y: number; kind: 'layer' | 'sky' | 'cloud' }[] = [];
  private aimGfx!: Phaser.GameObjects.Graphics;
  private marker!: Phaser.GameObjects.Image;
  private ambient: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private worldObjs: Phaser.GameObjects.GameObject[] = [];

  // 카메라
  private camX = 0;
  private camY = 0;
  private camMode: CamMode = 'player';
  private camPoint = { x: 0, y: 0 };
  private camHold = 0;
  private dragging: { x: number; y: number; cx: number; cy: number } | null = null;

  // 입력
  private keyMove = 0;
  private keyAim = 0;
  private touchMove = 0;
  private touchAim = 0;
  charging = false;
  charge = 0;
  private chargeStart = 0;
  selected: 'basic' | 'special' = 'basic';
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastTickSecond = -1;

  // AI
  private ai: { state: 'think' | 'turn' | 'aim' | 'charge' | 'done'; t: number; plan: AiPlan | null } = { state: 'done', t: 0, plan: null };
  private overTimer = -1;
  silent = false;
  paused = false;
  onReady: (() => void) | null = null;

  constructor() {
    super('battle');
  }

  preload() {
    for (const id of CHAR_LIST) this.load.image(`char_${id}`, `chars/${id}.png`);
  }

  create() {
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.setBackgroundColor('#2a6f8c');
    this.makeTextures();
    this.fx = new Effects(this);
    this.aimGfx = this.add.graphics().setDepth(25);
    this.marker = this.add.image(0, 0, 'ui_marker').setDepth(45).setVisible(false);
    this.setupInput();
    this.onReady?.();
  }

  // ───────────────────────── 텍스처 ─────────────────────────
  private makeTextures() {
    const add = (key: string, c: HTMLCanvasElement) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, c);
    };
    for (const id of CHAR_LIST) {
      const def = CHAR_TYPES[id];
      const g = makeCanvas(GUN_W, GUN_H);
      drawGun(g.getContext('2d')!, def.gun, def.palette);
      add(`gun_${id}`, g);
      for (const w of Object.values(WEAPONS)) add(`proj_${w.id}_${id}`, drawProjectile(w.look, w.color ?? def.palette.accent));
    }
    add('fx_soft', softCircle(64));
    add('fx_px', pixelSquare(2));
    add('fx_smoke', smokePuff(64));
    add('fx_dot', softCircle(8, 0.3));
    const m = document.createElement('canvas');
    m.width = 11;
    m.height = 9;
    const mc = m.getContext('2d')!;
    const rows = ['11111111111', '12222222221', '01222222210', '00122222100', '00012221000', '00001210000', '00000100000'];
    rows.forEach((r, y) =>
      [...r].forEach((ch, x) => {
        if (ch === '0') return;
        mc.fillStyle = ch === '1' ? '#3a1020' : '#ffd23f';
        mc.fillRect(x, y + 1, 1, 1);
      }),
    );
    add('ui_marker', m);
  }

  // ───────────────────────── 전투 시작 ─────────────────────────
  startBattle(cfg: BattleConfig, hooks: BattleHooks = {}) {
    this.clearWorld();
    this.cfg = cfg;
    this.hooks = hooks;
    this.silent = !!cfg.demo;
    this.game2 = new Game({ seed: cfg.seed, players: cfg.players });
    const g = this.game2;
    this.buildBackground(cfg.seed);
    this.terrainView = new TerrainView(this, g.terrain, g.surface, cfg.seed, 0);
    this.views = g.players.map((p) => this.makeCharView(p));
    this.acc = 0;
    this.charge = 0;
    this.charging = false;
    this.selected = 'basic';
    this.overTimer = -1;
    this.paused = false;
    this.ai = { state: 'done', t: 0, plan: null };
    const cp = g.currentPlayer;
    this.camX = cp.x;
    this.camY = cp.y - 60;
    this.camMode = 'player';
    this.applyCamera();
    // 시작 이벤트 처리
    this.processEvents();
  }

  private clearWorld() {
    for (const o of this.worldObjs) o.destroy();
    this.worldObjs = [];
    this.bgImages = [];
    for (const v of this.views) {
      v.body.destroy();
      v.gun.destroy();
      v.label.destroy();
      v.hpBar.destroy();
    }
    this.views = [];
    for (const s of this.projSprites.values()) {
      s.img.destroy();
      s.trail.destroy();
    }
    this.projSprites.clear();
    this.terrainView?.destroy();
    this.terrainView = null;
    this.ambient?.destroy();
    this.ambient = null;
    audio.whistleStop();
  }

  private buildBackground(seed: number) {
    const g = this.game2;
    const skyKey = 'bg_sky';
    if (!this.textures.exists(skyKey)) this.textures.addCanvas(skyKey, skyCanvas(VIEW_W, VIEW_H));
    const sky = this.add.image(0, 0, skyKey).setOrigin(0).setDepth(-100);
    this.bgImages.push({ img: sky, factor: 0, y: 0, kind: 'sky' });
    const cloudKey = `bg_cloud_${seed}`;
    if (!this.textures.exists(cloudKey)) this.textures.addCanvas(cloudKey, cloudsCanvas(1024, 200, seed));
    const cl = this.add.tileSprite(0, 0, VIEW_W, 200, cloudKey).setOrigin(0).setDepth(-95).setAlpha(0.9);
    this.bgImages.push({ img: cl, factor: 0.05, y: 30, kind: 'cloud' });
    const layers = buildForestLayers(VIEW_W, VIEW_H, g.worldW, g.worldH, CAM_TOP, seed);
    layers.forEach((l, i) => {
      const key = `bg_layer_${seed}_${i}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, l.canvas);
      const img = this.add.image(0, 0, key).setOrigin(0).setDepth(-90 + i);
      this.bgImages.push({ img, factor: l.factor, y: l.y, kind: 'layer' });
    });
    for (const b of this.bgImages) this.worldObjs.push(b.img);
    // 맵 하단 심연 그라디언트
    const abyssKey = 'bg_abyss';
    if (!this.textures.exists(abyssKey)) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 120;
      const ctx = c.getContext('2d')!;
      const gr = ctx.createLinearGradient(0, 0, 0, 120);
      gr.addColorStop(0, 'rgba(20,10,30,0)');
      gr.addColorStop(1, 'rgba(20,10,30,0.95)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 4, 120);
      this.textures.addCanvas(abyssKey, c);
    }
    const ab = this.add.image(0, g.worldH - 120, abyssKey).setOrigin(0).setDisplaySize(g.worldW, 120).setDepth(-5);
    this.worldObjs.push(ab);
    // 떠다니는 포자 (분위기)
    this.ambient = this.add.particles(0, 0, 'fx_dot', {
      x: { min: 0, max: g.worldW },
      y: { min: -200, max: g.worldH - 200 },
      lifespan: 6000,
      speedX: { min: -8, max: 8 },
      speedY: { min: -14, max: -4 },
      scale: { min: 0.3, max: 0.8 },
      alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) * 0.8 } as any,
      tint: [0xe8ffb0, 0xb0ffd8, 0xfff2a0],
      blendMode: 'ADD',
      frequency: 60,
    });
    this.ambient.setDepth(-3);
  }

  private makeCharView(p: Player): CharView {
    const body = this.add.image(p.x, p.y, `char_${p.charType}`).setOrigin(0.5, 1).setDepth(10).setScale(CHAR_SCALE);
    const gun = this.add.image(p.x, p.y - MUZZLE_HEIGHT, `gun_${p.charType}`).setOrigin(GUN_PIVOT_X / GUN_W, GUN_PIVOT_Y / GUN_H).setDepth(11);
    const teamColor = p.team === 0 ? '#7fd4ff' : '#ff9a9a';
    const label = this.add
      .text(p.x, p.y - 72, p.name, { fontFamily: '"Noto Sans KR", sans-serif', fontSize: '8px', fontStyle: 'bold', color: teamColor, stroke: '#0b0814', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setDepth(40)
      .setResolution(4);
    const hpBar = this.add.graphics().setDepth(40);
    return { body, gun, label, hpBar, shownHp: p.hp, lastX: p.x, walkDist: 0, hitTimer: 0, shootTimer: 0, blinkTimer: 0, knock: 0, fallen: false };
  }

  // ───────────────────────── 입력 ─────────────────────────
  private setupInput() {
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys({
      left: 'LEFT',
      right: 'RIGHT',
      up: 'UP',
      down: 'DOWN',
      a: 'A',
      d: 'D',
      w: 'W',
      s: 'S',
      space: 'SPACE',
      one: 'ONE',
      two: 'TWO',
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    kb.addCapture(['SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
    this.keys.space.on('down', () => this.startCharge());
    this.keys.space.on('up', () => this.releaseCharge());
    this.keys.one.on('down', () => this.selectWeapon('basic'));
    this.keys.two.on('down', () => this.selectWeapon('special'));
    // 드래그로 맵 둘러보기
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = { x: p.x, y: p.y, cx: this.camX, cy: this.camY };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      const dx = (p.x - this.dragging.x) / ZOOM,
        dy = (p.y - this.dragging.y) / ZOOM;
      if (this.camMode !== 'free' && Math.hypot(dx, dy) < 6) return;
      if (this.camMode === 'projectile') return;
      this.camMode = 'free';
      this.camX = this.dragging.cx - dx;
      this.camY = this.dragging.cy - dy;
    });
    this.input.on('pointerup', () => (this.dragging = null));
  }

  /** 현재 턴이 이 기기의 사람 플레이어인가 */
  isLocalTurn(): boolean {
    const g = this.game2;
    return !!g && !this.cfg.demo && g.currentPlayer.controller === 'human' && g.phase !== 'over';
  }

  setTouchMove(d: number) {
    this.touchMove = d;
  }
  setTouchAim(d: number) {
    this.touchAim = d;
  }
  selectWeapon(w: 'basic' | 'special') {
    if (!this.isLocalTurn()) return;
    if (w === 'special' && this.game2.currentPlayer.gauge < MAX_GAUGE) return;
    this.selected = w;
    if (!this.silent) audio.click();
  }
  startCharge() {
    audio.unlock();
    if (!this.isLocalTurn() || !this.game2.canControl || this.charging || this.paused) return;
    if (!this.game2.currentPlayer.grounded) return;
    this.charging = true;
    this.charge = 0;
    this.chargeStart = performance.now();
    if (this.camMode === 'free') this.camMode = 'player';
  }
  releaseCharge() {
    if (!this.charging) return;
    this.charging = false;
    if (!this.isLocalTurn() || !this.game2.canControl) return;
    this.game2.fire(this.selected, this.charge);
  }
  skipTurn() {
    if (this.isLocalTurn()) this.game2.skipTurn();
  }

  private applyHumanInput() {
    const g = this.game2;
    if (!this.isLocalTurn() || !g.canControl || this.paused) {
      if (this.charging && !g.canControl) this.charging = false;
      return;
    }
    const k = this.keys;
    this.keyMove = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    this.keyAim = (k.up.isDown || k.w.isDown ? 1 : 0) - (k.down.isDown || k.s.isDown ? 1 : 0);
    const move = this.charging ? 0 : Math.sign(this.keyMove || this.touchMove);
    const aim = Math.sign(this.keyAim || this.touchAim);
    g.setInput({ move: move as -1 | 0 | 1, aim: aim as -1 | 0 | 1 });
    if (move !== 0 && this.camMode === 'free') this.camMode = 'player';
    if (this.charging) {
      const before = this.charge;
      // 실제 경과 시간 기준(프레임 저하와 무관)
      this.charge = Math.min(100, ((performance.now() - this.chargeStart) / 1000 / CHARGE_TIME) * 100);
      if (!this.silent && Math.floor(before / 10) !== Math.floor(this.charge / 10)) audio.charge(this.charge);
    }
  }

  // ───────────────────────── AI ─────────────────────────
  private updateAi(dt: number) {
    const g = this.game2;
    const p = g.currentPlayer;
    if (g.phase !== 'aiming' || p.controller !== 'ai' && !this.cfg.demo) return;
    if (this.paused) return;
    const ai = this.ai;
    ai.t += dt;
    switch (ai.state) {
      case 'think':
        if (ai.t > 0.8) {
          ai.plan = planShot(g, g.tick * 7919 + g.seed);
          ai.state = 'turn';
          ai.t = 0;
        }
        break;
      case 'turn':
        if (ai.plan && p.facing !== ai.plan.facing) g.setFacing(ai.plan.facing);
        if (ai.t > 0.25) {
          ai.state = 'aim';
          ai.t = 0;
        }
        break;
      case 'aim': {
        // 목표 각도로 직접 보간(프레임 속도와 무관, 오버슈트 없음)
        const target = ai.plan!.angle;
        const diff = target - p.angle;
        const stepA = 40 * dt;
        g.setInput({ aim: 0 });
        g.setAngle(Math.abs(diff) <= stepA ? target : p.angle + Math.sign(diff) * stepA);
        if (Math.abs(target - p.angle) < 1e-6) {
          if (ai.t > 0.2) {
            ai.state = 'charge';
            ai.t = 0;
            this.charge = 0;
            this.charging = true;
            if (ai.plan!.weapon === 'special') this.selected = 'special';
          }
        } else ai.t = 0;
        break;
      }
      case 'charge':
        this.charge = Math.min(ai.plan!.power, this.charge + (100 / CHARGE_TIME) * dt);
        if (this.charge >= ai.plan!.power - 1e-6) {
          this.charging = false;
          g.fire(ai.plan!.weapon, ai.plan!.power);
          ai.state = 'done';
        }
        break;
    }
  }

  // ───────────────────────── 메인 루프 ─────────────────────────
  private lastNow = 0;

  update() {
    const g = this.game2;
    if (!g) return;
    // 실제 경과 시간(벽시계) 기준. 느린 기기에서도 게임 속도가 유지되도록 프레임당 최대 0.25초까지 따라잡는다.
    const now = performance.now();
    const dt = this.lastNow ? Math.min(0.25, (now - this.lastNow) / 1000) : 1 / 60;
    this.lastNow = now;
    if (!this.paused) {
      this.applyHumanInput();
      this.updateAi(dt);
      // 고정 타임스텝 누적기 → 프레임 속도와 무관한 결정론적 시뮬레이션
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 40) {
        g.step();
        this.acc -= DT;
        steps++;
        this.processEvents();
      }
      if (steps >= 40) this.acc = 0;
    }
    this.renderWorld(dt);
    this.updateCamera(dt);
    this.updateParallax();
    if (this.overTimer >= 0) {
      this.overTimer -= dt;
      if (this.overTimer < 0) this.hooks.onGameOver?.(g);
    }
    // 마지막 5초 경고음
    if (g.phase === 'aiming' && this.isLocalTurn()) {
      const sec = Math.ceil(g.turnTicksLeft / TICK_RATE);
      if (sec <= 5 && sec !== this.lastTickSecond && !this.silent) audio.tick();
      this.lastTickSecond = sec;
    }
  }

  private processEvents() {
    const g = this.game2;
    if (!g.events.length) return;
    const evs = g.events.splice(0);
    for (const e of evs) {
      this.handleEvent(e);
      this.hooks.onEvent?.(e, g);
    }
  }

  private handleEvent(e: GameEvent) {
    const g = this.game2;
    const sfx = !this.silent;
    switch (e.type) {
      case 'turnStart': {
        this.camMode = 'player';
        this.charging = false;
        this.charge = 0;
        this.selected = 'basic';
        this.lastTickSecond = -1;
        this.ai = { state: g.players[e.player].controller === 'ai' || this.cfg.demo ? 'think' : 'done', t: 0, plan: null };
        if (sfx && this.isLocalTurn()) audio.turn();
        break;
      }
      case 'fire': {
        const p = g.players[e.player];
        const v = this.views[e.player];
        v.shootTimer = 0.35;
        const a = p.facing === 1 ? -Phaser.Math.DegToRad(e.angle) : Math.PI + Phaser.Math.DegToRad(e.angle);
        this.fx.muzzle(e.x, e.y, a, e.weapon !== 'basic');
        if (sfx) {
          audio.fire(e.weapon !== 'basic');
          audio.whistleStart();
        }
        this.camMode = 'projectile';
        break;
      }
      case 'spawnProjectile': {
        const pr = g.projectiles.find((q) => q.id === e.id);
        if (!pr) break;
        const owner = g.players[pr.owner];
        const col = this.weaponColor(e.weapon, owner.charType);
        const img = this.add.image(pr.x, pr.y, `proj_${e.weapon}_${owner.charType}`).setDepth(20);
        const c = Phaser.Display.Color.HexStringToColor(col).color;
        const big = WEAPONS[e.weapon].look === 'big_capsule';
        const trail = this.add.particles(0, 0, 'fx_soft', {
          lifespan: e.weapon === 'basic' ? 380 : 520,
          scale: { start: big ? 0.22 : 0.13, end: 0 },
          alpha: { start: 0.55, end: 0 },
          tint: e.weapon === 'basic' ? [0xffffff, 0xffd0d0] : [0xffffff, c],
          blendMode: 'ADD',
          emitting: false,
        });
        trail.setDepth(19);
        this.projSprites.set(e.id, { img, trail });
        break;
      }
      case 'explode': {
        const def = WEAPONS[e.weapon];
        const tv = this.terrainView!;
        tv.addScorch(e.x, e.y, e.radius);
        const pad = e.radius + 10;
        tv.redraw({ x: Math.floor(e.x - pad), y: Math.floor(e.y - pad), w: Math.ceil(pad * 2), h: Math.ceil(pad * 2) });
        const colors: number[] = [];
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const sx = e.x + Math.cos(ang) * (e.radius + 4),
            sy = e.y + Math.sin(ang) * (e.radius + 4);
          if (g.terrain.isSolid(sx, sy)) colors.push(tv.colorAt(sx, sy));
        }
        if (e.rect && colors.length === 0) colors.push(0x8a5a3b, 0x6e4630);
        this.fx.explosion(e.x, e.y, e.radius, e.weapon, e.rect ? colors : [], this.weaponColor(e.weapon, g.players[e.owner].charType));
        if (def.shake > 0) this.cameras.main.shake(260 + def.shake * 20, 0.0015 * def.shake);
        if (sfx) audio.explosion(e.radius);
        this.camMode = 'point';
        this.camPoint = { x: e.x, y: e.y };
        this.camHold = 0.6;
        break;
      }
      case 'damage': {
        const v = this.views[e.player];
        v.hitTimer = 0.5;
        const src = g.players[e.from];
        v.knock = src && src.x > g.players[e.player].x ? -5 : 5;
        this.fx.damageText(e.x, e.y - 14, e.amount);
        v.body.setTintFill(0xffffff);
        this.time.delayedCall(70, () => v.body.clearTint().setTint(0xffa0a0));
        this.time.delayedCall(260, () => v.body.clearTint());
        if (sfx) audio.hit();
        break;
      }
      case 'heal': {
        const p = g.players[e.player];
        this.fx.damageText(p.x, p.y - 30, e.amount, '#7dffa0', '+');
        break;
      }
      case 'death': {
        const p = g.players[e.player];
        this.fx.bigText(p.x, p.y - 80, e.cause === 'fall' ? '추락!' : 'K.O.!', '#ff6b6b');
        break;
      }
      case 'projectileOut':
        break;
      case 'land':
        this.fx.dust(g.players[e.player].x, g.players[e.player].y);
        if (sfx) audio.land();
        break;
      case 'timeout':
        this.fx.bigText(g.players[e.player].x, g.players[e.player].y - 80, '시간 초과', '#ffd23f');
        break;
      case 'gameOver': {
        this.overTimer = 2.2;
        if (sfx) {
          const local = g.players.find((p) => p.controller === 'human');
          const allHuman = g.players.every((p) => p.controller === 'human');
          if (allHuman || (local && local.team === e.winnerTeam)) audio.win();
          else audio.lose();
        }
        break;
      }
    }
    if (g.projectiles.length === 0) audio.whistleStop();
  }

  // ───────────────────────── 렌더링 ─────────────────────────
  private renderWorld(dt: number) {
    const g = this.game2;
    const alpha = this.acc / DT;
    // 포탄
    for (const [id, s] of this.projSprites) {
      const pr = g.projectiles.find((q) => q.id === id);
      if (!pr) {
        s.img.destroy();
        const t = s.trail;
        this.time.delayedCall(700, () => t.destroy());
        this.projSprites.delete(id);
        continue;
      }
      const x = pr.prevX + (pr.x - pr.prevX) * alpha;
      const y = pr.prevY + (pr.y - pr.prevY) * alpha;
      s.img.setPosition(x, y);
      if (WEAPONS[pr.weapon].look === 'axe' || WEAPONS[pr.weapon].look === 'cross') s.img.rotation += dt * 14 * pr.facing;
      else s.img.setRotation(Math.atan2(pr.vy, pr.vx));
      s.trail.emitParticleAt(x, y, 1);
      if (!this.silent && id === g.projectiles[0].id) audio.whistleUpdate(pr.vy);
    }
    // 캐릭터
    const t = this.time.now / 1000;
    g.players.forEach((p, i) => {
      const v = this.views[i];
      const fell = !p.alive && p.deathCause === 'fall';
      if (fell) {
        v.body.setVisible(p.y < g.worldH + 80);
        v.gun.setVisible(false);
      }
      v.hitTimer = Math.max(0, v.hitTimer - dt);
      v.shootTimer = Math.max(0, v.shootTimer - dt);
      v.knock *= Math.pow(0.0005, dt);
      v.blinkTimer -= dt;
      const moved = Math.abs(p.x - v.lastX);
      v.walkDist += moved;
      v.lastX = p.x;
      // 단일 일러스트 → 변형(스케일/기울기/점프)으로 애니메이션
      const isWinner = g.phase === 'over' && p.alive && g.winnerTeam === p.team;
      const walking = moved > 0.01 && p.grounded && p.alive;
      let sx = CHAR_SCALE,
        sy = CHAR_SCALE,
        rot = 0,
        bx = p.x + v.knock,
        by = p.y;
      if (!p.alive) {
        rot = -p.facing * (Math.PI / 2);
      } else if (isWinner) {
        by -= Math.abs(Math.sin(t * 6)) * 8;
        rot = Math.sin(t * 12) * 0.08;
        sy *= 1 + Math.abs(Math.cos(t * 6)) * 0.04;
      } else if (v.hitTimer > 0) {
        const k = v.hitTimer / 0.5;
        rot = (v.knock > 0 ? 1 : -1) * 0.28 * k;
        bx += Math.sin(t * 60) * 1.5 * k;
      } else if (v.shootTimer > 0) {
        const k = v.shootTimer / 0.35;
        sy *= 1 - 0.07 * k;
        sx *= 1 + 0.06 * k;
        rot = -p.facing * 0.12 * k;
      } else if (walking) {
        by -= Math.abs(Math.sin(v.walkDist * 0.35)) * 2.5;
        rot = Math.sin(v.walkDist * 0.35) * 0.07;
      } else {
        // 숨쉬기
        const br = Math.sin(t * 2.6 + i * 1.7);
        sy *= 1 + br * 0.018;
        sx *= 1 - br * 0.01;
      }
      v.body.setFlipX(p.facing === -1);
      v.body.setScale(sx, sy);
      v.body.setPosition(Math.round(bx), Math.round(by));
      v.body.rotation += (rot - v.body.rotation) * Math.min(1, dt * (p.alive ? 18 : 8));
      if (!p.alive) v.body.setTint(0x8a8a9a);
      // 무기
      const showGun = p.alive && !isWinner;
      v.gun.setVisible(showGun);
      if (showGun) {
        const recoil = v.shootTimer > 0 ? -3 * (v.shootTimer / 0.35) : 0;
        const ang = Phaser.Math.DegToRad(Math.round(p.angle));
        const rx = p.facing * cosDeg(Math.round(p.angle)) * recoil;
        const ry = -sinDeg(Math.round(p.angle)) * recoil;
        v.gun.setPosition(Math.round(bx + rx + p.facing * 2), Math.round(by - MUZZLE_HEIGHT + ry));
        v.gun.setScale(p.facing, 1);
        v.gun.setRotation(p.facing === 1 ? -ang : ang);
      }
      // 이름/체력바
      v.shownHp += (p.hp - v.shownHp) * Math.min(1, dt * 6);
      const ly = by - 66;
      v.label.setPosition(Math.round(bx), Math.round(ly - 4)).setVisible(p.alive);
      v.hpBar.clear();
      if (p.alive) {
        const w = 30,
          hx = Math.round(bx - w / 2),
          hy = Math.round(ly - 2);
        v.hpBar.fillStyle(0x0b0814, 0.85).fillRect(hx - 1, hy - 1, w + 2, 5);
        v.hpBar.fillStyle(0xffffff, 0.6).fillRect(hx, hy, (w * v.shownHp) / 100, 3);
        const col = p.hp > 50 ? 0x5ef08a : p.hp > 25 ? 0xffd23f : 0xff5a5a;
        v.hpBar.fillStyle(col, 1).fillRect(hx, hy, (w * p.hp) / 100, 3);
        v.hpBar.fillStyle(0xffffff, 0.35).fillRect(hx, hy, (w * p.hp) / 100, 1);
      }
    });
    // 현재 턴 표시 + 조준선
    const cp = g.currentPlayer;
    const cv = this.views[g.current];
    this.aimGfx.clear();
    const showMarker = (g.phase === 'aiming' || g.phase === 'turnStart') && cp.alive;
    this.marker.setVisible(showMarker);
    if (showMarker) {
      this.marker.setPosition(Math.round(cp.x), Math.round(cv.body.y - 80 + Math.sin(t * 5) * 2.5));
      if (g.phase === 'aiming') {
        const a = Math.round(cp.angle);
        const ox = cp.x,
          oy = cp.y - MUZZLE_HEIGHT;
        const dx = cp.facing * cosDeg(a),
          dy = -sinDeg(a);
        // 각도 호
        this.aimGfx.lineStyle(1, 0xffffff, 0.25);
        this.aimGfx.beginPath();
        this.aimGfx.arc(ox, oy, 42, cp.facing === 1 ? -Math.PI / 2 : Math.PI, cp.facing === 1 ? 0 : -Math.PI / 2, false);
        this.aimGfx.strokePath();
        // 점선 조준선
        for (let k = 0; k < 7; k++) {
          const d = MUZZLE_LENGTH + 6 + k * 6;
          const al = 0.9 - k * 0.11;
          this.aimGfx.fillStyle(this.isLocalTurn() ? 0xffe14d : 0xffffff, al);
          this.aimGfx.fillRect(Math.round(ox + dx * d) - 1, Math.round(oy + dy * d) - 1, 2, 2);
        }
      }
    }
  }

  /** 카메라 이동 후 같은 프레임에 배경 위치 갱신 (지연/떨림 방지) */
  private updateParallax() {
    const t = this.time.now / 1000;
    const vx = this.camX - VIEW_W / 2,
      vy = this.camY - VIEW_H / 2;
    for (const b of this.bgImages) {
      if (b.kind === 'sky') b.img.setPosition(vx, vy);
      else if (b.kind === 'cloud') {
        b.img.setPosition(vx, vy + b.y - (vy - CAM_TOP) * 0.05);
        (b.img as Phaser.GameObjects.TileSprite).tilePositionX = vx * b.factor + t * 4;
      } else {
        const fy = b.factor * 0.6;
        b.img.setPosition(vx * (1 - b.factor), vy * (1 - fy) + CAM_TOP * fy);
      }
    }
  }

  // ───────────────────────── 카메라 ─────────────────────────
  private updateCamera(dt: number) {
    const g = this.game2;
    let tx = this.camX,
      ty = this.camY,
      speed = 5;
    switch (this.camMode) {
      case 'player': {
        const p = g.currentPlayer;
        tx = p.x;
        ty = p.y - 70;
        speed = 4;
        break;
      }
      case 'projectile': {
        const pr = g.projectiles[0];
        if (pr) {
          tx = pr.x + pr.vx * 0.22;
          ty = pr.y + pr.vy * 0.18;
          speed = 7;
        } else {
          tx = this.camPoint.x;
          ty = this.camPoint.y;
        }
        break;
      }
      case 'point':
        tx = this.camPoint.x;
        ty = this.camPoint.y - 30;
        this.camHold -= dt;
        speed = 6;
        if (this.camHold < 0 && g.projectiles.length > 0) this.camMode = 'projectile';
        break;
      case 'free':
        speed = 0;
        break;
    }
    if (speed > 0) {
      const k = 1 - Math.exp(-speed * dt);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
    }
    this.applyCamera();
  }

  private applyCamera() {
    const g = this.game2;
    this.camX = Phaser.Math.Clamp(this.camX, VIEW_W / 2, g.worldW - VIEW_W / 2);
    this.camY = Phaser.Math.Clamp(this.camY, CAM_TOP + VIEW_H / 2, g.worldH - VIEW_H / 2);
    // centerOn과 동일: scroll = center - (캔버스 크기)/2
    const cam = this.cameras.main;
    cam.scrollX = this.camX - cam.width / 2;
    cam.scrollY = this.camY - cam.height / 2;
  }

  private weaponColor(w: WeaponId, owner: CharTypeId): string {
    return WEAPONS[w].color ?? CHAR_TYPES[owner].palette.accent;
  }

  /** 미니맵/HUD용 */
  get cameraCenter() {
    return { x: this.camX, y: this.camY };
  }
}
