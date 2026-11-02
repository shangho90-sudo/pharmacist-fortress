import {
  AIM_SPEED,
  BODY_CENTER_Y,
  BODY_RADIUS,
  DT,
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
import { generateMap } from './mapgen';
import { bodyCircle, launch, stepGravity, stepProjectile, stepWalk, type Circle, type Mover, type Projectile } from './physics';
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
  deathCause: 'hp' | 'fall' | null;
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
  | { type: 'death'; player: number; cause: 'hp' | 'fall' }
  | { type: 'projectileOut'; x: number; y: number }
  | { type: 'spawnProjectile'; id: number; weapon: WeaponId }
  | { type: 'land'; player: number }
  | { type: 'heal'; player: number; amount: number; hp: number }
  | { type: 'timeout'; player: number }
  | { type: 'gameOver'; winnerTeam: number | null };

export interface InputState {
  move: -1 | 0 | 1;
  aim: -1 | 0 | 1;
}

export interface GameOptions {
  seed: number;
  players: PlayerSetup[];
  mapId?: string;
}

/**
 * 게임 규칙의 단일 진실 공급원. 렌더링/입력과 무관한 결정론적 상태 머신.
 * step()은 정확히 1틱(DT)만 진행한다. 렌더러는 고정 타임스텝 누적기로 호출한다.
 * 온라인 대전에서는 서버가 이 클래스를 그대로 실행해 최종 판정한다.
 */
export class Game {
  readonly seed: number;
  readonly terrain: Terrain;
  readonly surface: Int16Array;
  readonly worldW = WORLD_W;
  readonly worldH = WORLD_H;
  readonly mapId: string;
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
    const map = generateMap(opts.seed ^ 0x5eed, opts.players.length);
    this.terrain = map.terrain;
    this.surface = map.surface;
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

  /** 발사 명령. 조작 가능 상태가 아니면 무시(턴 전환 중 입력 오류 방지). */
  fire(kind: 'basic' | 'special', power: number): boolean {
    if (!this.canControl || this.shotFiredThisTurn) return false;
    const p = this.currentPlayer;
    let weapon: WeaponId = 'basic';
    if (kind === 'special') {
      if (p.gauge < MAX_GAUGE) return false;
      weapon = CHAR_TYPES[p.charType].special;
      p.gauge = 0;
    }
    if (!p.grounded) return false;
    const pw = Math.max(0, Math.min(100, Math.round(power * 10) / 10));
    const shots = WEAPONS[weapon].spread ?? [{ angle: 0, power: 1 }];
    let first: Projectile | null = null;
    for (const sh of shots) {
      const proj = launch({ footX: p.x, footY: p.y, facing: p.facing, angle: Math.max(-10, Math.min(100, Math.round(p.angle) + sh.angle)), power: pw * sh.power });
      first ??= proj;
      this.spawn(proj, weapon, p.id, p.facing);
    }
    p.lastPower = pw;
    this.shotFiredThisTurn = true;
    this.events.push({ type: 'fire', player: p.id, weapon, x: first!.x, y: first!.y, power: pw, angle: Math.round(p.angle) });
    this.input = { move: 0, aim: 0 };
    this.setPhase('flying');
    return true;
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
        this.stepProjectiles();
        if (this.projectiles.length === 0) this.setPhase('settling');
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
      if (!p.alive && p.deathCause === 'fall') continue;
      const landed = stepGravity(p, this.terrain);
      if (landed && p.alive) this.events.push({ type: 'land', player: p.id });
      if (p.y > this.worldH + 40 && p.alive) this.kill(p, 'fall');
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
    const spawned: { proj: Projectile; weapon: WeaponId; owner: number; facing: 1 | -1 }[] = [];
    this.projectiles = this.projectiles.filter((pr) => {
      pr.prevX = pr.x;
      pr.prevY = pr.y;
      const hit = stepProjectile(pr, this.wind * (WEAPONS[pr.weapon].windFactor ?? 1), this.terrain, bodies, this.worldW, this.worldH);
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
      this.explode(hit.x, hit.y, pr.weapon, pr.owner, hit.kind === 'char' ? hit.id : -1);
      const def = WEAPONS[pr.weapon];
      if (def.children) {
        for (const c of def.children) {
          spawned.push({
            proj: { x: hit.x, y: hit.y - 6, vx: c.vx * pr.facing, vy: c.vy, age: 1 },
            weapon: c.weapon,
            owner: pr.owner,
            facing: pr.facing,
          });
        }
      }
      return false;
    });
    for (const s of spawned) {
      // 자식 탄이 땅 속에서 생성되면 위로 올려준다
      let y = s.proj.y;
      for (let k = 0; k < 40 && this.terrain.isSolid(s.proj.x, y); k++) y -= 1;
      s.proj.y = y;
      this.spawn(s.proj, s.weapon, s.owner, s.facing);
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
      const amount = computeDamage(def.damage, def.radius, x, y, p, p.id === directId);
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

  private kill(p: Player, cause: 'hp' | 'fall') {
    if (!p.alive) return;
    p.alive = false;
    p.deathCause = cause;
    if (cause === 'fall') p.hp = 0;
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
    if (!first) p.gauge = Math.min(MAX_GAUGE, p.gauge + 10);
    this.turnTicksLeft = TURN_TICKS;
    this.shotFiredThisTurn = false;
    this.input = { move: 0, aim: 0 };
    this.wind = this.rng.int(-WIND_MAX, WIND_MAX);
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
