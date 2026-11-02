export type WeaponId =
  | 'basic'
  | 'mega_capsule'
  | 'heal_cross'
  | 'golden_arrows'
  | 'sniper_capsule'
  | 'green_barrage'
  | 'green_shard'
  | 'tome_vortex'
  | 'dragon_capsule'
  | 'dragon_shard'
  | 'blue_spray'
  | 'axe_storm'
  | 'double_dose';

/** 탄 외형 */
export type ProjLook = 'capsule' | 'big_capsule' | 'orb' | 'arrow' | 'axe' | 'pill' | 'syringe' | 'cross';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  radius: number;
  /** 착탄 시 생성되는 자식 탄 (속도 px/s, 발사 방향 기준 x 부호 반영) */
  children?: { weapon: WeaponId; vx: number; vy: number }[];
  /** 동시 발사: 각도 오프셋(도), 파워 배율 */
  spread?: { angle: number; power: number }[];
  /** 바람 영향 배율 (기본 1) */
  windFactor?: number;
  /** 착탄 시 발사자 체력 회복 */
  selfHeal?: number;
  /** 화면 흔들림 강도 (0이면 없음) */
  shake: number;
  look: ProjLook;
  /** 탄/이펙트 색 (null이면 캐릭터 테마색) */
  color: string | null;
}

const W = (d: Omit<WeaponDef, 'shake'> & { shake?: number }): WeaponDef => ({ shake: 0, ...d });

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // 공통 기본탄
  basic: W({ id: 'basic', name: '캡슐 미사일', damage: 20, radius: 35, look: 'capsule', color: '#e5383b' }),
  // 팽약사
  mega_capsule: W({ id: 'mega_capsule', name: '초대형 캡슐 폭탄', damage: 42, radius: 68, shake: 10, look: 'big_capsule', color: null }),
  // 구약사
  heal_cross: W({ id: 'heal_cross', name: '치유의 십자탄', damage: 30, radius: 46, selfHeal: 25, shake: 5, look: 'cross', color: null }),
  // 방약사
  golden_arrows: W({
    id: 'golden_arrows', name: '황금 화살 3연발', damage: 17, radius: 28, shake: 3, look: 'arrow', color: null,
    spread: [{ angle: -3, power: 1 }, { angle: 0, power: 1 }, { angle: 3, power: 1 }],
  }),
  // 철약사
  sniper_capsule: W({ id: 'sniper_capsule', name: '무풍 저격 캡슐', damage: 46, radius: 26, windFactor: 0, shake: 6, look: 'pill', color: null }),
  // 석약사
  green_barrage: W({
    id: 'green_barrage', name: '그린 캡슐 난사', damage: 18, radius: 30, shake: 6, look: 'big_capsule', color: null,
    children: [
      { weapon: 'green_shard', vx: -200, vy: -220 },
      { weapon: 'green_shard', vx: -100, vy: -320 },
      { weapon: 'green_shard', vx: 0, vy: -380 },
      { weapon: 'green_shard', vx: 100, vy: -320 },
      { weapon: 'green_shard', vx: 200, vy: -220 },
    ],
  }),
  green_shard: W({ id: 'green_shard', name: '그린 캡슐', damage: 10, radius: 22, look: 'pill', color: null }),
  // 동약사
  tome_vortex: W({
    id: 'tome_vortex', name: '캡슐 소용돌이', damage: 15, radius: 28, shake: 3, look: 'capsule', color: null,
    spread: [{ angle: -6, power: 0.97 }, { angle: -2, power: 1 }, { angle: 2, power: 1 }, { angle: 6, power: 0.97 }],
  }),
  // 용약사
  dragon_capsule: W({
    id: 'dragon_capsule', name: '용의 캡슐포', damage: 24, radius: 38, shake: 7, look: 'big_capsule', color: null,
    children: [
      { weapon: 'dragon_shard', vx: -170, vy: -250 },
      { weapon: 'dragon_shard', vx: -60, vy: -340 },
      { weapon: 'dragon_shard', vx: 60, vy: -340 },
      { weapon: 'dragon_shard', vx: 170, vy: -250 },
    ],
  }),
  dragon_shard: W({ id: 'dragon_shard', name: '용의 파편', damage: 11, radius: 24, look: 'orb', color: null }),
  // 사공약사
  blue_spray: W({
    id: 'blue_spray', name: '블루 스프레이', damage: 12, radius: 22, shake: 3, look: 'pill', color: null,
    spread: [{ angle: -8, power: 0.96 }, { angle: -4, power: 0.99 }, { angle: 0, power: 1 }, { angle: 4, power: 0.99 }, { angle: 8, power: 0.96 }],
  }),
  // 조약사
  axe_storm: W({
    id: 'axe_storm', name: '도끼 폭풍', damage: 21, radius: 30, shake: 5, look: 'axe', color: null,
    spread: [{ angle: -5, power: 1 }, { angle: 0, power: 1 }, { angle: 5, power: 1 }],
  }),
  // 두약사
  double_dose: W({
    id: 'double_dose', name: '더블 도즈', damage: 26, radius: 40, shake: 6, look: 'syringe', color: null,
    spread: [{ angle: 0, power: 1 }, { angle: 0, power: 0.88 }],
  }),
};
