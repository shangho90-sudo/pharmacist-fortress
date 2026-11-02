// 캐릭터별 기본탄 / 특수탄 / 필살기 정의 (캐릭터 설정 시트 기준).
// 모든 효과는 틱 단위로 스케줄되는 결정론적 규칙이라 서버/클라이언트에서 같은 결과가 나온다.

export type WeaponId = string;

/** 탄 외형 */
export type ProjLook = 'capsule' | 'big_capsule' | 'pill' | 'orb' | 'orb_cross' | 'arrow' | 'axe' | 'big_axe' | 'syringe' | 'cross' | 'dark_orb';

/** 착탄 시 추가 효과 */
export type ImpactFx =
  | { kind: 'children'; list: { weapon: WeaponId; vx: number; vy: number }[] }
  /** 착탄 지점 위 하늘에서 탄이 쏟아짐 */
  | { kind: 'rain'; weapon: WeaponId; offsets: number[]; height: number; vy: number; delayStep: number }
  /** 지표면에 즉시 내리꽂는 공격 (번개/레이저) */
  | { kind: 'strikes'; weapon: WeaponId; offsets: number[]; delayStep: number; style: 'lightning' | 'beam' }
  /** 바라보는 방향으로 지표를 휩쓰는 연속 폭발 (드래곤) */
  | { kind: 'sweep'; weapon: WeaponId; step: number; count: number; delayStep: number }
  /** 모든 적 위치에 내리꽂음 */
  | { kind: 'global'; weapon: WeaponId; delayStep: number }
  /** 발사자를 착탄 지점으로 순간이동 */
  | { kind: 'teleport' }
  /** 다음 공격 피해 배율 */
  | { kind: 'buff'; mult: number };

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  radius: number;
  look: ProjLook;
  /** 탄/이펙트 색 (null이면 캐릭터 테마색) */
  color: string | null;
  shake: number;
  /** 동시 발사: 각도 오프셋(도), 파워 배율 */
  spread?: { angle: number; power: number }[];
  /** 연사: 일정 간격(틱)으로 차례로 발사 */
  burst?: { count: number; interval: number; angles: number[]; powers: number[] };
  windFactor?: number;
  gravityScale?: number;
  speedScale?: number;
  /** 가장 가까운 적을 향한 유도 가속도 (px/s²) */
  homing?: number;
  /** 착탄 시 발사자 체력 회복 */
  selfHeal?: number;
  onImpact?: ImpactFx[];
  /** 꼬리 이펙트 종류 */
  trail?: 'normal' | 'electric' | 'shadow' | 'light' | 'heal' | 'dragon';
  /** 탄 크기 배율(렌더링) */
  scale?: number;
}

const W = (d: Omit<WeaponDef, 'shake' | 'color'> & { shake?: number; color?: string | null }): WeaponDef => ({ shake: 0, color: null, ...d });

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let x = a; x <= b + 1e-9; x += step) out.push(Math.round(x));
  return out;
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {};
const add = (...ws: WeaponDef[]) => ws.forEach((w) => (WEAPONS[w.id] = w));

// ─────────── 팽약사: 레드 알약 ───────────
add(
  W({ id: 'paeng_basic', name: '레드 알약', damage: 22, radius: 34, look: 'capsule', color: '#e3262f' }),
  W({ id: 'paeng_special', name: '메가 레드', damage: 32, radius: 60, look: 'big_capsule', color: '#e3262f', shake: 8, scale: 1.3 }),
  W({
    id: 'paeng_ult', name: '레드 익스플로전', damage: 10, radius: 26, look: 'capsule', color: '#ff3b3b', shake: 3,
    burst: { count: 7, interval: 9, angles: [0, -2, 2, -1, 1, -3, 3], powers: [1, 0.97, 1.03, 0.99, 1.01, 0.95, 1.05] },
  }),
);
// ─────────── 석약사: 멀티 알약 건 ───────────
add(
  W({ id: 'seok_basic', name: '트리플 알약', damage: 8, radius: 22, look: 'pill', color: '#3ad65a', spread: [{ angle: -2, power: 1 }, { angle: 0, power: 1 }, { angle: 2, power: 1 }] }),
  W({
    id: 'seok_special', name: '멀티 디스펜서', damage: 7, radius: 20, look: 'pill', color: '#7dff8a', shake: 2,
    burst: { count: 6, interval: 6, angles: [0, -1.5, 1.5, -3, 3, 0], powers: [1, 0.98, 1.02, 0.97, 1.03, 1] },
  }),
  W({ id: 'seok_heal_strike', name: '힐링 버스트', damage: 14, radius: 28, look: 'orb', color: '#5cff7a', shake: 3 }),
  W({
    id: 'seok_ult', name: '메가 힐링 버스트', damage: 20, radius: 40, look: 'orb_cross', color: '#3ad65a', shake: 8, selfHeal: 25, trail: 'heal', scale: 1.6,
    onImpact: [{ kind: 'global', weapon: 'seok_heal_strike', delayStep: 18 }],
  }),
);
// ─────────── 두약사: 주사기 단검 ───────────
add(
  W({ id: 'du_basic', name: '독 주사', damage: 22, radius: 22, look: 'syringe', color: '#a855f7', speedScale: 1.12, windFactor: 0.5, trail: 'shadow' }),
  W({ id: 'du_special', name: '섀도우 스텝', damage: 0, radius: 0, look: 'dark_orb', color: '#7c3aed', trail: 'shadow', onImpact: [{ kind: 'teleport' }, { kind: 'buff', mult: 1.5 }] }),
  W({
    id: 'du_ult', name: '베놈 블리츠', damage: 10, radius: 20, look: 'syringe', color: '#c084fc', speedScale: 1.15, windFactor: 0.5, trail: 'shadow', shake: 2,
    burst: { count: 6, interval: 7, angles: [0, -1, 1, -2, 2, 0], powers: [1, 1.02, 0.98, 1.03, 0.97, 1] },
  }),
);
// ─────────── 조약사: 투척 도끼 ───────────
add(
  W({ id: 'jo_basic', name: '투척 도끼', damage: 22, radius: 30, look: 'axe', color: '#d4142a', gravityScale: 0.65 }),
  W({
    id: 'jo_special', name: '연속 투척', damage: 11, radius: 26, look: 'axe', color: '#ff3b4e', gravityScale: 0.65, shake: 2,
    burst: { count: 3, interval: 12, angles: [0, 1.5, -1.5], powers: [1, 0.97, 1.03] },
  }),
  W({ id: 'jo_axe_shard', name: '분열 도끼', damage: 10, radius: 24, look: 'axe', color: '#ff3b4e' }),
  W({
    id: 'jo_ult', name: '도끼 폭풍', damage: 22, radius: 38, look: 'big_axe', color: '#d4142a', gravityScale: 0.65, shake: 8, scale: 1.6,
    onImpact: [
      {
        kind: 'children',
        list: [
          { weapon: 'jo_axe_shard', vx: -260, vy: -200 },
          { weapon: 'jo_axe_shard', vx: -150, vy: -330 },
          { weapon: 'jo_axe_shard', vx: -40, vy: -400 },
          { weapon: 'jo_axe_shard', vx: 40, vy: -400 },
          { weapon: 'jo_axe_shard', vx: 150, vy: -330 },
          { weapon: 'jo_axe_shard', vx: 260, vy: -200 },
        ],
      },
    ],
  }),
);
// ─────────── 사공약사: 블루 멀티 런처 ───────────
add(
  W({ id: 'sagong_basic', name: '블루 멀티 런처', damage: 8, radius: 20, look: 'pill', color: '#2f7bff', spread: [{ angle: -4, power: 0.99 }, { angle: 0, power: 1 }, { angle: 4, power: 0.99 }] }),
  W({ id: 'sagong_special', name: '분산 조제샷', damage: 6, radius: 18, look: 'pill', color: '#5aa8ff', shake: 2, spread: range(-12, 12, 4).map((a) => ({ angle: a, power: 1 - Math.abs(a) * 0.002 })) }),
  W({
    id: 'sagong_ult', name: '블루 스프레이', damage: 6, radius: 18, look: 'pill', color: '#3f8cff', shake: 3,
    burst: { count: 10, interval: 4, angles: [0, -3, 3, -6, 6, -1, 1, -4, 4, 0], powers: [1, 0.99, 1.01, 0.98, 1.02, 1, 0.99, 1.01, 0.98, 1] },
  }),
);
// ─────────── 용약사: 퍼플 메가 ───────────
add(
  W({ id: 'yong_basic', name: '퍼플 메가', damage: 18, radius: 46, look: 'big_capsule', color: '#8b3dff', scale: 1.15 }),
  W({ id: 'yong_special', name: '다크 익스플로전', damage: 30, radius: 72, look: 'dark_orb', color: '#6d28d9', shake: 10, scale: 1.4 }),
  W({ id: 'yong_breath', name: '드래곤 브레스', damage: 9, radius: 26, look: 'orb', color: '#b26bff', shake: 2 }),
  W({
    id: 'yong_ult', name: '약물 드래곤', damage: 14, radius: 30, look: 'dark_orb', color: '#a855f7', shake: 6, trail: 'dragon', scale: 1.5,
    onImpact: [{ kind: 'sweep', weapon: 'yong_breath', step: 42, count: 8, delayStep: 8 }],
  }),
);
// ─────────── 구약사: 블루 썬더 스태프 ───────────
add(
  W({ id: 'gu_basic', name: '블루 썬더 스태프', damage: 20, radius: 32, look: 'orb_cross', color: '#2f7bff', trail: 'electric' }),
  W({ id: 'gu_bolt', name: '낙뢰', damage: 10, radius: 24, look: 'orb', color: '#8cc4ff', shake: 2 }),
  W({
    id: 'gu_special', name: '썬더스톰', damage: 12, radius: 26, look: 'orb_cross', color: '#4c9dff', trail: 'electric', shake: 3,
    onImpact: [{ kind: 'strikes', weapon: 'gu_bolt', offsets: [-70, 70, -140, 140], delayStep: 10, style: 'lightning' }],
  }),
  W({ id: 'gu_ult', name: '블루 크로스 게이트', damage: 38, radius: 78, look: 'cross', color: '#2f7bff', trail: 'electric', shake: 12, scale: 1.8 }),
);
// ─────────── 방약사: 골든 보우 ───────────
add(
  W({ id: 'bang_basic', name: '골든 보우', damage: 20, radius: 28, look: 'arrow', color: '#ffc21f', speedScale: 1.1, windFactor: 0.6, trail: 'light' }),
  W({ id: 'bang_rain_arrow', name: '빛의 화살', damage: 8, radius: 22, look: 'arrow', color: '#ffe066', trail: 'light' }),
  W({
    id: 'bang_special', name: '천공의 화살', damage: 8, radius: 20, look: 'arrow', color: '#ffd23f', speedScale: 1.1, windFactor: 0.6, trail: 'light',
    onImpact: [{ kind: 'rain', weapon: 'bang_rain_arrow', offsets: [-60, -30, 0, 30, 60], height: 420, vy: 520, delayStep: 6 }],
  }),
  W({
    id: 'bang_ult', name: '골든 레인', damage: 8, radius: 22, look: 'arrow', color: '#ffd23f', speedScale: 1.1, windFactor: 0.6, trail: 'light', shake: 4,
    onImpact: [{ kind: 'rain', weapon: 'bang_rain_arrow', offsets: range(-180, 180, 40), height: 460, vy: 560, delayStep: 5 }],
  }),
);
// ─────────── 철약사: 퍼플 알약 라이플 ───────────
add(
  W({ id: 'cheol_basic', name: '퍼플 알약', damage: 20, radius: 24, look: 'pill', color: '#8b3dff', speedScale: 1.15, windFactor: 0.3, scale: 1.3 }),
  W({ id: 'cheol_special', name: '바이러스 매트릭스', damage: 9, radius: 20, look: 'pill', color: '#c084fc', homing: 340, spread: [{ angle: -6, power: 1 }, { angle: 0, power: 1 }, { angle: 6, power: 1 }] }),
  W({ id: 'cheol_ult', name: '데이터 스캔', damage: 44, radius: 28, look: 'pill', color: '#d8b4fe', homing: 520, windFactor: 0, shake: 7, scale: 1.8, trail: 'electric' }),
);
// ─────────── 동약사: 푸른 오브 ───────────
add(
  W({ id: 'dong_basic', name: '블루 오브', damage: 20, radius: 32, look: 'orb', color: '#3aa0ff', scale: 1.4 }),
  W({ id: 'dong_laser', name: '천벌의 레이저', damage: 24, radius: 30, look: 'orb', color: '#8fd8ff', shake: 6 }),
  W({
    id: 'dong_special', name: '천벌의 레이저', damage: 8, radius: 20, look: 'orb', color: '#5ec8ff', scale: 1.2,
    onImpact: [{ kind: 'strikes', weapon: 'dong_laser', offsets: [0], delayStep: 22, style: 'beam' }],
  }),
  W({ id: 'dong_fall', name: '푸른 알약', damage: 8, radius: 22, look: 'orb', color: '#5ec8ff' }),
  W({
    id: 'dong_ult', name: '하늘의 심판', damage: 8, radius: 22, look: 'orb', color: '#3aa0ff', scale: 1.5, trail: 'light', shake: 4,
    onImpact: [{ kind: 'rain', weapon: 'dong_fall', offsets: range(-200, 200, 44), height: 480, vy: 540, delayStep: 4 }],
  }),
);
