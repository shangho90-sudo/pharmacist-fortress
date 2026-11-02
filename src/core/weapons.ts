export type WeaponId = 'basic' | 'mega_capsule' | 'dragon_capsule' | 'dragon_shard';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  radius: number;
  /** 착탄 시 생성되는 자식 탄 (속도 px/s, 발사 방향 기준 x 부호 반영) */
  children?: { weapon: WeaponId; vx: number; vy: number }[];
  /** 화면 흔들림 강도 (0이면 없음) */
  shake: number;
  /** 지형 파괴 반경 배율 */
  carveScale: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  basic: { id: 'basic', name: '캡슐 미사일', damage: 20, radius: 35, shake: 0, carveScale: 1 },
  // 팽약사: 한 방에 모든 것을 거는 초대형 캡슐
  mega_capsule: { id: 'mega_capsule', name: '초대형 캡슐 폭탄', damage: 42, radius: 68, shake: 10, carveScale: 1 },
  // 용약사: 착탄 후 보라색 용의 파편이 사방으로 흩어지는 에너지 캡슐
  dragon_capsule: {
    id: 'dragon_capsule',
    name: '용의 캡슐포',
    damage: 24,
    radius: 38,
    shake: 7,
    carveScale: 1,
    children: [
      { weapon: 'dragon_shard', vx: -170, vy: -250 },
      { weapon: 'dragon_shard', vx: -60, vy: -340 },
      { weapon: 'dragon_shard', vx: 60, vy: -340 },
      { weapon: 'dragon_shard', vx: 170, vy: -250 },
    ],
  },
  dragon_shard: { id: 'dragon_shard', name: '용의 파편', damage: 11, radius: 24, shake: 0, carveScale: 1 },
};
