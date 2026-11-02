import { describe, expect, it } from 'vitest';
import { DT, GRAVITY, MAX_LAUNCH_SPEED, MOVE_PER_TURN, WORLD_H, WORLD_W } from '../src/core/constants';
import { Game, computeDamage, type PlayerSetup } from '../src/core/game';
import { generateMap } from '../src/core/mapgen';
import { cosDeg, hasGround, launch, sinDeg, stepGravity, stepProjectile, stepWalk, type Mover } from '../src/core/physics';
import { Terrain } from '../src/core/terrain';
import { planShot } from '../src/core/ai';

const empty = () => new Terrain(WORLD_W, WORLD_H);

function fillRect(t: Terrain, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) t.mask[y * t.w + x] = 1;
}

function simulate(t: Terrain, wind: number, angle: number, power: number, facing: 1 | -1 = 1, footY = 900) {
  const p = launch({ footX: 300, footY, facing, angle, power });
  const path: [number, number][] = [];
  for (let i = 0; i < 120 * 30; i++) {
    const h = stepProjectile(p, wind, t, [], WORLD_W, WORLD_H);
    path.push([p.x, p.y]);
    if (h) return { hit: h, path, ticks: i + 1 };
  }
  return { hit: null, path, ticks: -1 };
}

const setup = (): PlayerSetup[] => [
  { name: 'A', charType: 'paeng', team: 0, controller: 'ai', aiLevel: 'hard' },
  { name: 'B', charType: 'jo', team: 1, controller: 'ai', aiLevel: 'normal' },
];

describe('포탄 물리', () => {
  it('바람이 없을 때 해석해(포물선)와 일치한다', () => {
    const t = empty();
    const p = launch({ footX: 300, footY: 900, facing: 1, angle: 50, power: 70 });
    const x0 = p.x, y0 = p.y, vx = p.vx, vy = p.vy;
    for (let i = 1; i <= 240; i++) {
      stepProjectile(p, 0, t, [], WORLD_W, WORLD_H);
      const time = i * DT;
      expect(p.x).toBeCloseTo(x0 + vx * time, 6);
      expect(p.y).toBeCloseTo(y0 + vy * time + 0.5 * GRAVITY * time * time, 6);
    }
    expect(vx).toBeCloseTo(cosDeg(50) * 0.7 * MAX_LAUNCH_SPEED, 6);
    expect(vy).toBeCloseTo(-sinDeg(50) * 0.7 * MAX_LAUNCH_SPEED, 6);
  });

  it('같은 입력이면 탄도 결과가 비트 단위로 동일하다', () => {
    const t = generateMap(42, 2).terrain;
    for (const [a, pw, w] of [[30, 80, 5], [60, 55, -7], [85, 100, 10], [10, 40, 0]]) {
      const r1 = simulate(t, w, a, pw);
      const r2 = simulate(t, w, a, pw);
      expect(r1.path).toEqual(r2.path);
      expect(r1.hit).toEqual(r2.hit);
    }
  });

  it('바람 방향에 따라 탄착점이 이동한다', () => {
    const t = empty();
    fillRect(t, 0, 1000, WORLD_W, 100);
    const calm = simulate(t, 0, 45, 60).hit!;
    const tail = simulate(t, 8, 45, 60).hit!;
    const head = simulate(t, -8, 45, 60).hit!;
    expect(tail.x).toBeGreaterThan(calm.x + 20);
    expect(head.x).toBeLessThan(calm.x - 20);
  });

  it('최대 속도에서도 1px 두께 벽을 통과하지 않는다 (연속 충돌 검사)', () => {
    for (let wx = 400; wx < 460; wx += 1) {
      const t = empty();
      fillRect(t, wx, 0, 1, WORLD_H);
      const r = simulate(t, 0, 0, 100);
      expect(r.hit?.kind).toBe('terrain');
      expect(Math.floor(r.hit!.x)).toBe(wx);
    }
  });

  it('충돌 지점은 경로상 처음 만나는 땅 픽셀이다', () => {
    const t = generateMap(7, 2).terrain;
    const r = simulate(t, 3, 40, 75, 1, t.surfaceBelow(300, 0));
    expect(r.path.length).toBeGreaterThan(10);
    expect(r.hit?.kind).toBe('terrain');
    const h = r.hit!;
    expect(t.isSolid(h.x, h.y)).toBe(true);
    // 직전 틱 위치에서 착탄점까지는 모두 빈 공간이어야 한다
    const prev = r.path[r.path.length - 2];
    const ray = t.raycast(prev[0], prev[1], h.x, h.y);
    expect(ray).not.toBeNull();
    expect(Math.hypot(ray!.x - h.x, ray!.y - h.y)).toBeLessThan(0.51);
  });

  it('캐릭터 직격을 감지한다', () => {
    const t = empty();
    const p = launch({ footX: 300, footY: 900, facing: 1, angle: 0, power: 100 });
    let hit = null;
    for (let i = 0; i < 400 && !hit; i++) hit = stepProjectile(p, 0, t, [{ id: 3, x: 700, y: p.y, r: 12 }], WORLD_W, WORLD_H);
    expect(hit?.kind).toBe('char');
    expect((hit as any).id).toBe(3);
    expect(hit!.x).toBeGreaterThan(687);
    expect(hit!.x).toBeLessThan(689);
  });

  it('맵 밖으로 나가면 out 처리된다', () => {
    const r = simulate(empty(), 0, 30, 100);
    expect(r.hit?.kind).toBe('out');
  });
});

describe('지형 파괴', () => {
  it('맵 전체 격자 위치에서 지형이 제거된다(가장자리/모서리 포함)', () => {
    const t = new Terrain(WORLD_W, WORLD_H);
    t.mask.fill(1);
    const pts: [number, number][] = [];
    for (let x = 0; x <= WORLD_W; x += 160) for (let y = 0; y <= WORLD_H; y += 110) pts.push([x, y]);
    pts.push([0, 0], [WORLD_W - 1, WORLD_H - 1], [-10, 500], [WORLD_W + 10, 500], [500, WORLD_H + 20]);
    let seed = 1;
    for (const [x, y] of pts) {
      t.carve(x, y, 35, seed++);
      // 반경의 88% 이내는 반드시 비어 있어야 한다
      for (let a = 0; a < 360; a += 15) {
        for (const rr of [0, 10, 20, 30]) {
          const px = x + Math.cos((a * Math.PI) / 180) * rr;
          const py = y + Math.sin((a * Math.PI) / 180) * rr;
          if (px >= 0 && py >= 0 && px < WORLD_W && py < WORLD_H) expect(t.isSolid(px, py)).toBe(false);
        }
      }
    }
  });

  it('반경 밖의 지형은 건드리지 않고, 변경 영역이 정확히 반환된다', () => {
    const t = new Terrain(400, 400);
    t.mask.fill(1);
    const rect = t.carve(200, 200, 35, 9)!;
    expect(rect.x).toBeGreaterThanOrEqual(200 - 35 * 1.1 - 1);
    expect(rect.x + rect.w).toBeLessThanOrEqual(200 + 35 * 1.1 + 2);
    let removed = 0;
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 400; x++) {
        const solid = t.mask[y * 400 + x] === 1;
        const inRect = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
        if (!solid) {
          removed++;
          expect(inRect).toBe(true);
        }
        if (Math.hypot(x + 0.5 - 200, y + 0.5 - 200) > 35 * 1.1 + 0.5) expect(solid).toBe(true);
      }
    // 면적이 원 넓이에 근접
    expect(removed).toBeGreaterThan(Math.PI * 35 * 35 * 0.8);
    expect(removed).toBeLessThan(Math.PI * 35 * 35 * 1.25);
  });

  it('연속 폭발 후 충돌 데이터가 즉시 반영되어 포탄이 구멍을 통과한다', () => {
    const t = empty();
    fillRect(t, 600, 0, 60, WORLD_H);
    // 수평 사격 경로 높이에 터널 뚫기
    const y = launch({ footX: 300, footY: 900, facing: 1, angle: 0, power: 100 }).y;
    for (let x = 590; x <= 670; x += 20) t.carve(x, y, 35, x);
    const r = simulate(t, 0, 0, 100);
    expect(r.hit?.kind).toBe('out');
  });

  it('같은 시드면 같은 모양(결정론)', () => {
    const a = new Terrain(300, 300); a.mask.fill(1);
    const b = new Terrain(300, 300); b.mask.fill(1);
    a.carve(150.3, 140.7, 35, 1234);
    b.carve(150.3, 140.7, 35, 1234);
    expect(a.checksum()).toBe(b.checksum());
    expect(Array.from(a.mask)).toEqual(Array.from(b.mask));
  });
});

describe('캐릭터 낙하/이동', () => {
  it('발밑 지형이 파괴되면 떨어져서 새 지면에 정확히 선다 (공중 부양 없음)', () => {
    const t = empty();
    fillRect(t, 0, 800, WORLD_W, 300);
    const m: Mover = { x: 1000, y: 800, vy: 0, grounded: true };
    expect(hasGround(t, m.x, m.y)).toBe(true);
    t.carve(1000, 800, 35, 5);
    for (let i = 0; i < 600; i++) stepGravity(m, t);
    expect(m.grounded).toBe(true);
    expect(hasGround(t, m.x, m.y)).toBe(true);
    expect(hasGround(t, m.x, m.y - 1)).toBe(false); // 땅에 박혀있지도 않음
    expect(m.y).toBeGreaterThan(800);
  });

  it('맵 여러 위치에서 폭발 후 모든 캐릭터가 지면 위에 안착한다', () => {
    const map = generateMap(99, 2);
    const t = map.terrain;
    for (let x = 40; x < WORLD_W - 40; x += 97) {
      const y = t.surfaceBelow(x, 0);
      const m: Mover = { x, y, vy: 0, grounded: true };
      t.carve(x + 5, y + 3, 35, x);
      for (let i = 0; i < 1200 && !(m.grounded && hasGround(t, m.x, m.y)); i++) stepGravity(m, t);
      if (m.y <= WORLD_H) {
        expect(m.grounded).toBe(true);
        expect(hasGround(t, m.x, m.y)).toBe(true);
      }
    }
  });

  it('바닥까지 뚫리면 맵 아래로 추락한다', () => {
    const t = empty();
    fillRect(t, 0, 1060, WORLD_W, 40);
    const m: Mover = { x: 500, y: 1060, vy: 0, grounded: true };
    t.carve(500, 1080, 35, 1);
    for (let i = 0; i < 600; i++) stepGravity(m, t);
    expect(m.y).toBeGreaterThan(WORLD_H);
  });

  it('완만한 경사는 오르고, 높은 벽은 막힌다', () => {
    const t = empty();
    fillRect(t, 0, 800, WORLD_W, 300);
    fillRect(t, 520, 795, 40, 5); // 5px 단차
    fillRect(t, 700, 700, 20, 100); // 100px 벽
    const m: Mover = { x: 500, y: 800, vy: 0, grounded: true };
    for (let i = 0; i < 120 * 6; i++) {
      stepWalk(m, t, 1, 48, WORLD_W);
      stepGravity(m, t);
    }
    expect(m.x).toBeLessThan(700 - 4 + 1);
    expect(m.x).toBeGreaterThan(680);
    expect(hasGround(t, m.x, m.y)).toBe(true);
  });
});

describe('피해량', () => {
  it('직격 최대, 거리에 따라 감소, 반경 밖 0', () => {
    const m: Mover = { x: 0, y: 0, vy: 0, grounded: true };
    expect(computeDamage(20, 35, 0, -15, m, true)).toBe(20);
    expect(computeDamage(20, 35, 0, -15, m, false)).toBe(20);
    const near = computeDamage(20, 35, 20, -15, m, false);
    const far = computeDamage(20, 35, 40, -15, m, false);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(computeDamage(20, 35, 100, -15, m, false)).toBe(0);
  });
});

describe('턴/게임 흐름', () => {
  it('턴 전환 중에는 발사/이동 입력이 무시된다', () => {
    const g = new Game({ seed: 1, players: setup() });
    expect(g.phase).toBe('turnStart');
    expect(g.fire('basic', 50)).toBe(false);
    const p = g.currentPlayer;
    const x = p.x;
    g.setInput({ move: 1 });
    g.step();
    expect(p.x).toBe(x);
    while (g.phase !== 'aiming') g.step();
    expect(g.fire('ultimate', 50)).toBe(false); // 게이지 부족
    expect(g.fire('basic', 50)).toBe(true);
    expect(g.fire('basic', 50)).toBe(false); // 중복 발사 불가
  });

  it('이동 거리는 턴당 제한된다', () => {
    const g = new Game({ seed: 3, players: setup() });
    while (g.phase !== 'aiming') g.step();
    const p = g.currentPlayer;
    const x0 = p.x;
    g.setInput({ move: p.x < WORLD_W / 2 ? 1 : -1 });
    for (let i = 0; i < 120 * 10; i++) g.step();
    expect(Math.abs(p.x - x0)).toBeLessThanOrEqual(MOVE_PER_TURN + 1);
  });

  it('시간 초과 시 다음 플레이어로 넘어간다', () => {
    const g = new Game({ seed: 5, players: setup() });
    const first = g.current;
    for (let i = 0; i < 120 * 40 && g.current === first; i++) g.step();
    expect(g.current).not.toBe(first);
    expect(g.phase === 'turnStart' || g.phase === 'aiming').toBe(true);
  });

  it('AI 대 AI 전체 게임이 오류 없이 종료되고, 같은 시드면 결과가 동일하다', () => {
    const run = (seed: number) => {
      const g = new Game({ seed, players: setup() });
      let guard = 0;
      while (g.phase !== 'over' && guard++ < 120 * 60 * 30) {
        if (g.phase === 'aiming') {
          const plan = planShot(g, g.tick);
          g.currentPlayer.facing = plan.facing;
          g.currentPlayer.angle = plan.angle;
          g.fire(plan.weapon, plan.power);
        }
        g.step();
        g.events.length = 0;
        // 불변식: 살아있는 지상 캐릭터는 항상 땅 위
        for (const p of g.players) if (p.alive && p.grounded) expect(hasGround(g.terrain, p.x, p.y)).toBe(true);
      }
      expect(g.phase).toBe('over');
      return g.stateHash() + '|' + g.winnerTeam;
    };
    const a = run(2024);
    expect(run(2024)).toBe(a);
  }, 60000);

  it('렌더 프레임 간격과 무관하게 같은 결과(고정 타임스텝 누적기)', () => {
    const play = (frameDts: number[]) => {
      const g = new Game({ seed: 77, players: setup() });
      let acc = 0, fi = 0, fired = false;
      while (g.tick < 120 * 8) {
        acc += frameDts[fi++ % frameDts.length];
        while (acc >= DT && g.tick < 120 * 8) {
          acc -= DT;
          if (g.phase === 'aiming' && !fired) { g.currentPlayer.angle = 55; fired = g.fire('basic', 72); }
          g.step();
        }
      }
      return g.stateHash();
    };
    expect(play([1 / 60])).toBe(play([1 / 144, 1 / 30, 1 / 90, 0.05]));
  });
});

describe('캐릭터별 기본탄·특수탄·필살기', () => {
  const ready = (charType: any, seed = 11) => {
    const g = new Game({ seed, players: [
      { name: 'A', charType, team: 0, controller: 'human' },
      { name: 'B', charType: 'paeng', team: 1, controller: 'human' },
    ] });
    while (!(g.phase === 'aiming' && g.current === 0)) { if (g.phase === 'aiming') g.skipTurn(); g.step(); g.events.length = 0; }
    g.currentPlayer.gauge = 100;
    return g;
  };
  const flyAll = (g: Game) => {
    const evs: any[] = [];
    let guard = 0;
    while (g.phase === 'flying' && guard++ < 120 * 40) {
      g.step();
      evs.push(...g.events.splice(0));
    }
    return evs;
  };

  it('10명 × 3종(30개) 공격이 모두 오류 없이 발사·종료된다', async () => {
    const { CHAR_LIST } = await import('../src/core/characters');
    for (const id of CHAR_LIST) {
      for (const kind of ['basic', 'special', 'ultimate'] as const) {
        const g = ready(id);
        g.setAngle(50);
        expect(g.fire(kind, 62), `${id} ${kind}`).toBe(true);
        const evs = flyAll(g);
        expect(g.phase, `${id} ${kind}`).not.toBe('flying');
        expect(evs.some((e) => ['explode', 'projectileOut', 'splash', 'teleport'].includes(e.type)), `${id} ${kind}`).toBe(true);
      }
    }
  }, 60000);

  it('특수탄은 사용 후 3턴 동안 재사용할 수 없고, 필살기는 게이지를 소모한다', () => {
    const g = ready('paeng');
    expect(g.fire('special', 50)).toBe(true);
    expect(g.players[0].specialCd).toBe(3);
    const g2 = ready('paeng');
    g2.currentPlayer.gauge = 50;
    expect(g2.fire('ultimate', 50)).toBe(false);
    g2.currentPlayer.gauge = 100;
    expect(g2.fire('ultimate', 50)).toBe(true);
    expect(g2.players[0].gauge).toBe(0);
  });

  it('부채꼴·연사 발사 수가 시트와 일치한다', () => {
    const g = ready('sagong');
    g.fire('special', 70);
    expect(g.projectiles.length).toBe(7);
    const g2 = ready('seok');
    g2.fire('basic', 70);
    expect(g2.projectiles.length).toBe(3);
    const g3 = ready('jo');
    g3.fire('special', 70);
    let spawned = g3.events.splice(0).filter((e) => e.type === 'spawnProjectile').length;
    for (let i = 0; i < 40; i++) {
      g3.step();
      spawned += g3.events.splice(0).filter((e) => e.type === 'spawnProjectile').length;
    }
    expect(spawned).toBe(3); // 연속 투척 3자루
  });

  it('데이터 스캔은 바람의 영향을 받지 않는다', () => {
    const shoot = (wind: number) => {
      const g = ready('cheol');
      g.wind = wind;
      g.setAngle(30);
      g.fire('ultimate', 60);
      const ex = flyAll(g).find((e) => e.type === 'explode');
      return ex ? Math.round(ex.x) : null;
    };
    expect(shoot(10)).toBe(shoot(-10));
  });

  it('메가 힐링 버스트는 발사자를 회복하고 모든 적에게 내리꽂는다', () => {
    const g = ready('seok');
    g.players[0].hp = 50;
    g.setAngle(60);
    g.fire('ultimate', 55);
    const evs = flyAll(g);
    expect(evs.some((e) => e.type === 'heal')).toBe(true);
    expect(evs.some((e) => e.type === 'strike' && e.style === 'sky')).toBe(true);
    expect(g.players[0].hp).toBeGreaterThan(50);
  });

  it('섀도우 스텝은 착탄 지점으로 순간이동하고 다음 공격 피해가 1.5배', () => {
    const g = ready('du');
    const x0 = g.players[0].x;
    g.setAngle(45);
    g.fire('special', 45);
    const evs = flyAll(g);
    const tp = evs.find((e) => e.type === 'teleport');
    expect(tp).toBeTruthy();
    expect(Math.abs(g.players[0].x - x0)).toBeGreaterThan(30);
    expect(g.players[0].buff).toBe(1.5);
  });

  it('이동탄: 피해 없이 착탄 지점으로 이동하고 3턴 대기', () => {
    const g = ready('paeng');
    const x0 = g.players[0].x;
    const hp1 = g.players[1].hp;
    g.setFacing(1);
    g.setAngle(50);
    expect(g.fire('move', 45)).toBe(true);
    const evs = flyAll(g);
    const tp = evs.find((e) => e.type === 'teleport');
    expect(tp).toBeTruthy();
    expect(Math.abs(g.players[0].x - tp.toX)).toBeLessThan(1);
    expect(Math.abs(g.players[0].x - x0)).toBeGreaterThan(50);
    expect(g.players[1].hp).toBe(hp1);
    expect(g.players[0].moveShotCd).toBe(3);
    expect(evs.some((e) => e.type === 'explode')).toBe(false);
  });

  it('유도탄은 적 방향으로 휘어진다', () => {
    const g = ready('cheol');
    const enemy = g.players[1];
    g.setFacing(enemy.x > g.players[0].x ? 1 : -1);
    g.setAngle(35);
    g.fire('special', 60);
    const evs = flyAll(g);
    const ex = evs.filter((e) => e.type === 'explode');
    const closest = Math.min(...ex.map((e: any) => Math.abs(e.x - enemy.x)));
    const g2 = ready('cheol');
    g2.setFacing(enemy.x > g2.players[0].x ? 1 : -1);
    g2.setAngle(35);
    g2.fire('basic', 60);
    const ex2 = flyAll(g2).filter((e) => e.type === 'explode');
    const closest2 = Math.min(...ex2.map((e: any) => Math.abs(e.x - enemy.x)));
    expect(closest).toBeLessThan(closest2);
  });
});

describe('맵 6종', () => {
  it('모든 맵이 결정론적으로 생성되고, 시작 위치가 액체 위의 땅이며 서로 떨어져 있다', async () => {
    const { MAP_LIST, MAP_INFO } = await import('../src/core/mapgen');
    for (const id of MAP_LIST) {
      for (const n of [2, 4]) {
        const a = generateMap(123, n, id);
        const b = generateMap(123, n, id);
        expect(a.terrain.checksum()).toBe(b.terrain.checksum());
        expect(a.spawnXs).toEqual(b.spawnXs);
        const ly = MAP_INFO[id].liquidY ?? WORLD_H;
        for (const x of a.spawnXs) {
          const s = a.terrain.surfaceBelow(x, 0);
          expect(s, `${id} spawn ${x}`).toBeGreaterThan(100);
          expect(s, `${id} spawn ${x}`).toBeLessThan(ly - 30);
        }
        for (let i = 1; i < a.spawnXs.length; i++) expect(a.spawnXs[i] - a.spawnXs[i - 1]).toBeGreaterThan(150);
      }
    }
  });

  it('모든 맵에서 AI 대전이 끝까지 진행되고 캐릭터가 땅에 박히거나 떠 있지 않다', async () => {
    const { MAP_LIST } = await import('../src/core/mapgen');
    for (const id of MAP_LIST) {
      const g = new Game({ seed: 99, mapId: id, players: setup().map((p) => ({ ...p, aiLevel: 'hard' as const })) });
      let guard = 0;
      while (g.phase !== 'over' && guard++ < 120 * 60 * 30) {
        if (g.phase === 'aiming') {
          if (g.currentPlayer.gauge >= 100) g.currentPlayer.gauge = 99; // 속도를 위해 기본탄만
          const plan = planShot(g, g.tick);
          g.currentPlayer.facing = plan.facing;
          g.currentPlayer.angle = plan.angle;
          g.fire('basic', plan.power);
        }
        g.step();
        g.events.length = 0;
        for (const p of g.players) if (p.alive && p.grounded) expect(hasGround(g.terrain, p.x, p.y)).toBe(true);
      }
      expect(g.phase, id).toBe('over');
    }
  }, 120000);

  it('달 기지는 바람이 항상 0이고 중력이 낮다', () => {
    const g = new Game({ seed: 5, mapId: 'moon_base', players: setup() });
    for (let i = 0; i < 20; i++) {
      expect(g.wind).toBe(0);
      g.skipTurn();
      for (let k = 0; k < 400 && g.phase !== 'aiming'; k++) g.step();
    }
    expect(g.gravity).toBeLessThan(GRAVITY);
  });

  it('바다에 빠지면 탈락하고, 포탄은 수면에서 사라진다', () => {
    const g = new Game({ seed: 8, mapId: 'pirate_cove', players: setup() });
    const p = g.players[0];
    p.x = Math.round(WORLD_W * 0.47); // 암초 사이 바다 위
    p.y = 400;
    p.grounded = false;
    for (let i = 0; i < 600 && p.alive; i++) g.step();
    expect(p.alive).toBe(false);
    expect(p.deathCause).toBe('liquid');
    expect(g.events.some((e) => e.type === 'death')).toBe(true);
  });
});
