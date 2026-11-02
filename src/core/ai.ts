import { BODY_CENTER_Y, WORLD_H, WORLD_W } from './constants';
import { CHAR_TYPES } from './characters';
import { computeDamage, type AiLevel, type Game, type Player } from './game';
import { bodyCircle, launch, stepProjectile, type StepHit } from './physics';
import { Rng } from './rng';
import type { Terrain } from './terrain';
import { WEAPONS } from './weapons';

export interface AiPlan {
  facing: 1 | -1;
  angle: number;
  power: number;
  weapon: 'basic' | 'special' | 'ultimate';
  /** 예측 점수(디버그용) */
  score: number;
}

const NOISE: Record<AiLevel, { angle: number; power: number; step: number }> = {
  easy: { angle: 4, power: 4.5, step: 5 },
  normal: { angle: 2, power: 2.5, step: 3 },
  hard: { angle: 1.5, power: 2.2, step: 3 },
};

/** 실제 게임과 동일한 물리로 탄착점 예측 */
export function predictImpact(
  g: Game,
  shooter: Player,
  facing: 1 | -1,
  angle: number,
  power: number,
  terrain: Terrain = g.terrain,
  windFactor = 1,
  gravityScale = 1,
  speedScale = 1,
): StepHit | null {
  const pr = launch({ footX: shooter.x, footY: shooter.y, facing, angle, power });
  pr.vx *= speedScale;
  pr.vy *= speedScale;
  const bodies = g.players.filter((p) => p.alive).map((p) => bodyCircle(p, p.id));
  for (let i = 0; i < 120 * 12; i++) {
    const hit = stepProjectile(pr, g.wind * windFactor, terrain, bodies, WORLD_W, WORLD_H, g.gravity * gravityScale);
    if (!hit && g.map.liquidY !== null && pr.y >= g.map.liquidY && pr.vy > 0) return { kind: 'out', x: pr.x, y: pr.y };
    if (hit) return hit;
  }
  return null;
}

/**
 * 탄도 탐색 기반 AI. 각도/파워 격자를 실제 시뮬레이션으로 평가하고,
 * 난이도에 따라 탐색 정밀도와 조준 오차를 조절한다.
 */
export function planShot(g: Game, rngSeed: number): AiPlan {
  const me = g.currentPlayer;
  const level = me.aiLevel;
  const cfg = NOISE[level];
  const rng = new Rng(rngSeed);
  const enemies = g.players.filter((p) => p.alive && p.team !== me.team);
  const allies = g.players.filter((p) => p.alive && p.team === me.team);
  const def = CHAR_TYPES[me.charType];
  // 무기 선택: 필살기(게이지 100) > 특수탄(사용 가능, 순간이동 제외) > 기본탄
  let kind: AiPlan['weapon'] = 'basic';
  if (me.gauge >= 100 && level !== 'easy') kind = 'ultimate';
  else if (me.specialCd === 0 && level !== 'easy' && WEAPONS[def.special.weapon].damage > 0) kind = 'special';
  const weapon = WEAPONS[kind === 'ultimate' ? def.ultimate.weapon : kind === 'special' ? def.special.weapon : def.basic.weapon];
  // 피해 평가용: 하위 효과까지 고려한 대략적인 기대 피해 (반경이 작은 다발탄은 주탄 기준)
  const evalDmg = Math.max(weapon.damage, 8) * (weapon.spread ? Math.min(2, weapon.spread.length * 0.6) : weapon.burst ? Math.min(3, weapon.burst.count * 0.5) : 1);
  const evalRadius = Math.max(weapon.radius, 20);

  // 가장 가까운 적 방향
  let target = enemies[0];
  for (const e of enemies) if (Math.abs(e.x - me.x) < Math.abs(target.x - me.x)) target = e;
  const facing: 1 | -1 = target.x >= me.x ? 1 : -1;

  let best: AiPlan = { facing, angle: 45, power: 60, weapon: kind, score: -Infinity };
  const evaluate = (angle: number, power: number) => {
    if (angle < 0 || angle > 90 || power < 5 || power > 100) return;
    const hit = predictImpact(g, me, facing, angle, power, g.terrain, weapon.windFactor ?? 1, weapon.gravityScale ?? 1, weapon.speedScale ?? 1);
    if (!hit || hit.kind === 'out') return;
    let score = 0;
    for (const e of enemies) score += computeDamage(evalDmg, evalRadius, hit.x, hit.y, e, hit.kind === 'char' && hit.id === e.id);
    for (const a of allies) score -= 1.5 * computeDamage(evalDmg, evalRadius, hit.x, hit.y, a, hit.kind === 'char' && hit.id === a.id);
    // 피해가 없으면 목표와의 거리로 점수(가까울수록 좋음)
    if (score === 0) {
      const dx = hit.x - target.x,
        dy = hit.y - (target.y - BODY_CENTER_Y);
      score = -Math.sqrt(dx * dx + dy * dy) / 100;
    }
    if (score > best.score) best = { facing, angle, power, weapon: best.weapon, score };
  };
  // 1차: 거친 격자 탐색
  for (let angle = 15; angle <= 85; angle += cfg.step) for (let power = 20; power <= 100; power += cfg.step) evaluate(angle, power);
  // 2차(어려움): 최적점 주변 정밀 탐색
  if (level === 'hard') {
    const a0 = best.angle,
      p0 = best.power;
    for (let da = -2; da <= 2; da++) for (let dp = -2.5; dp <= 2.5; dp += 0.5) evaluate(a0 + da, p0 + dp);
  }
  const angle = Math.max(0, Math.min(90, Math.round(best.angle + (rng.next() * 2 - 1) * cfg.angle)));
  const power = Math.max(5, Math.min(100, best.power + (rng.next() * 2 - 1) * cfg.power));
  return { ...best, angle, power };
}
