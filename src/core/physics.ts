import {
  BODY_CENTER_Y,
  BODY_RADIUS,
  DT,
  FALL_TERMINAL,
  FOOT_HALF,
  GRAVITY,
  MAX_LAUNCH_SPEED,
  MAX_STEP_DOWN,
  MAX_STEP_UP,
  MUZZLE_HEIGHT,
  MUZZLE_LENGTH,
  OUT_MARGIN_X,
  WIND_ACCEL,
} from './constants';
import type { Terrain } from './terrain';

// ── 각도 테이블: 정수 각도만 사용하고 1e-9로 반올림 → 엔진 간 삼각함수 오차 제거 ──
const COS: number[] = [];
const SIN: number[] = [];
for (let d = -180; d <= 180; d++) {
  const r = (d * Math.PI) / 180;
  COS[d + 180] = Math.round(Math.cos(r) * 1e9) / 1e9;
  SIN[d + 180] = Math.round(Math.sin(r) * 1e9) / 1e9;
}
export function cosDeg(d: number) {
  return COS[Math.round(d) + 180];
}
export function sinDeg(d: number) {
  return SIN[Math.round(d) + 180];
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number; // 틱
}

export interface Circle {
  id: number;
  x: number;
  y: number;
  r: number;
}

export type StepHit =
  | { kind: 'terrain'; x: number; y: number }
  | { kind: 'char'; x: number; y: number; id: number }
  | { kind: 'out'; x: number; y: number };

export interface LaunchParams {
  footX: number;
  footY: number;
  facing: 1 | -1;
  angle: number; // 0..90 (정수로 반올림)
  power: number; // 0..100
}

export function launch(p: LaunchParams): Projectile {
  const a = Math.round(p.angle);
  const dirX = p.facing * cosDeg(a);
  const dirY = -sinDeg(a);
  const ox = p.footX;
  const oy = p.footY - MUZZLE_HEIGHT;
  const speed = (Math.max(0, Math.min(100, p.power)) / 100) * MAX_LAUNCH_SPEED;
  return { x: ox + dirX * MUZZLE_LENGTH, y: oy + dirY * MUZZLE_LENGTH, vx: dirX * speed, vy: dirY * speed, age: 0 };
}

/**
 * 포탄 1틱 진행. 등가속도 운동의 정확한 적분식 사용(포물선과 해석해 일치).
 * 이동 경로 선분 전체를 0.5px 간격으로 검사해 지형/캐릭터 관통을 방지(연속 충돌 검사).
 * 원점이 이미 땅 속이면 즉시 그 자리에서 착탄한다.
 */
export function stepProjectile(p: Projectile, wind: number, terrain: Terrain, bodies: Circle[], worldW: number, worldH: number, gravity = GRAVITY): StepHit | null {
  if (p.age === 0) {
    if (terrain.isSolid(p.x, p.y)) return { kind: 'terrain', x: p.x, y: p.y };
    for (const b of bodies) {
      const dx = p.x - b.x,
        dy = p.y - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) return { kind: 'char', x: p.x, y: p.y, id: b.id };
    }
  }
  const ax = wind * WIND_ACCEL;
  const ay = gravity;
  const nx = p.x + p.vx * DT + 0.5 * ax * DT * DT;
  const ny = p.y + p.vy * DT + 0.5 * ay * DT * DT;
  const x0 = p.x,
    y0 = p.y;
  const dx = nx - x0,
    dy = ny - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const n = Math.max(1, Math.ceil(len / 0.5));
  let hit: StepHit | null = null;
  for (let i = 1; i <= n && !hit; i++) {
    const t = i / n;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    for (const b of bodies) {
      const ex = x - b.x,
        ey = y - b.y;
      if (ex * ex + ey * ey <= b.r * b.r) {
        hit = { kind: 'char', x, y, id: b.id };
        break;
      }
    }
    if (!hit && terrain.isSolid(x, y)) hit = { kind: 'terrain', x, y };
  }
  p.age++;
  if (hit) {
    p.x = hit.x;
    p.y = hit.y;
    return hit;
  }
  p.x = nx;
  p.y = ny;
  p.vx += ax * DT;
  p.vy += ay * DT;
  if (p.x < -OUT_MARGIN_X || p.x > worldW + OUT_MARGIN_X || p.y > worldH + 60) return { kind: 'out', x: p.x, y: p.y };
  return null;
}

// ─────────────────────────── 캐릭터 이동/낙하 ───────────────────────────

export interface Mover {
  x: number;
  y: number; // 발 위치 (발이 딛는 픽셀 행의 바로 위 경계)
  vy: number;
  grounded: boolean;
}

/** 발 아래 한 줄(행 y)에 땅이 있는가 */
export function hasGround(t: Terrain, x: number, y: number): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  for (let k = -FOOT_HALF; k <= FOOT_HALF; k++) if (t.solidAt(ix + k, iy)) return true;
  return false;
}

/** 발 위치가 땅에 박혀 있는가 (발 바로 위 행 검사) */
function footBlocked(t: Terrain, x: number, y: number): boolean {
  return hasGround(t, x, y - 1);
}

export function bodyCircle(m: Mover, id: number): Circle {
  return { id, x: m.x, y: m.y - BODY_CENTER_Y, r: BODY_RADIUS };
}

/**
 * 중력/착지 처리. 1px 단위로 내려가며 땅을 만나면 정확히 그 위에 선다.
 * 반환: 이번 틱에 착지했는지
 */
export function stepGravity(m: Mover, t: Terrain, gravity = GRAVITY): boolean {
  if (m.grounded) {
    if (hasGround(t, m.x, m.y)) return false;
    // 발밑 지형이 사라짐 → 낙하 시작
    m.grounded = false;
    m.vy = 0;
  }
  m.vy = Math.min(FALL_TERMINAL, m.vy + gravity * DT);
  const target = m.y + m.vy * DT;
  // 지나가는 모든 정수 행을 검사 → 빠른 낙하에도 바닥을 뚫지 않음
  for (let r = Math.ceil(m.y); r <= Math.floor(target); r++) {
    if (hasGround(t, m.x, r)) {
      m.y = r;
      m.vy = 0;
      m.grounded = true;
      return true;
    }
  }
  m.y = target;
  return false;
}

/**
 * 좌우 이동 1틱. 단차 MAX_STEP_UP 이하면 올라가고, 내려가는 경사는 MAX_STEP_DOWN까지 붙어서 걷는다.
 * 반환: 실제 이동 거리(px)
 */
export function stepWalk(m: Mover, t: Terrain, dir: -1 | 1, speed: number, worldW: number): number {
  if (!m.grounded) return 0;
  const nx = Math.max(10, Math.min(worldW - 10, m.x + dir * speed * DT));
  if (nx === m.x) return 0;
  let y = m.y;
  // 박혀 있으면 위로 올림
  let climbed = 0;
  while (footBlocked(t, nx, y) && climbed <= MAX_STEP_UP) {
    y -= 1;
    climbed++;
  }
  if (climbed > MAX_STEP_UP) return 0; // 벽
  // 내려가는 경사: 지면에 붙이기
  if (!hasGround(t, nx, y)) {
    let found = false;
    for (let d = 1; d <= MAX_STEP_DOWN; d++) {
      if (hasGround(t, nx, y + d)) {
        y += d;
        found = true;
        break;
      }
    }
    if (!found) {
      // 낭떠러지 → 현재 높이에서 낙하 시작
      m.grounded = false;
      m.vy = 0;
    }
  }
  const moved = Math.abs(nx - m.x);
  m.x = nx;
  m.y = y;
  return moved;
}
