import { applyCommand, type BattleAction, type Frame } from '../online/protocol';
import { OnlinePlayback } from '../online/playback';
import type { Rect } from '../core/terrain';
import Phaser from 'phaser';
import { planShot, type AiPlan } from '../core/ai';
import { CHAR_TYPES, CHAR_LIST, type CharTypeId } from '../core/characters';
import { DT, MAX_GAUGE, MUZZLE_HEIGHT, TICK_RATE } from '../core/constants';
import { Game, type GameEvent, type Player, type PlayerSetup } from '../core/game';
import { cosDeg, sinDeg } from '../core/physics';
import { WEAPONS, type WeaponId } from '../core/weapons';
import { MAP_INFO, MAP_LIST, type MapId } from '../core/mapgen';
import { drawGun, GUN_H, GUN_PIVOT_X, GUN_PIVOT_Y, GUN_RES, GUN_SCALE, GUN_W, makeCanvas, pixelSquare, smokePuff, softCircle } from './art';
import { audio } from './audio';
import { buildFarMushroomLayer, buildForestLayers, buildMushroomLayer, buildPineLayer, buildSkyLayers, buildVolcanoLayers, cloudsCanvas, skyCanvas } from './background';
import { Effects } from './effects';
import { PROJECTILE_ASSETS, ProjectileVisual } from './projectiles';
import SPRITES from '../../public/chars2/manifest.json';

type FrameName = 'idle' | 'battle' | 'shoot' | 'walk0' | 'walk1' | 'walk2' | 'walk3';
const ALL_FRAMES: FrameName[] = ['idle', 'battle', 'shoot', 'walk0', 'walk1', 'walk2', 'walk3'];
const SPR = SPRITES as Record<string, Record<FrameName, { w: number; h: number; ox: number }>>;
/** 캐릭터 화면 높이(월드 px) */
const CHAR_WORLD_H = 80;

const charScale = (id: string) => CHAR_WORLD_H / SPR[id].idle.h;
import { asteroidCanvas, earthCanvas, nebulaCanvas, shipCanvas, stationCanvas } from './spaceBg';
import { TerrainView } from './terrainView';

export const VIEW_W = 960; // 월드 기준 화면 폭 (줌 2 → 캔버스 1920)
export const VIEW_H = 540;
/** 정수 줌만 사용(픽셀아트 선명도). 고해상도 데스크톱(실제 픽셀 2500+)은 3배, 그 외 2배 */
function pickZoom(): number {
  try {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.min(window.innerWidth, (window.innerHeight * 16) / 9);
    const touch = matchMedia('(pointer: coarse)').matches;
    return !touch && cssW * dpr >= 2500 ? 3 : 2;
  } catch {
    return 2;
  }
}
export const ZOOM = pickZoom();
/** 하단 UI 패널 아래로도 지형이 보이도록 카메라가 맵 바닥보다 더 내려갈 수 있는 여유 */
export const CAM_EXTRA = 120;
const CAM_TOP = -420;
const CHARGE_TIME = 2.0; // 파워 0→100 (초)

export interface BattleConfig {
  seed: number;
  mapId?: MapId;
  players: PlayerSetup[];
  demo?: boolean;
  online?: { player: number; send: (action: BattleAction, turn: number) => void };
}

export interface BattleHooks {
  onGameOver?(g: Game): void;
  onEvent?(e: GameEvent, g: Game): void;
}

interface CharView {
  body: Phaser.GameObjects.Image;
  /** 다리(스프라이트 하단을 좌/우로 잘라 따로 움직임) */
  legL: Phaser.GameObjects.Image;
  legR: Phaser.GameObjects.Image;
  cropKey: string;
  legAmp?: number;
  gun: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  hpText: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Image;
  shownHp: number;
  lastX: number;
  walkDist: number;
  hitTimer: number;
  shootTimer: number;
  blinkTimer: number;
  knock: number;
  fallen: boolean;
  hitFlash: number;
}

type CamMode = 'player' | 'projectile' | 'point' | 'free';

export class BattleScene extends Phaser.Scene {
  game2!: Game;
  cfg!: BattleConfig;
  hooks: BattleHooks = {};
  private terrainView: TerrainView | null = null;
  private views: CharView[] = [];
  private projSprites = new Map<number, ProjectileVisual>();
  private fx!: Effects;
  private acc = 0;
  private playback: OnlinePlayback | null = null;
  private previousPlayers: { x: number; y: number }[] = [];
  private dirtyTerrain: Rect[] = [];
  private catchingUp = false;
  private renderZoom = ZOOM;
  private slowFrames = 0;
  private bgImages: { img: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite; factor: number; y: number; kind: 'layer' | 'sky' | 'cloud'; ox?: number; oy?: number; bob?: number; bobSpeed?: number; phase?: number; spin?: number }[] = [];
  private aimGfx!: Phaser.GameObjects.Graphics;
  private aimText: Phaser.GameObjects.Text | null = null;
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
  selected: 'basic' | 'special' | 'ultimate' | 'move' = 'basic';
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
    for (const id of PROJECTILE_ASSETS) this.load.image(`projectile_${id}`, `projectiles/${id}.png`);
    for (const id of CHAR_LIST) for (const f of ALL_FRAMES) this.load.image(`spr_${id}_${f}`, `chars2/${id}_${f}.png`);
    for (const id of MAP_LIST) {
      const bd = MAP_INFO[id].backdrop;
      if (bd) this.load.image(`bg_${bd}`, `bg/${bd}.jpg`);
    }
  }

  create() {
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.setBackgroundColor('#2a6f8c');
    this.makeTextures();
    for (const id of PROJECTILE_ASSETS) this.textures.get(`projectile_${id}`).setFilter(Phaser.Textures.FilterMode.LINEAR);
    // 일러스트(캐릭터·배경 사진)는 선형 필터, 픽셀아트(지형·무기·이펙트)는 최근접 필터
    for (const id of CHAR_LIST) for (const f of ALL_FRAMES) this.textures.get(`spr_${id}_${f}`).setFilter(Phaser.Textures.FilterMode.LINEAR);
    for (const id of MAP_LIST) {
      const bd = MAP_INFO[id].backdrop;
      if (bd && this.textures.exists(`bg_${bd}`)) this.textures.get(`bg_${bd}`).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    this.fx = new Effects(this);
    this.aimGfx = this.add.graphics().setDepth(25);
    this.marker = this.add.image(0, 0, 'ui_marker').setDepth(45).setVisible(false);
    this.setupInput();
    const stopOnlineInput = () => {
      if (this.cfg?.online && this.game2) {
        this.cfg.online.send({ kind: 'input', move: 0, aim: 0 }, this.game2.turnNumber);
        this.charging = false; this.touchMove = 0; this.touchAim = 0;
      }
    };
    window.addEventListener('blur', stopOnlineInput);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopOnlineInput(); });
    this.onReady?.();
  }

  // ───────────────────────── 텍스처 ─────────────────────────
  private makeTextures() {
    const add = (key: string, c: HTMLCanvasElement) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, c);
    };
    for (const id of CHAR_LIST) {
      const def = CHAR_TYPES[id];
      const g = makeCanvas(GUN_W * GUN_RES, GUN_H * GUN_RES);
      drawGun(g.getContext('2d')!, def.gun, def.palette);
      add(`gun_${id}`, g);
    }
    // High-resolution heal sphere for the green cross ultimate.
    const heal = makeCanvas(256, 256), hc = heal.getContext('2d')!;
    const hg = hc.createRadialGradient(105, 90, 8, 128, 128, 110);
    hg.addColorStop(0, '#f0fff4'); hg.addColorStop(0.3, '#49ff97'); hg.addColorStop(0.8, '#087237'); hg.addColorStop(1, '#00ff88');
    hc.fillStyle = hg; hc.shadowColor = '#28ff88'; hc.shadowBlur = 12;
    hc.beginPath(); hc.arc(128, 128, 101, 0, Math.PI * 2); hc.fill();
    hc.strokeStyle = '#afffe0'; hc.lineWidth = 5; hc.stroke();
    hc.fillStyle = '#ffffff'; hc.fillRect(112, 65, 32, 126); hc.fillRect(65, 112, 126, 32);
    add('projectile_heal', heal);
    this.textures.get('projectile_heal').setFilter(Phaser.Textures.FilterMode.LINEAR);
    add('fx_soft', softCircle(64));
    add('fx_px', pixelSquare(2));
    add('fx_smoke', smokePuff(64));
    add('fx_dot', softCircle(8, 0.3));
    for (const key of ['fx_soft', 'fx_smoke', 'fx_dot']) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
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
    if (!this.silent) audio.preloadAttackVoices(cfg.players.map(p => p.charType));
    this.game2 = new Game({ seed: cfg.seed, players: cfg.players, mapId: cfg.mapId });
    const g = this.game2;
    this.buildBackground(cfg.seed);
    this.terrainView = new TerrainView(this, g.terrain, g.material, g.mapId, cfg.seed, 0);
    this.views = g.players.map((p) => this.makeCharView(p));
    this.acc = 0;
    this.playback = cfg.online ? new OnlinePlayback() : null;
    this.previousPlayers = g.players.map(p => ({ x: p.x, y: p.y }));
    this.lastNow = performance.now();
    this.lastOnlineInput = '';
    this.lastOnlineSend = 0;
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

  /** 전투 종료(타이틀/선택 화면에서는 배경 전투를 돌리지 않음) */
  stopBattle() {
    this.clearWorld();
    (this as any).game2 = undefined;
  }

  private clearWorld() {
    this.playback = null;
    this.dirtyTerrain = [];
    audio.stopVoice();
    for (const o of this.worldObjs) o.destroy();
    this.worldObjs = [];
    this.bgImages = [];
    for (const v of this.views) {
      v.body.destroy();
      v.legL.destroy();
      v.legR.destroy();
      v.gun.destroy();
      v.label.destroy();
      v.hpText.destroy();
      v.hpBar.destroy();
      v.shadow.destroy();
    }
    this.views = [];
    for (const s of this.projSprites.values()) {
      s.destroy(true);
    }
    this.projSprites.clear();
    this.terrainView?.destroy();
    this.terrainView = null;
    this.ambient?.destroy();
    this.ambient = null;
    this.liquidTiles = [];
    for (const tm of this.spaceTimers) tm.remove();
    this.spaceTimers = [];
    audio.whistleStop();
  }

  private buildBackground(seed: number) {
    const g = this.game2;
    const info = g.map;
    const theme = info.id === 'volcano_lab' ? 'volcano' : info.id === 'sky_pharmacy' ? 'sky' : 'herb';
    const addLayer = (l: { canvas: HTMLCanvasElement; factor: number; y: number; res?: number; oy?: number }, key: string, depth: number) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, l.canvas);
      const img = this.add.image(0, 0, key).setOrigin(0).setDepth(depth).setScale(1 / (l.res ?? 1));
      this.bgImages.push({ img, factor: l.factor, y: l.y, kind: 'layer', oy: l.oy });
    };
    if (info.id === 'moon_base') {
      this.buildSpace(seed);
    } else if (info.backdrop) {
      // 레퍼런스 일러스트 배경 (먼 층)
      const f = 0.12;
      const w = VIEW_W + (g.worldW - VIEW_W) * f + 4;
      const fy = f * 0.6;
      const h = VIEW_H + (g.worldH + CAM_EXTRA - VIEW_H - CAM_TOP) * fy + 4;
      const src = this.textures.get(`bg_${info.backdrop}`).getSourceImage() as HTMLImageElement;
      const sc = Math.max(w / src.width, h / src.height);
      const img = this.add.image(0, 0, `bg_${info.backdrop}`).setOrigin(0).setDepth(-100).setScale(sc);
      this.bgImages.push({ img, factor: f, y: CAM_TOP * fy, kind: 'layer' });
      if (info.id === 'herb_forest') {
        addLayer(buildFarMushroomLayer(VIEW_W, VIEW_H, g.worldW, g.worldH + CAM_EXTRA, CAM_TOP, seed, 0.2), `bg_mushfar_${seed}`, -92);
        addLayer(buildMushroomLayer(VIEW_W, VIEW_H, g.worldW, g.worldH + CAM_EXTRA, CAM_TOP, seed, 0.3), `bg_mush2_${seed}`, -88);
      }
      if (info.id === 'ice_peaks') addLayer(buildPineLayer(VIEW_W, VIEW_H, g.worldW, g.worldH + CAM_EXTRA, CAM_TOP, seed), `bg_pine_${seed}`, -90);
    } else {
      const skyKey = `bg_sky_${theme}`;
      if (!this.textures.exists(skyKey)) this.textures.addCanvas(skyKey, skyCanvas(VIEW_W, VIEW_H, theme));
      const sky = this.add.image(0, 0, skyKey).setOrigin(0).setDepth(-100);
      this.bgImages.push({ img: sky, factor: 0, y: 0, kind: 'sky' });
      if (theme !== 'volcano') {
        const cloudKey = `bg_cloud_${seed}`;
        if (!this.textures.exists(cloudKey)) this.textures.addCanvas(cloudKey, cloudsCanvas(1024, 200, seed));
        const cl = this.add.tileSprite(0, 0, VIEW_W, 200, cloudKey).setOrigin(0).setDepth(-95).setAlpha(0.9);
        this.bgImages.push({ img: cl, factor: 0.05, y: 30, kind: 'cloud' });
      }
      const layers =
        theme === 'volcano'
          ? buildVolcanoLayers(VIEW_W, VIEW_H, g.worldW, g.worldH + CAM_EXTRA, CAM_TOP, seed)
          : theme === 'sky'
            ? buildSkyLayers(VIEW_W, VIEW_H, g.worldW, g.worldH + CAM_EXTRA, CAM_TOP, seed)
            : buildForestLayers(VIEW_W, VIEW_H, g.worldW, g.worldH + CAM_EXTRA, CAM_TOP, seed);
      layers.forEach((l, i) => addLayer(l, `bg_layer_${info.id}_${seed}_${i}`, -90 + i));
    }
    for (const b of this.bgImages) this.worldObjs.push(b.img);
    // 맵 하단: 액체(물/용암) 또는 심연 그라디언트
    if (info.liquidY !== null && info.liquid) this.buildLiquid(info.liquidY, info.liquid);
    else {
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
      const ab = this.add.image(0, g.worldH - 120, abyssKey).setOrigin(0).setDisplaySize(g.worldW, 120 + CAM_EXTRA).setDepth(-5);
      this.worldObjs.push(ab);
    }
    // 분위기 파티클
    const amb: Record<string, Phaser.Types.GameObjects.Particles.ParticleEmitterConfig> = {
      herb: { speedX: { min: -8, max: 8 }, speedY: { min: -14, max: -4 }, tint: [0xe8ffb0, 0xb0ffd8, 0xfff2a0], blendMode: 'ADD', scale: { min: 0.3, max: 0.8 } },
      snow: { speedX: { min: -20, max: 10 }, speedY: { min: 18, max: 45 }, tint: [0xffffff, 0xe6f4ff], scale: { min: 0.35, max: 0.9 } },
      dust: { speedX: { min: -4, max: 4 }, speedY: { min: -4, max: 4 }, tint: [0x9fd8ff, 0xffffff], blendMode: 'ADD', scale: { min: 0.2, max: 0.5 } },
      ember: { speedX: { min: -10, max: 10 }, speedY: { min: -40, max: -12 }, tint: [0xffb03a, 0xff6a1a, 0xffe08a], blendMode: 'ADD', scale: { min: 0.25, max: 0.7 } },
      sea: { speedX: { min: -6, max: 6 }, speedY: { min: -8, max: -2 }, tint: [0xffffff, 0xc8f0ff], blendMode: 'ADD', scale: { min: 0.2, max: 0.5 } },
    };
    const kind = { herb_forest: 'herb', ice_peaks: 'snow', moon_base: 'dust', pirate_cove: 'sea', volcano_lab: 'ember', sky_pharmacy: 'herb' }[info.id];
    this.ambient = this.add.particles(0, 0, 'fx_dot', {
      x: { min: 0, max: g.worldW },
      y: { min: -300, max: g.worldH - 200 },
      lifespan: 6000,
      alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) * 0.85 } as any,
      frequency: kind === 'snow' ? 18 : 60,
      ...amb[kind],
    });
    this.ambient.setDepth(kind === 'snow' ? 30 : -3);
  }

  private liquidTiles: Phaser.GameObjects.TileSprite[] = [];
  private spaceTimers: Phaser.Time.TimerEvent[] = [];

  /** 우주 배경: 원경(성운·별) → 지구 → 소행성(3층) → 우주정거장, 모두 패럴랙스 */
  private buildSpace(seed: number) {
    const g = this.game2;
    const layerSize = (f: number) => ({
      w: Math.ceil(VIEW_W + (g.worldW - VIEW_W) * f) + 4,
      h: Math.ceil(VIEW_H + (g.worldH + CAM_EXTRA - VIEW_H - CAM_TOP) * f * 0.6) + 4,
    });
    const tex = (key: string, make: () => HTMLCanvasElement) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, make());
      return key;
    };
    // 1) 성운 + 별
    const nf = 0.03;
    const ns = layerSize(nf);
    const nk = tex(`sp_neb_${seed}`, () => nebulaCanvas(ns.w, ns.h, seed));
    this.bgImages.push({ img: this.add.image(0, 0, nk).setOrigin(0).setDepth(-100), factor: nf, y: CAM_TOP * nf * 0.6, kind: 'layer' });
    // 반짝이는 별
    const rng = new Phaser.Math.RandomDataGenerator([String(seed)]);
    for (let i = 0; i < 46; i++) {
      const st = this.add.image(0, 0, 'fx_dot').setDepth(-99).setBlendMode(Phaser.BlendModes.ADD).setScale(rng.realInRange(0.25, 0.6)).setTint(rng.pick([0xffffff, 0xcfe0ff, 0xffe8c8]));
      this.bgImages.push({ img: st, factor: nf, y: CAM_TOP * nf * 0.6, kind: 'layer', ox: rng.between(0, ns.w), oy: rng.between(0, ns.h * 0.8) });
      this.tweens.add({ targets: st, alpha: { from: 1, to: 0.15 }, duration: rng.between(700, 2200), yoyo: true, repeat: -1, delay: rng.between(0, 2000) });
    }
    // 2) 지구 (대기광 포함)
    const ek = tex('sp_earth', () => earthCanvas(104, 4242));
    this.bgImages.push({ img: this.add.image(0, 0, ek).setOrigin(0).setDepth(-97), factor: 0.06, y: CAM_TOP * 0.036, kind: 'layer', ox: 250, oy: 40, bob: 2, bobSpeed: 0.15 });
    // 3) 소행성 3층: 멀수록 작고 어둡고 느리게
    const groups: { f: number; n: number; min: number; max: number; tint: number; depth: number; yMax: number }[] = [
      { f: 0.08, n: 9, min: 12, max: 26, tint: 0x8a8ab0, depth: -96, yMax: 0.55 },
      { f: 0.18, n: 6, min: 28, max: 54, tint: 0xc0c0dc, depth: -94, yMax: 0.5 },
      { f: 0.42, n: 3, min: 70, max: 100, tint: 0x9090b8, depth: -88, yMax: 0.35 },
    ];
    let ai = 0;
    for (const gr of groups) {
      const ls = layerSize(gr.f);
      for (let k = 0; k < gr.n; k++) {
        const size = rng.between(gr.min, gr.max);
        const key = tex(`sp_ast_${size}_${ai % 7}`, () => asteroidCanvas(size, 900 + ai * 13));
        const img = this.add.image(0, 0, key).setDepth(gr.depth).setTint(gr.tint).setRotation(rng.realInRange(0, 6.28));
        this.bgImages.push({
          img,
          factor: gr.f,
          y: CAM_TOP * gr.f * 0.6,
          kind: 'layer',
          ox: rng.between(40, ls.w - 40),
          oy: rng.between(30, Math.round(ls.h * gr.yMax)),
          bob: rng.realInRange(3, 8),
          bobSpeed: rng.realInRange(0.2, 0.5),
          phase: rng.realInRange(0, 6.28),
          spin: rng.realInRange(-0.06, 0.06),
        });
        ai++;
      }
    }
    // 4) 우주정거장 + 깜빡이는 조명
    const sf = 0.22;
    const ss = layerSize(sf);
    const sk = tex('sp_station', () => stationCanvas(77));
    const sox = Math.round(ss.w * 0.66),
      soy = 110;
    this.bgImages.push({ img: this.add.image(0, 0, sk).setOrigin(0).setDepth(-92), factor: sf, y: CAM_TOP * sf * 0.6, kind: 'layer', ox: sox, oy: soy });
    for (const [lx, ly, col] of [[149, 1, 0xff5a5a], [243, 30, 0x5ec8ff], [10, 112, 0xffd48a], [260, 62, 0xff5a5a], [100, 150, 0x5ec8ff]] as const) {
      const l = this.add.image(0, 0, 'fx_soft').setDepth(-91).setBlendMode(Phaser.BlendModes.ADD).setTint(col).setScale(0.18);
      this.bgImages.push({ img: l, factor: sf, y: CAM_TOP * sf * 0.6, kind: 'layer', ox: sox + lx, oy: soy + ly });
      this.tweens.add({ targets: l, alpha: { from: 1, to: 0.1 }, duration: 600 + lx * 3, yoyo: true, repeat: -1 });
    }
    for (const b of this.bgImages) this.worldObjs.push(b.img);
    // 5) 별똥별과 지나가는 우주선 (가끔)
    const shipKey = tex('sp_ship', shipCanvas);
    this.spaceTimers.push(
      this.time.addEvent({
        delay: 5200,
        loop: true,
        callback: () => {
          const v = this.cameras.main.worldView;
          const x = v.x + rng.between(100, VIEW_W - 100),
            y = v.y + rng.between(20, 160);
          const gfx = this.add.graphics().setDepth(-90).setBlendMode(Phaser.BlendModes.ADD);
          const st = { t: 0 };
          this.tweens.add({
            targets: st,
            t: 1,
            duration: 700,
            onUpdate: () => {
              gfx.clear();
              const hx = x + st.t * 160,
                hy = y + st.t * 60;
              for (let k = 0; k < 10; k++) {
                gfx.fillStyle(0xffffff, (1 - k / 10) * (1 - st.t) * 0.9);
                gfx.fillRect(hx - k * 5, hy - k * 1.9, 2, 1);
              }
            },
            onComplete: () => gfx.destroy(),
          });
        },
      }),
      this.time.addEvent({
        delay: 14000,
        loop: true,
        callback: () => {
          const v = this.cameras.main.worldView;
          const dir = rng.pick([1, -1]);
          const y = v.y + rng.between(60, 200);
          const ship = this.add.image(dir > 0 ? v.x - 40 : v.right + 40, y, shipKey).setDepth(-89).setFlipX(dir < 0);
          this.tweens.add({ targets: ship, x: dir > 0 ? v.right + 60 : v.x - 60, y: y - 30, duration: 9000, onComplete: () => ship.destroy() });
        },
      }),
    );
  }


  /** 물/용암: 맵 전체 폭의 반투명 띠 + 출렁이는 수면 */
  private buildLiquid(ly: number, kind: 'water' | 'ice_water' | 'lava') {
    const g = this.game2;
    const h = g.worldH + CAM_EXTRA - ly + 40;
    const key = `liq_${kind}_${h}`;
    const pal =
      kind === 'lava'
        ? { top: '#ffe08a', mid: '#ff7a1a', deep: '#8a1a0a', alpha: 0.96 }
        : kind === 'ice_water'
          ? { top: '#e8f8ff', mid: '#6cc4f0', deep: '#1e5a9a', alpha: 0.86 }
          : { top: '#e6fbff', mid: '#22a6dc', deep: '#0a3f86', alpha: 0.86 };
    if (!this.textures.exists(key)) {
      const c = makeCanvas(256, h);
      const ctx = c.getContext('2d')!;
      const gr = ctx.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, pal.mid);
      gr.addColorStop(1, pal.deep);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 4, 256, h);
      // 수면 물결 (타일 반복 가능한 주기)
      for (let x = 0; x < 256; x++) {
        const wv = Math.round(Math.sin((x / 256) * Math.PI * 8) * 1.5 + Math.sin((x / 256) * Math.PI * 2) * 1);
        ctx.fillStyle = pal.top;
        ctx.fillRect(x, 2 + wv, 1, 2);
        ctx.fillStyle = pal.mid;
        ctx.fillRect(x, 4 + wv, 1, 3);
      }
      // 반짝임/거품
      ctx.fillStyle = kind === 'lava' ? 'rgba(255,230,140,0.8)' : 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 60; i++) {
        const x = (i * 97) % 256,
          y = 10 + ((i * 53) % Math.max(10, h - 20));
        ctx.fillRect(x, y, 3 + (i % 4), 1);
      }
      this.textures.addCanvas(key, c);
    }
    const t1 = this.add.tileSprite(0, ly - 4, g.worldW, h, key).setOrigin(0).setDepth(6).setAlpha(pal.alpha);
    const t2 = this.add.tileSprite(0, ly - 2, g.worldW, h, key).setOrigin(0).setDepth(6).setAlpha(0.35);
    if (kind === 'lava') t2.setBlendMode(Phaser.BlendModes.ADD);
    this.liquidTiles = [t1, t2];
    this.worldObjs.push(t1, t2);
  }

  private makeCharView(p: Player): CharView {
    const body = this.add.image(p.x, p.y, `spr_${p.charType}_idle`).setOrigin(SPR[p.charType].idle.ox, 1).setDepth(10.2).setScale(charScale(p.charType));
    const legL = this.add.image(p.x, p.y, `spr_${p.charType}_idle`).setOrigin(SPR[p.charType].idle.ox, 1).setDepth(10.1).setScale(charScale(p.charType));
    const legR = this.add.image(p.x, p.y, `spr_${p.charType}_idle`).setOrigin(SPR[p.charType].idle.ox, 1).setDepth(10).setScale(charScale(p.charType));
    const gun = this.add
      .image(p.x, p.y - MUZZLE_HEIGHT, `gun_${p.charType}`)
      .setOrigin(GUN_PIVOT_X / GUN_W, GUN_PIVOT_Y / GUN_H)
      .setDepth(11)
      .setScale(GUN_SCALE);
    // 발밑 접지 그림자
    const shadow = this.add.image(p.x, p.y, 'fx_soft').setDepth(9).setTint(0x000000).setAlpha(0.42).setScale(0.62, 0.14);
    const font = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    const label = this.add
      .text(p.x, p.y, p.name.split(' · ').pop()!, { fontFamily: font, fontSize: '8px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5, 0)
      .setDepth(41)
      .setResolution(6);
    const hpText = this.add
      .text(p.x, p.y, '100 / 100', { fontFamily: font, fontSize: '7px', fontStyle: 'bold', color: '#d6e6ff' })
      .setOrigin(0.5, 0)
      .setDepth(41)
      .setResolution(6);
    const hpBar = this.add.graphics().setDepth(40);
    return { body, legL, legR, cropKey: '', gun, label, hpText, hpBar, shadow, shownHp: p.hp, lastX: p.x, walkDist: 0, hitTimer: 0, shootTimer: 0, blinkTimer: 0, knock: 0, fallen: false, hitFlash: 0 };
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
      three: 'THREE',
      four: 'FOUR',
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    kb.addCapture(['SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
    this.keys.space.on('down', () => this.startCharge());
    this.keys.space.on('up', () => this.releaseCharge());
    this.keys.one.on('down', () => this.selectWeapon('basic'));
    this.keys.two.on('down', () => this.selectWeapon('special'));
    this.keys.three.on('down', () => this.selectWeapon('ultimate'));
    this.keys.four.on('down', () => this.selectWeapon('move'));
    // 드래그로 맵 둘러보기
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = { x: p.x, y: p.y, cx: this.camX, cy: this.camY };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      const dx = (p.x - this.dragging.x) / this.renderZoom,
        dy = (p.y - this.dragging.y) / this.renderZoom;
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
    return !!g && !this.cfg.demo && g.currentPlayer.controller === 'human' && (!this.cfg.online || g.current === this.cfg.online.player) && g.phase !== 'over';
  }

  setTouchMove(d: number) {
    this.touchMove = d;
  }
  setTouchAim(d: number) {
    this.touchAim = d;
  }
  selectWeapon(w: 'basic' | 'special' | 'ultimate' | 'move') {
    if (!this.isLocalTurn()) return;
    const cp = this.game2.currentPlayer;
    if (w === 'ultimate' && cp.gauge < MAX_GAUGE) return;
    if (w === 'special' && cp.specialCd > 0) return;
    if (w === 'move' && cp.moveShotCd > 0) return;
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
    if (this.cfg.online) {
      // Read wall time on release too, so a missed render frame cannot change shot power.
      this.charge = Math.min(100, (performance.now() - this.chargeStart) / (CHARGE_TIME * 10));
      this.cfg.online.send({ kind: 'fire', weapon: this.selected, power: this.charge }, this.game2.turnNumber);
    }
    else this.game2.fire(this.selected, this.charge);
  }
  skipTurn() {
    if (!this.isLocalTurn()) return;
    if (this.cfg.online) this.cfg.online.send({ kind: 'skip' }, this.game2.turnNumber);
    else this.game2.skipTurn();
  }

  private applyHumanInput() {
    const g = this.game2;
    if (this.cfg.online && document.hidden) return;
    if (!this.isLocalTurn() || !g.canControl || this.paused) {
      if (this.charging && !g.canControl) this.charging = false;
      return;
    }
    const k = this.keys;
    this.keyMove = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    this.keyAim = (k.up.isDown || k.w.isDown ? 1 : 0) - (k.down.isDown || k.s.isDown ? 1 : 0);
    const move = this.charging ? 0 : Math.sign(this.keyMove || this.touchMove);
    const aim = Math.sign(this.keyAim || this.touchAim);
    if (this.cfg.online) {
      const key = g.turnNumber + ':' + move + ':' + aim;
      if (key !== this.lastOnlineInput || performance.now() - this.lastOnlineSend > 150) {
        this.cfg.online.send({ kind: 'input', move: move as -1 | 0 | 1, aim: aim as -1 | 0 | 1 }, g.turnNumber);
        this.lastOnlineInput = key; this.lastOnlineSend = performance.now();
      }
    } else g.setInput({ move: move as -1 | 0 | 1, aim: aim as -1 | 0 | 1 });
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
            this.selected = ai.plan!.weapon;
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
  private lastOnlineInput = '';
  private lastOnlineSend = 0;

  applyNetworkFrame(frame: Frame): boolean {
    return !!this.cfg.online && !!this.game2 && !!this.playback?.receive(frame);
  }

  update() {
    const g = this.game2;
    if (!g) return;
    // 실제 경과 시간(벽시계) 기준. 느린 기기에서도 게임 속도가 유지되도록 프레임당 최대 0.25초까지 따라잡는다.
    const now = performance.now();
    const dt = this.lastNow ? Math.min(0.25, (now - this.lastNow) / 1000) : 1 / 60;
    this.lastNow = now;
    // Lower only this device's drawing cost after sustained low FPS.
    // Physics, camera coverage and other participants keep the same timing.
    if (!document.hidden && !this.paused && this.renderZoom > 1) {
      this.slowFrames = dt > 1 / 42 ? this.slowFrames + dt : Math.max(0, this.slowFrames - dt * 2);
      if (this.slowFrames > 2) {
        this.renderZoom--;
        this.slowFrames = 0;
        this.game.scale.setGameSize(VIEW_W * this.renderZoom, VIEW_H * this.renderZoom);
        this.cameras.main.setZoom(this.renderZoom);
        this.game.canvas.style.imageRendering = this.renderZoom === 1 ? 'auto' : 'pixelated';
        this.dragging = null;
      }
    }
    if (!this.paused) {
      this.applyHumanInput();
      if (this.playback) {
        const deadline = performance.now() + 5;
        this.playback.advance(dt, (commands, catchingUp) => {
          this.catchingUp = catchingUp;
          g.players.forEach((p, i) => { this.previousPlayers[i].x = p.x; this.previousPlayers[i].y = p.y; });
          for (const command of commands) applyCommand(g, command);
          g.step();
          this.processEvents();
        }, () => performance.now() < deadline);
        this.catchingUp = false;
        this.acc = this.playback.alpha * DT;
      } else {
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
    }
    if (this.dirtyTerrain.length) this.terrainView?.redrawMany(this.dirtyTerrain.splice(0));
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
      if (!this.catchingUp || e.type === 'damage') this.hooks.onEvent?.(e, g);
    }
  }

  private handleEvent(e: GameEvent) {
    const g = this.game2;
    const sfx = !this.silent && !this.catchingUp;
    if (this.catchingUp && !['turnStart', 'gameOver', 'explode', 'spawnProjectile'].includes(e.type)) return;
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
        const def = CHAR_TYPES[p.charType];
        const isUlt = e.weapon === def.ultimate.weapon,
          isSp = e.weapon === def.special.weapon;
        this.fx.muzzle(e.x, e.y, a, isUlt || isSp, this.weaponColor(e.weapon, p.charType));
        if (isUlt || isSp) this.fx.skillCall(p.x, p.y - 104, isUlt ? def.ultimate.name : def.special.name, def.palette.glow, isUlt);
        if (sfx) {
          void audio.attackVoice(p.charType);
          audio.fire(isUlt || isSp);
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
        const wdef = WEAPONS[e.weapon];
        this.projSprites.set(e.id, new ProjectileVisual(this, pr.x, pr.y, wdef, col));
        break;
      }
      case 'explode': {
        const def = WEAPONS[e.weapon];
        const tv = this.terrainView!;
        tv.addScorch(e.x, e.y, e.radius);
        const pad = e.radius + 10;
        this.dirtyTerrain.push({ x: Math.floor(e.x - pad), y: Math.floor(e.y - pad), w: Math.ceil(pad * 2), h: Math.ceil(pad * 2) });
        if (this.catchingUp) break;
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
        // 피격 색: 붉은 틴트 (실루엣 전체가 하얗게 덮이지 않도록)
        v.body.setTint(0xff6b6b);
        v.hitFlash = 0.22;
        if (sfx) audio.hit();
        break;
      }
      case 'heal': {
        const p = g.players[e.player];
        this.fx.damageText(p.x, p.y - 30, e.amount, '#7dffa0', '+');
        this.fx.healAura(p.x, p.y);
        break;
      }
      case 'strike': {
        const col = this.weaponColor(e.weapon, g.players[e.owner].charType);
        this.fx.strike(e.x, e.y, e.style, col);
        if (sfx) audio.strike(e.style);
        break;
      }
      case 'sweep': {
        const col = CHAR_TYPES[g.players[e.owner].charType].palette.glow;
        this.fx.dragonSweep(e.x, e.dir, e.step, e.count, (e.interval / TICK_RATE) * 1000, col, (x) => g.terrain.surfaceBelow(x, -2000));
        if (sfx) audio.dragon();
        this.camMode = 'point';
        this.camPoint = { x: e.x + e.dir * e.step * e.count * 0.5, y: e.y };
        this.camHold = (e.count * e.interval) / TICK_RATE + 0.6;
        break;
      }
      case 'teleport': {
        this.fx.shadowPuff(e.fromX, e.fromY - 30);
        this.fx.shadowPuff(e.toX, e.toY - 30);
        const v = this.views[e.player];
        v.body.setAlpha(0.2);
        this.tweens.add({ targets: v.body, alpha: 1, duration: 450 });
        if (sfx) audio.teleport();
        break;
      }
      case 'buff': {
        const p = g.players[e.player];
        this.fx.bigText(p.x, p.y - 100, `다음 공격 ×${e.mult}`, '#d8b4fe');
        break;
      }
      case 'death': {
        const p = g.players[e.player];
        this.fx.bigText(p.x, Math.min(p.y, g.map.liquidY ?? p.y) - 100, e.cause === 'fall' ? '추락!' : e.cause === 'liquid' ? (g.map.liquid === 'lava' ? '용암 낙하!' : '풍덩!') : 'K.O.!', '#ff6b6b');
        if (e.cause === 'liquid') this.fx.splash(p.x, g.map.liquidY!, g.map.liquid === 'lava');
        break;
      }
      case 'projectileOut':
        break;
      case 'splash': {
        const lava = g.map.liquid === 'lava';
        this.fx.splash(e.x, e.y, lava);
        if (sfx) audio.splash(lava);
        this.camMode = 'point';
        this.camPoint = { x: e.x, y: e.y - 40 };
        this.camHold = 0.5;
        break;
      }
      case 'land':
        this.fx.dust(g.players[e.player].x, g.players[e.player].y);
        if (sfx) audio.land();
        break;
      case 'timeout':
        this.fx.bigText(g.players[e.player].x, g.players[e.player].y - 100, '시간 초과', '#ffd23f');
        break;
      case 'gameOver': {
        this.overTimer = 2.2;
        if (sfx) {
          const local = this.cfg.online ? g.players[this.cfg.online.player] : g.players.find((p) => p.controller === 'human');
          const allHuman = !this.cfg.online && g.players.every((p) => p.controller === 'human');
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
    const alpha = Math.min(1, this.acc / DT);
    // 포탄
    for (const [id, s] of this.projSprites) {
      const pr = g.projectiles.find((q) => q.id === id);
      if (!pr) {
        s.destroy();
        this.projSprites.delete(id);
        continue;
      }
      const x = pr.prevX + (pr.x - pr.prevX) * alpha;
      const y = pr.prevY + (pr.y - pr.prevY) * alpha;
      s.update(x, y, pr.vx, pr.vy, pr.facing, dt);
      if (!this.silent && id === g.projectiles[0].id) audio.whistleUpdate(pr.vy);
    }
    // 캐릭터
    const t = this.time.now / 1000;
    g.players.forEach((p, i) => {
      const v = this.views[i];
      const previous = this.previousPlayers[i];
      const interpolate = this.playback && Math.abs(p.x - previous.x) + Math.abs(p.y - previous.y) < 30;
      const px = interpolate ? previous.x + (p.x - previous.x) * alpha : p.x;
      const py = interpolate ? previous.y + (p.y - previous.y) * alpha : p.y;
      const fell = !p.alive && (p.deathCause === 'fall' || p.deathCause === 'liquid');
      if (fell) {
        v.body.setVisible(p.y < (g.map.liquidY !== null ? g.map.liquidY + 30 : g.worldH + 80));
        v.gun.setVisible(false);
      }
      v.hitTimer = Math.max(0, v.hitTimer - dt);
      if (v.hitFlash > 0) {
        v.hitFlash -= dt;
        if (v.hitFlash <= 0 && p.alive) v.body.clearTint();
      }
      v.shootTimer = Math.max(0, v.shootTimer - dt);
      v.knock *= Math.pow(0.0005, dt);
      v.blinkTimer -= dt;
      const moved = Math.abs(px - v.lastX);
      v.walkDist += moved;
      v.lastX = px;
      // 단일 일러스트 → 변형(스케일/기울기/점프)으로 애니메이션
      const isWinner = g.phase === 'over' && p.alive && g.winnerTeam === p.team;
      const walking = moved > 0.01 && p.grounded && p.alive;
      const cs = charScale(p.charType);
      let sx = cs,
        sy = cs,
        rot = 0,
        bx = px + v.knock,
        by = py;
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
        // 다리가 번갈아 걷는 동안 상체는 걸음마다 살짝 출렁임
        rot = -p.facing * 0.03; // 걷기 프레임(다리 휘어짐)이 동작을 담당, 몸은 살짝 앞으로 기울임
      } else if (g.currentPlayer === p && g.phase === 'aiming') {
        // 조준: 각도에 따라 상체가 살짝 들림
        rot = -p.facing * ((p.angle - 30) / 90) * 0.18;
        const br = Math.sin(t * 2.6 + i * 1.7);
        sy *= 1 + br * 0.012;
      } else {
        // 숨쉬기
        const br = Math.sin(t * 2.6 + i * 1.7);
        sy *= 1 + br * 0.018;
        sx *= 1 - br * 0.01;
      }
      // 프레임: 사격=공격, 내 턴(조준/충전/이동)=전투 자세, 그 외=대기
      const myTurn = g.currentPlayer === p && (g.phase === 'aiming' || g.phase === 'turnStart');
      const walkFrame = `walk${Math.floor(v.walkDist / 4.5) % 4}` as FrameName;
      const frame: FrameName = !p.alive || isWinner ? 'idle' : v.shootTimer > 0 ? 'shoot' : walking && v.hitTimer <= 0 ? walkFrame : myTurn ? 'battle' : 'idle';
      const key = `spr_${p.charType}_${frame}`;
      if (v.body.texture.key !== key) v.body.setTexture(key).setOrigin(SPR[p.charType][frame].ox, 1);
      // 좌우 반전은 음수 스케일(발 중심 기준 대칭)
      v.body.setScale(sx * p.facing, sy);
      v.body.setPosition(bx, by);
      v.body.rotation += (rot - v.body.rotation) * Math.min(1, dt * (p.alive ? 18 : 8));
      if (!p.alive) v.body.setTint(0x8a8a9a);
      this.syncLegs(v, p, frame, walking, bx, by, sx, sy);
      // 무기
      const showGun = false; // 무기는 캐릭터 스프라이트에 포함
      v.gun.setVisible(showGun);
      if (showGun) {
        const recoil = v.shootTimer > 0 ? -3 * (v.shootTimer / 0.35) : 0;
        const ang = Phaser.Math.DegToRad(Math.round(p.angle));
        const rx = p.facing * cosDeg(Math.round(p.angle)) * recoil;
        const ry = -sinDeg(Math.round(p.angle)) * recoil;
        v.gun.setPosition(Math.round(bx + rx + p.facing * 2), Math.round(by - MUZZLE_HEIGHT + ry));
        v.gun.setScale(p.facing * GUN_SCALE, GUN_SCALE);
        v.gun.setRotation(p.facing === 1 ? -ang : ang);
      }
      // 접지 그림자
      const ground = p.alive && !fell ? this.game2.terrain.surfaceBelow(p.x, p.y - 2) : -1;
      const gap = ground >= 0 ? ground - p.y : 999;
      v.shadow.setVisible(gap < 60 && !fell);
      if (gap < 60) v.shadow.setPosition(px, ground + 1).setAlpha(0.42 * (1 - gap / 60)).setScale(0.62 * (1 - gap / 120), 0.14);
      // 이름판 + 체력바 (발밑, 이미지1 스타일)
      v.shownHp += (p.hp - v.shownHp) * Math.min(1, dt * 6);
      const show = p.alive && !fell;
      v.label.setVisible(show);
      v.hpText.setVisible(show);
      v.hpBar.clear();
      if (show) {
        const pw = 56,
          px0 = Math.round(px - pw / 2),
          py0 = Math.round(by + 9);
        const team = p.team === 0 ? 0x3b82f6 : 0xef4444;
        // 체력바
        v.hpBar.fillStyle(0x06101f, 0.95).fillRect(px0 + 2, py0 - 6, pw - 4, 5);
        v.hpBar.fillStyle(0xffffff, 0.55).fillRect(px0 + 3, py0 - 5, ((pw - 6) * v.shownHp) / 100, 3);
        const col = p.hp > 50 ? 0x3ee06a : p.hp > 25 ? 0xffd23f : 0xff4d5e;
        v.hpBar.fillStyle(col, 1).fillRect(px0 + 3, py0 - 5, ((pw - 6) * p.hp) / 100, 3);
        v.hpBar.fillStyle(0xffffff, 0.45).fillRect(px0 + 3, py0 - 5, ((pw - 6) * p.hp) / 100, 1);
        // 남색 이름판
        v.hpBar.fillStyle(0x0a1838, 0.94).fillRoundedRect(px0, py0, pw, 21, 3);
        v.hpBar.lineStyle(1, 0x4f8dff, 1).strokeRoundedRect(px0 + 0.5, py0 + 0.5, pw - 1, 20, 3);
        v.hpBar.fillStyle(team, 1).fillRect(px0 + 3, py0 + 3, 2, 15);
        v.label.setPosition(Math.round(px + 2), py0 + 1);
        v.hpText.setText(`${p.hp} / 100`).setPosition(Math.round(px + 2), py0 + 11);
      }
    });
    // 현재 턴 표시 + 조준선
    const cp = g.currentPlayer;
    const cv = this.views[g.current];
    this.aimGfx.clear();
    this.aimText?.setVisible(false);
    const showMarker = (g.phase === 'aiming' || g.phase === 'turnStart') && cp.alive;
    this.marker.setVisible(showMarker);
    if (showMarker) {
      this.marker.setPosition(cv.body.x, Math.round(cv.body.y - 92 + Math.sin(t * 5) * 2.5));
      if (g.phase === 'aiming') {
        const a = Math.round(cp.angle);
        const ox = cv.body.x,
          oy = cv.body.y - MUZZLE_HEIGHT;
        const dx = cp.facing * cosDeg(a),
          dy = -sinDeg(a);
        // 각도 호 (0°~90° 눈금)
        this.aimGfx.lineStyle(1.5, 0xffffff, 0.35);
        this.aimGfx.beginPath();
        this.aimGfx.arc(ox, oy, 50, cp.facing === 1 ? -Math.PI / 2 : Math.PI, cp.facing === 1 ? 0 : -Math.PI / 2, false);
        this.aimGfx.strokePath();
        // 조준 화살표: 어두운 외곽선 + 노랑→주황 몸통 + 큰 화살촉, 살짝 맥동
        const local = this.isLocalTurn();
        const pulse = 1 + Math.sin(t * 6) * 0.06;
        const s0 = 54,
          L = 100 * pulse; // 시작/끝 거리
        const px = -dy,
          py = dx; // 수직 방향
        const pt = (d: number, o: number) => ({ x: ox + dx * d + px * o, y: oy + dy * d + py * o });
        const shaft = (wd: number) => [pt(s0, -wd), pt(L - 12, -wd), pt(L - 12, wd), pt(s0, wd)];
        const head = (wd: number, ex: number) => [pt(L - 14 - ex, -wd), pt(L + ex, 0), pt(L - 14 - ex, wd)];
        const fill = (pts: { x: number; y: number }[], col: number, al: number) => {
          this.aimGfx.fillStyle(col, al);
          this.aimGfx.fillPoints(pts as Phaser.Types.Math.Vector2Like[], true);
        };
        const main = local ? 0xffd23f : 0xdfe8ff,
          tip = local ? 0xff7a1a : 0x8cc4ff;
        fill(shaft(4.2), 0x1a0a14, 0.85);
        fill(head(10, 2.2), 0x1a0a14, 0.85);
        fill(shaft(2.4), main, 1);
        fill(head(8, 0), tip, 1);
        fill([pt(s0, -0.8), pt(L - 12, -0.8), pt(L - 12, 0.2), pt(s0, 0.2)], 0xffffff, 0.75);
        // 각도 숫자
        const lp = pt(L + 16, 0);
        if (!this.aimText) this.aimText = this.add.text(0, 0, '', { fontFamily: '"Pretendard","Noto Sans KR",sans-serif', fontSize: '9px', fontStyle: '900', color: '#ffe14d', stroke: '#1a0a14', strokeThickness: 3 }).setOrigin(0.5).setDepth(26).setResolution(6);
        this.aimText.setText(`${a}°`).setPosition(Math.round(lp.x), Math.round(lp.y)).setVisible(true);
      }
    }
  }

  /** 카메라 이동 후 같은 프레임에 배경 위치 갱신 (지연/떨림 방지) */
  private updateParallax() {
    const t = this.time.now / 1000;
    if (this.liquidTiles.length) {
      this.liquidTiles[0].tilePositionX = t * 14;
      this.liquidTiles[1].tilePositionX = -t * 22 + 80;
    }
    const vx = this.camX - VIEW_W / 2,
      vy = this.camY - VIEW_H / 2;
    for (const b of this.bgImages) {
      if (b.kind === 'sky') b.img.setPosition(vx, vy);
      else if (b.kind === 'cloud') {
        b.img.setPosition(vx, vy + b.y - (vy - CAM_TOP) * 0.05);
        (b.img as Phaser.GameObjects.TileSprite).tilePositionX = vx * b.factor + t * 4;
      } else {
        const fy = b.factor * 0.6;
        const bob = b.bob ? Math.sin(t * (b.bobSpeed ?? 0.3) + (b.phase ?? 0)) * b.bob : 0;
        b.img.setPosition(vx * (1 - b.factor) + (b.ox ?? 0), vy * (1 - fy) + CAM_TOP * fy + (b.oy ?? 0) + bob);
        if (b.spin) b.img.rotation += b.spin * 0.016;
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
        ty = p.y + 10; // 하단 UI를 피해 캐릭터를 화면 위쪽 중앙에
        speed = 4;
        break;
      }
      case 'projectile': {
        const pr = g.projectiles[0];
        if (pr) {
          tx = pr.x + pr.vx * 0.22;
          ty = pr.y + pr.vy * 0.18 + 50;
          speed = 7;
        } else {
          tx = this.camPoint.x;
          ty = this.camPoint.y;
        }
        break;
      }
      case 'point':
        tx = this.camPoint.x;
        ty = this.camPoint.y + 40;
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
    this.camY = Phaser.Math.Clamp(this.camY, CAM_TOP + VIEW_H / 2, g.worldH + CAM_EXTRA - VIEW_H / 2);
    // centerOn과 동일: scroll = center - (캔버스 크기)/2
    const cam = this.cameras.main;
    cam.scrollX = this.camX - cam.width / 2;
    cam.scrollY = this.camY - cam.height / 2;
  }

  private weaponColor(w: WeaponId, owner: CharTypeId): string {
    return WEAPONS[w].color ?? CHAR_TYPES[owner].palette.accent;
  }

  /** 다리 걷기 애니메이션: 스프라이트 하단(다리)을 좌·우로 잘라 걸음 주기에 맞춰 번갈아 들어 올리고 앞뒤로 내딛는다 */
  private syncLegs(v: CharView, _p: Player, _f: FrameName, _w: boolean, _bx: number, _by: number, _sx: number, _sy: number) {
    // 걷기는 미리 만든 4프레임(다리만 부드럽게 휘어짐, 잘린 이음새 없음)으로 표현 → 분리 다리 스프라이트는 사용 안 함
    v.legL.setVisible(false);
    v.legR.setVisible(false);
  }

  /** 미니맵 클릭 등으로 특정 지점 보기 */
  lookAt(x: number, y: number) {
    this.camMode = 'free';
    this.camX = x;
    this.camY = y;
  }

  /** 미니맵/HUD용 */
  get cameraCenter() {
    return { x: this.camX, y: this.camY };
  }
}
