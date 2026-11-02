import {
  AIM_SPEED,
  BODY_CENTER_Y,
  BODY_RADIUS,
  DT,
  GRAVITY,
  MAX_ANGLE,
  MAX_GAUGE,
  MAX_HP,
  MIN_ANGLE,
  MOVE_PER_TURN,
  PROJECTILE_MAX_TICKS,
  SETTLE_MAX_TICKS,
  SETTLE_MIN_TICKS,
  TURN_START_TICKS,
  TURN_TICKS,
  WALK_SPEED,
  WIND_MAX,
  WORLD_H,
  WORLD_W,
} from './constants';
import { CHAR_TYPES, type CharTypeId } from './characters';

/** 특수탄 재사용 대기 (내 턴 수) */
export const SPECIAL_COOLDOWN = 3;
/** 이동탄 재사용 대기 (내 턴 수) */
export const MOVE_SHOT_COOLDOWN = 3;
export const MOVE_SHOT = 'move_shot';
const CAM_SURFACE_TOP = -2000;
import { generateMap, type MapId, type MapInfo } from './mapgen';
import { bodyCircle, hasGround, launch, stepGravity, stepProjectile, stepWalk, type Circle, type Mover, type Projectile } from './physics';
import { Rng } from './rng';
import type { Rect, Terrain } from './terrain';
import { WEAPONS, type WeaponId } from './weapons';

export type AiLevel = 'easy' | 'normal' | 'hard';

export interface PlayerSetup {
  name: string;
  charType: CharTypeId;
  team: number;
  controller: 'human' | 'ai';
  aiLevel?: AiLevel;
}

export interface Player extends Mover {
  id: number;
  name: string;
  charType: CharTypeId;
  team: number;
  controller: 'human' | 'ai';
  aiLevel: AiLevel;
  hp: number;
  alive: boolean;
  facing: 1 | -1;
  angle: number;
  gauge: number;
  moveLeft: number;
  lastPower: number | null;
  deathCause: 'hp' | 'fall' | 'liquid' | null;
  /** 특수탄 재사용까지 남은 내 턴 수 (0이면 사용 가능) */
  specialCd: number;
  /** 이동탄 재사용까지 남은 내 턴 수 */
  moveShotCd: number;
  /** 다음 공격 피해 배율 (섀도우 스텝) */
  buff: number;
  /** 이번 발사의 피해 배율 */
  shotMult: number;
}

export interface LiveProjectile extends Projectile {
  id: number;
  weapon: WeaponId;
  owner: number;
  facing: 1 | -1;
  prevX: number;
  prevY: number;
}

export type Phase = 'turnStart' | 'aiming' | 'flying' | 'settling' | 'over';

export type GameEvent =
  | { type: 'turnStart'; player: number; wind: number; round: number }
  | { type: 'fire'; player: number; weapon: WeaponId; x: number; y: number; power: number; angle: number }
  | { type: 'explode'; x: number; y: number; radius: number; weapon: WeaponId; rect: Rect | null; owner: number; seed: number }
  | { type: 'damage'; player: number; amount: number; hp: number; from: number; x: number; y: number }
  | { type: 'death'; player: number; cause: 'hp' | 'fall' | 'liquid' }
  | { type: 'projectileOut'; x: number; y: number }
  | { type: 'splash'; x: number; y: number; weapon: WeaponId }
  | { type: 'spawnProjectile'; id: number; weapon: WeaponId }
  | { type: 'land'; player: number }
  | { type: 'heal'; player: number; amount: number; hp: number }
  | { type: 'strike'; x: number; y: number; style: 'lightning' | 'beam' | 'sky'; weapon: WeaponId; owner: number }
  | { type: 'sweep'; x: number; y: number; dir: 1 | -1; step: number; count: number; interval: number; owner: number }
  | { type: 'teleport'; player: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'buff'; player: number; mult: number }
  | { type: 'timeout'; player: number }
  | { type: 'gameOver'; winnerTeam: number | null };

export interface InputState {
  move: -1 | 0 | 1;
  aim: -1 | 0 | 1;
}

export interface GameOptions {
  seed: number;
  players: PlayerSetup[];
  mapId?: MapId;
}

/**
 * 게임 규칙의 단일 진실 공급원. 렌더링/입력과 무관한 결정론적 상태 머신.
 * step()은 정확히 1틱(DT)만 진행한다. 렌더러는 고정 타임스텝 누적기로 호출한다.
 * 온라인 대전에서는 서버가 이 클래스를 그대로 실행해 최종 판정한다.
 */
export class Game {
  readonly seed: number;
  readonly terrain: Terrain;
  readonly material: Uint8Array;
  readonly map: MapInfo;
  readonly gravity: number;
  readonly worldW = WORLD_W;
  readonly worldH = WORLD_H;
  readonly mapId: MapId;
  readonly players: Player[];
  projectiles: LiveProjectile[] = [];
  phase: Phase = 'turnStart';
  phaseTicks = 0;
  tick = 0;
  turnTicksLeft = TURN_TICKS;
  current = 0;
  round = 1;
  turnNumber = 0;
  wind = 0;
  winnerTeam: number | null = null;
  input: InputState = { move: 0, aim: 0 };
  /** 렌더러가 매 프레임 비우는 이벤트 큐 */
  events: GameEvent[] = [];
  private rng: Rng;
  private nextProjId = 1;
  private shotFiredThisTurn = false;

  constructor(opts: GameOptions) {
    this.seed = opts.seed;
    this.mapId = opts.mapId ?? 'herb_forest';
    this.rng = new Rng(opts.seed);
    const map = generateMap(opts.seed ^ 0x5eed, opts.players.length, this.mapId);
    this.terrain = map.terrain;
    this.material = map.material;
    this.map = map.info;
    this.gravity = GRAVITY * map.info.gravityScale;
    this.players = opts.players.map((s, i) => {
      const x = map.spawnXs[i];
      const y = Math.max(0, this.terrain.surfaceBelow(x, 0));
      return {
        id: i,
        name: s.name,
        charType: s.charType,
        team: s.team,
        controller: s.controller,
        aiLevel: s.aiLevel ?? 'normal',
        x,
        y,
        vy: 0,
        grounded: true,
        hp: MAX_HP,
        alive: true,
        facing: x < WORLD_W / 2 ? 1 : -1,
        angle: 45,
        gauge: 0,
        moveLeft: MOVE_PER_TURN,
        lastPower: null,
        deathCause: null,
        specialCd: 0,
        moveShotCd: 0,
        buff: 1,
        shotMult: 1,
      } satisfies Player;
    });
    // 첫 턴 시작 플레이어는 시드로 결정
    this.current = this.rng.int(0, this.players.length - 1);
    this.beginTurn(this.current, true);
  }

  get currentPlayer(): Player {
    return this.players[this.current];
  }

  /** 현재 턴 플레이어가 조작 가능한 상태인가 */
  get canControl(): boolean {
    return this.phase === 'aiming' && this.currentPlayer.alive;
  }

  setInput(input: Partial<InputState>) {
    this.input = { ...this.input, ...input };
  }

  /** 발사 명령. 조작 가능 상태가 아니면 무시(턴 전환 중 입력 오류 방지).
   *  kind: basic=기본탄(무제한), special=특수탄(3턴 재사용 대기), ultimate=필살기(게이지 100) */
  fire(kind: 'basic' | 'special' | 'ultimate' | 'move', power: number): boolean {
    if (!this.canControl || this.shotFiredThisTurn) return false;
    const p = this.currentPlayer;
    if (!p.grounded) return false;
    const def = CHAR_TYPES[p.charType];
    let weapon: WeaponId = def.basic.weapon;
    if (kind === 'special') {
      if (p.specialCd > 0) return false;
      weapon = def.special.weapon;
      p.specialCd = SPECIAL_COOLDOWN;
    } else if (kind === 'move') {
      if (p.moveShotCd > 0) return false;
      weapon = MOVE_SHOT;
      p.moveShotCd = MOVE_SHOT_COOLDOWN;
    } else if (kind === 'ultimate') {
      if (p.gauge < MAX_GAUGE) return false;
      weapon = def.ultimate.weapon;
      p.gauge = 0;
    }
    const pw = Math.max(0, Math.min(100, Math.round(power * 10) / 10));
    p.shotMult = p.buff;
    p.buff = 1;
    const w = WEAPONS[weapon];
    const angle = Math.round(p.angle);
    const shoot = (da: number, pm: number) => {
      const proj = launch({ footX: p.x, footY: p.y, facing: p.facing, angle: Math.max(-10, Math.min(100, angle + da)), power: pw * pm });
      const sp = w.speedScale ?? 1;
      proj.vx *= sp;
      proj.vy *= sp;
      this.spawn(proj, weapon, p.id, p.facing);
      return proj;
    };
    let first: Projectile;
    if (w.burst) {
      const bu = w.burst;
      first = shoot(bu.angles[0] ?? 0, bu.powers[0] ?? 1);
      for (let k = 1; k < bu.count; k++) {
        const da = bu.angles[k % bu.angles.length] ?? 0,
          pm = bu.powers[k % bu.powers.length] ?? 1;
        this.schedule(k * bu.interval, () => {
          if (p.alive) shoot(da, pm);
        });
      }
    } else {
      const shots = w.spread ?? [{ angle: 0, power: 1 }];
      first = shoot(shots[0].angle, shots[0].power);
      for (let k = 1; k < shots.length; k++) shoot(shots[k].angle, shots[k].power);
    }
    p.lastPower = pw;
    this.shotFiredThisTurn = true;
    this.events.push({ type: 'fire', player: p.id, weapon, x: first.x, y: first.y, power: pw, angle });
    this.input = { move: 0, aim: 0 };
    this.setPhase('flying');
    return true;
  }

  /** n틱 뒤 실행 (발사 중 연사/낙뢰/화살비 등) — 등록 순서대로 결정론적으로 실행 */
  private pending: { tick: number; seq: number; run: () => void }[] = [];
  private seq = 0;
  private schedule(delayTicks: number, run: () => void) {
    this.pending.push({ tick: this.tick + Math.max(1, Math.round(delayTicks)), seq: this.seq++, run });
  }
  private runPending() {
    if (!this.pending.length) return;
    const due = this.pending.filter((p) => p.tick <= this.tick).sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.tick > this.tick);
    for (const d of due) d.run();
  }

  /** 제자리에서 방향 전환 (조작 가능할 때만) */
  setFacing(dir: 1 | -1) {
    if (this.canControl) this.currentPlayer.facing = dir;
  }

  /** 각도 직접 지정 (AI/네트워크 명령용) */
  setAngle(a: number) {
    if (this.canControl) this.currentPlayer.angle = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, a));
  }

  /** 턴 넘기기(시간 초과와 동일 처리) */
  skipTurn() {
    if (!this.canControl) return;
    this.input = { move: 0, aim: 0 };
    this.setPhase('settling');
  }

  /** Server-authorized disconnect/leave, replayed identically by every client. */
  forfeit(id: number) {
    const p = this.players[id];
    if (!p || !p.alive || this.phase === 'over') return;
    p.hp = 0; p.alive = false; p.deathCause = 'hp';
    this.events.push({ type: 'death', player: id, cause: 'hp' });
    if (this.checkGameOver()) return;
    if (this.current === id && (this.phase === 'aiming' || this.phase === 'turnStart')) {
      this.input = { move: 0, aim: 0 }; this.setPhase('settling');
    }
  }

  private spawn(proj: Projectile, weapon: WeaponId, owner: number, facing: 1 | -1) {
    const id = this.nextProjId++;
    this.projectiles.push({ ...proj, id, weapon, owner, facing, prevX: proj.x, prevY: proj.y });
    this.events.push({ type: 'spawnProjectile', id, weapon });
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseTicks = 0;
  }

  bodies(): Circle[] {
    const out: Circle[] = [];
    for (const p of this.players) if (p.alive) out.push(bodyCircle(p, p.id));
    return out;
  }

  /** 1틱 진행 */
  step() {
    if (this.phase === 'over') return;
    this.tick++;
    this.phaseTicks++;

    switch (this.phase) {
      case 'turnStart':
        if (this.phaseTicks >= TURN_START_TICKS) this.setPhase('aiming');
        break;
      case 'aiming':
        this.stepAiming();
        break;
      case 'flying':
        this.runPending();
        this.stepProjectiles();
        if (this.projectiles.length === 0 && this.pending.length === 0) this.setPhase('settling');
        break;
      case 'settling': {
        const allSettled = this.players.every((p) => !p.alive || p.grounded);
        if ((allSettled && this.phaseTicks >= SETTLE_MIN_TICKS) || this.phaseTicks >= SETTLE_MAX_TICKS) {
          if (!this.checkGameOver()) this.nextTurn();
        }
        break;
      }
    }

    // 모든 캐릭터 중력 (폭발로 지형이 바뀐 같은 틱 안에 반영)
    for (const p of this.players) {
      if (!p.alive && (p.deathCause === 'fall' || p.deathCause === 'liquid')) continue;
      const landed = stepGravity(p, this.terrain, this.gravity);
      if (landed && p.alive) this.events.push({ type: 'land', player: p.id });
      if (this.map.liquidY !== null && p.y > this.map.liquidY + 6 && p.alive) this.kill(p, 'liquid');
      else if (p.y > this.worldH + 40 && p.alive) this.kill(p, 'fall');
    }

  }

  private stepAiming() {
    const p = this.currentPlayer;
    if (!p.alive) {
      this.setPhase('settling');
      return;
    }
    this.turnTicksLeft--;
    if (this.input.aim !== 0) {
      p.angle = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, p.angle + this.input.aim * AIM_SPEED * DT));
    }
    if (this.input.move !== 0) {
      const dir = this.input.move;
      p.facing = dir;
      if (p.moveLeft > 0 && p.grounded) {
        const moved = stepWalk(p, this.terrain, dir, WALK_SPEED, this.worldW);
        p.moveLeft = Math.max(0, p.moveLeft - moved);
      }
    }
    if (this.turnTicksLeft <= 0) {
      this.events.push({ type: 'timeout', player: p.id });
      this.input = { move: 0, aim: 0 };
      this.setPhase('settling');
    }
  }

  private stepProjectiles() {
    const bodies = this.bodies();
    const impacts: { pr: LiveProjectile; x: number; y: number; direct: number }[] = [];
    this.projectiles = this.projectiles.filter((pr) => {
      pr.prevX = pr.x;
      pr.prevY = pr.y;
      const def = WEAPONS[pr.weapon];
      if (def.homing) this.steerHoming(pr, def.homing);
      const hit = stepProjectile(pr, this.wind * (def.windFactor ?? 1), this.terrain, bodies, this.worldW, this.worldH, this.gravity * (def.gravityScale ?? 1));
      // 물/용암에 빠짐
      if (!hit && this.map.liquidY !== null && pr.y >= this.map.liquidY && pr.vy > 0) {
        this.events.push({ type: 'splash', x: pr.x, y: this.map.liquidY, weapon: pr.weapon });
        return false;
      }
      if (!hit) {
        if (pr.age > PROJECTILE_MAX_TICKS) {
          this.events.push({ type: 'projectileOut', x: pr.x, y: pr.y });
          return false;
        }
        return true;
      }
      if (hit.kind === 'out') {
        this.events.push({ type: 'projectileOut', x: hit.x, y: hit.y });
        return false;
      }
      impacts.push({ pr, x: hit.x, y: hit.y, direct: hit.kind === 'char' ? hit.id : -1 });
      return false;
    });
    for (const im of impacts) {
      if (WEAPONS[im.pr.weapon].radius > 0) this.explode(im.x, im.y, im.pr.weapon, im.pr.owner, im.direct);
      this.applyImpactFx(im.pr, im.x, im.y);
    }
  }

  /** 가장 가까운 적 몸통을 향해 가속 (사칙연산·제곱근만 사용) */
  private steerHoming(pr: LiveProjectile, accel: number) {
    const owner = this.players[pr.owner];
    let best: Player | null = null,
      bd = Infinity;
    for (const p of this.players) {
      if (!p.alive || p.team === owner.team) continue;
      const dx = p.x - pr.x,
        dy = p.y - BODY_CENTER_Y - pr.y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best || pr.age < 20) return; // 발사 직후엔 그대로 날아감
    const dx = best.x - pr.x,
      dy = best.y - BODY_CENTER_Y - pr.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    pr.vx += (dx / len) * accel * DT;
    pr.vy += (dy / len) * accel * DT;
  }

  /** 지표면 높이 (위에서부터 처음 만나는 땅). 없으면 -1 */
  private surfaceAt(x: number): number {
    return this.terrain.surfaceBelow(x, CAM_SURFACE_TOP);
  }

  private applyImpactFx(pr: LiveProjectile, x: number, y: number) {
    const def = WEAPONS[pr.weapon];
    const owner = this.players[pr.owner];
    for (const fx of def.onImpact ?? []) {
      switch (fx.kind) {
        case 'children':
          for (const c of fx.list) {
            let sy = y - 6;
            for (let k = 0; k < 40 && this.terrain.isSolid(x, sy); k++) sy -= 1;
            this.spawn({ x, y: sy, vx: c.vx * pr.facing, vy: c.vy, age: 1 }, c.weapon, pr.owner, pr.facing);
          }
          break;
        case 'rain':
          fx.offsets.forEach((off, i) => {
            this.schedule(fx.delayStep * (i + 1), () => {
              const rx = x + off * pr.facing;
              this.spawn({ x: rx, y: y - fx.height, vx: 0, vy: fx.vy, age: 1 }, fx.weapon, pr.owner, pr.facing);
            });
          });
          break;
        case 'strikes':
          fx.offsets.forEach((off, i) => {
            this.schedule(fx.delayStep * (i + 1), () => {
              const sx = Math.round(x + off * pr.facing);
              const top = this.surfaceAt(sx);
              // 그 열에 서 있는 캐릭터가 있으면 캐릭터 먼저 맞음
              let ty = top;
              let direct = -1;
              for (const p of this.players) {
                if (!p.alive) continue;
                if (Math.abs(p.x - sx) <= BODY_RADIUS && (ty < 0 || p.y - BODY_CENTER_Y * 2 < ty)) {
                  ty = p.y - BODY_CENTER_Y;
                  direct = p.id;
                }
              }
              if (ty < 0) return;
              this.events.push({ type: 'strike', x: sx, y: ty, style: fx.style, weapon: fx.weapon, owner: pr.owner });
              this.explode(sx, ty, fx.weapon, pr.owner, direct);
            });
          });
          break;
        case 'sweep': {
          const dir = pr.facing;
          this.events.push({ type: 'sweep', x, y, dir, step: fx.step, count: fx.count, interval: fx.delayStep, owner: pr.owner });
          for (let i = 1; i <= fx.count; i++) {
            this.schedule(fx.delayStep * i, () => {
              const sx = Math.round(x + dir * fx.step * i);
              if (sx < 0 || sx >= this.worldW) return;
              const top = this.surfaceAt(sx);
              if (top < 0) return;
              this.explode(sx, top, fx.weapon, pr.owner, -1);
            });
          }
          break;
        }
        case 'global': {
          const targets = this.players.filter((p) => p.alive && p.team !== owner.team);
          targets.forEach((t, i) => {
            this.schedule(fx.delayStep * (i + 1), () => {
              if (!t.alive) return;
              const tx = t.x,
                ty = t.y - BODY_CENTER_Y;
              this.events.push({ type: 'strike', x: tx, y: ty, style: 'sky', weapon: fx.weapon, owner: pr.owner });
              this.explode(tx, ty, fx.weapon, pr.owner, t.id);
            });
          });
          break;
        }
        case 'teleport': {
          if (!owner.alive) break;
          const tx = Math.max(12, Math.min(this.worldW - 12, x));
          let ty = Math.floor(y);
          for (let k = 0; k < 120 && hasGround(this.terrain, tx, ty - 1); k++) ty--;
          this.events.push({ type: 'teleport', player: owner.id, fromX: owner.x, fromY: owner.y, toX: tx, toY: ty });
          owner.x = tx;
          owner.y = ty;
          owner.vy = 0;
          owner.grounded = false;
          break;
        }
        case 'buff':
          owner.buff = fx.mult;
          this.events.push({ type: 'buff', player: owner.id, mult: fx.mult });
          break;
      }
    }
  }

  /** 폭발 처리: 지형 제거 → 피해 계산. 모든 효과는 실제 충돌 지점(x,y) 기준. */
  explode(x: number, y: number, weapon: WeaponId, owner: number, directId: number) {
    const def = WEAPONS[weapon];
    const seed = this.rng.nextU32();
    const rect = this.terrain.carve(x, y, def.radius, seed);
    this.events.push({ type: 'explode', x, y, radius: def.radius, weapon, rect, owner, seed });
    for (const p of this.players) {
      if (!p.alive) continue;
      const mult = this.players[owner]?.shotMult ?? 1;
      const amount = Math.round(computeDamage(def.damage, def.radius, x, y, p, p.id === directId) * mult);
      if (amount <= 0) continue;
      p.hp = Math.max(0, p.hp - amount);
      this.events.push({ type: 'damage', player: p.id, amount, hp: p.hp, from: owner, x: p.x, y: p.y - BODY_CENTER_Y });
      const ow = this.players[owner];
      if (ow && ow.team !== p.team) ow.gauge = Math.min(MAX_GAUGE, ow.gauge + amount);
      if (p.id !== owner) p.gauge = Math.min(MAX_GAUGE, p.gauge + Math.round(amount * 0.5));
      if (p.hp <= 0) this.kill(p, 'hp');
    }
    const ow = this.players[owner];
    if (def.selfHeal && ow && ow.alive) {
      const before = ow.hp;
      ow.hp = Math.min(MAX_HP, ow.hp + def.selfHeal);
      if (ow.hp > before) this.events.push({ type: 'heal', player: ow.id, amount: ow.hp - before, hp: ow.hp });
    }
  }

  private kill(p: Player, cause: 'hp' | 'fall' | 'liquid') {
    if (!p.alive) return;
    p.alive = false;
    p.deathCause = cause;
    if (cause !== 'hp') p.hp = 0;
    this.events.push({ type: 'death', player: p.id, cause });
  }

  private checkGameOver(): boolean {
    const teams = new Set(this.players.filter((p) => p.alive).map((p) => p.team));
    if (teams.size <= 1) {
      this.winnerTeam = teams.size === 1 ? [...teams][0] : null;
      this.setPhase('over');
      this.events.push({ type: 'gameOver', winnerTeam: this.winnerTeam });
      return true;
    }
    return false;
  }

  private nextTurn() {
    const n = this.players.length;
    let idx = this.current;
    for (let k = 1; k <= n; k++) {
      const cand = (this.current + k) % n;
      if (this.players[cand].alive) {
        if (cand <= this.current) this.round++;
        idx = cand;
        break;
      }
    }
    this.beginTurn(idx, false);
  }

  private beginTurn(idx: number, first: boolean) {
    this.current = idx;
    this.turnNumber++;
    const p = this.players[idx];
    p.moveLeft = MOVE_PER_TURN;
    if (!first) {
      p.gauge = Math.min(MAX_GAUGE, p.gauge + 10);
      if (p.specialCd > 0) p.specialCd--;
      if (p.moveShotCd > 0) p.moveShotCd--;
    }
    p.shotMult = 1;
    this.pending = [];
    this.turnTicksLeft = TURN_TICKS;
    this.shotFiredThisTurn = false;
    this.input = { move: 0, aim: 0 };
    // 맵의 바람 배율 적용 (달: 0 = 무풍)
    const rawWind = this.rng.int(-WIND_MAX, WIND_MAX);
    this.wind = Math.max(-WIND_MAX, Math.min(WIND_MAX, Math.round(rawWind * this.map.windScale))) || 0; // -0 방지
    this.setPhase('turnStart');
    this.events.push({ type: 'turnStart', player: idx, wind: this.wind, round: this.round });
  }

  /** 상태 해시 — 서버/클라이언트 동기화 검증 및 회귀 테스트용 */
  stateHash(): string {
    const ps = this.players.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.hp},${p.alive ? 1 : 0},${p.gauge}`).join('|');
    return `${this.tick}:${this.current}:${this.wind}:${this.terrain.checksum()}:${ps}`;
  }
}

/**
 * 거리별 피해량: 피격 원 표면까지의 거리 d 기준, 폭발 반경 내에서 100% → 25% 선형 감소.
 * 직격이면 최대 피해.
 */
export function computeDamage(base: number, radius: number, ex: number, ey: number, m: Mover, direct: boolean): number {
  if (direct) return base;
  const cx = m.x,
    cy = m.y - BODY_CENTER_Y;
  const dist = Math.sqrt((ex - cx) * (ex - cx) + (ey - cy) * (ey - cy));
  const d = Math.max(0, dist - BODY_RADIUS);
  if (d >= radius) return 0;
  return Math.max(1, Math.round(base * (1 - 0.75 * (d / radius))));
}
