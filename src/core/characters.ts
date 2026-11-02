import type { WeaponId } from './weapons';

export type CharTypeId = 'paeng' | 'gu' | 'bang' | 'cheol' | 'seok' | 'dong' | 'yong' | 'sagong' | 'jo' | 'du';

/** 무기 외형 (렌더러가 그리는 손에 든 무기) */
export type GunStyle = 'bazooka' | 'staff' | 'bow' | 'sniper' | 'cannon' | 'book' | 'gatling' | 'axe' | 'syringe' | 'dragon';

export interface SkillInfo {
  weapon: WeaponId;
  name: string;
  desc: string;
}

export interface CharTypeDef {
  id: CharTypeId;
  name: string;
  roman: string;
  /** 대표 문구 */
  title: string;
  /** 포지션 */
  role: string;
  weaponName: string;
  description: string;
  quote: string;
  /** (구) 손에 드는 무기 외형 — 스프라이트에 무기가 포함되어 현재는 미사용 */
  gun: GunStyle;
  basic: SkillInfo;
  special: SkillInfo;
  ultimate: SkillInfo;
  /** 하위 호환 */
  specialName: string;
  specialDesc: string;
  palette: { accent: string; accentDark: string; accentLight: string; glow: string };
}

const C = (accent: string, accentDark: string, accentLight: string, glow: string) => ({ accent, accentDark, accentLight, glow });

type Def = Omit<CharTypeDef, 'specialName' | 'specialDesc'>;
const mk = (d: Def): CharTypeDef => ({ ...d, specialName: d.ultimate.name, specialDesc: d.ultimate.desc });

export const CHAR_TYPES: Record<CharTypeId, CharTypeDef> = {
  paeng: mk({
    id: 'paeng', name: '팽약사', roman: 'PAENG', title: '강력한 표적의 약사', role: '공격형', weaponName: '레드 알약', gun: 'bazooka',
    description: '거대한 한 알의 약으로 적을 제압하는 약사', quote: '한 알의 약이, 세상을 바꿀 수 있다.',
    basic: { weapon: 'paeng_basic', name: '레드 알약', desc: '강력한 알약 한 발로 큰 피해' },
    special: { weapon: 'paeng_special', name: '메가 레드', desc: '거대한 빨간 알약으로 넓은 범위 공격' },
    ultimate: { weapon: 'paeng_ult', name: '레드 익스플로전', desc: '레드 알약 7발을 연속 발사' },
    palette: C('#e3262f', '#8e1018', '#ff8a8f', '#ff3b3b'),
  }),
  gu: mk({
    id: 'gu', name: '구약사', roman: 'GU', title: '정확한 판단의 약사', role: '밸런스형', weaponName: '블루 썬더 스태프', gun: 'staff',
    description: '정확한 적응증으로 전장을 분석하는 약사', quote: '올바른 약은 정확한 판단에서 시작된다.',
    basic: { weapon: 'gu_basic', name: '블루 썬더 스태프', desc: '전기를 띤 에너지 구체 발사' },
    special: { weapon: 'gu_special', name: '썬더스톰', desc: '착탄 후 주변에 낙뢰 4번' },
    ultimate: { weapon: 'gu_ult', name: '블루 크로스 게이트', desc: '거대한 십자 에너지 대폭발' },
    palette: C('#2f7bff', '#123c96', '#9cc4ff', '#4c9dff'),
  }),
  bang: mk({
    id: 'bang', name: '방약사', roman: 'BANG', title: '신속하고 날카로운 약사', role: '원거리형', weaponName: '골든 보우', gun: 'bow',
    description: '신속한 공격으로 적을 관통하는 약사', quote: '정확한 목표는 더 건강한 내일을 만든다.',
    basic: { weapon: 'bang_basic', name: '골든 보우', desc: '빠르고 바람을 덜 타는 빛의 화살' },
    special: { weapon: 'bang_special', name: '천공의 화살', desc: '착탄 지점에 빛의 화살 5발이 쏟아짐' },
    ultimate: { weapon: 'bang_ult', name: '골든 레인', desc: '넓은 범위에 빛의 화살 10발 폭격' },
    palette: C('#e8b020', '#8a5a08', '#ffe58a', '#ffd23f'),
  }),
  cheol: mk({
    id: 'cheol', name: '철약사', roman: 'CHEOL', title: '치밀한 분석의 약사', role: '저격형', weaponName: '퍼플 알약 라이플', gun: 'sniper',
    description: '정확한 데이터 분석으로 약점을 저격하는 약사', quote: '데이터는 거짓말하지 않는다.',
    basic: { weapon: 'cheol_basic', name: '퍼플 알약', desc: '빠르고 바람 영향이 적은 저격탄' },
    special: { weapon: 'cheol_special', name: '바이러스 매트릭스', desc: '적을 추적하는 유도 알약 3발' },
    ultimate: { weapon: 'cheol_ult', name: '데이터 스캔', desc: '바람을 무시하고 적을 추적하는 고위력 저격' },
    palette: C('#8b3dff', '#3d1690', '#c9a2ff', '#a66bff'),
  }),
  seok: mk({
    id: 'seok', name: '석약사', roman: 'SEOK', title: '다중 투여의 약사', role: '지원형', weaponName: '멀티 알약 건', gun: 'cannon',
    description: '다량의 약물을 동시에 투여해 적을 압도하는 약사', quote: '함께하는 치료가, 더 많은 생명을 지킨다.',
    basic: { weapon: 'seok_basic', name: '트리플 알약', desc: '초록 알약 3발 동시 발사' },
    special: { weapon: 'seok_special', name: '멀티 디스펜서', desc: '알약 6발을 빠르게 연사' },
    ultimate: { weapon: 'seok_ult', name: '메가 힐링 버스트', desc: '모든 적에게 약물 폭격 + 자신 체력 25 회복' },
    palette: C('#2fbf4a', '#0f6a24', '#9df0a8', '#4dff6a'),
  }),
  dong: mk({
    id: 'dong', name: '동약사', roman: 'DONG', title: '숨겨진 힘을 깨우는 약사', role: '지원형', weaponName: '푸른 오브', gun: 'book',
    description: '약 안에 숨겨진 힘을 깨우는 약사', quote: '약 안에는 아직 발견되지 않은 가능성이 있다.',
    basic: { weapon: 'dong_basic', name: '블루 오브', desc: '하늘빛 에너지 구체 발사' },
    special: { weapon: 'dong_special', name: '천벌의 레이저', desc: '착탄 지점에 하늘에서 레이저가 내리꽂힘' },
    ultimate: { weapon: 'dong_ult', name: '하늘의 심판', desc: '푸른 알약 10발이 하늘에서 쏟아짐' },
    palette: C('#3aa0ff', '#11508e', '#a8d8ff', '#5ec8ff'),
  }),
  yong: mk({
    id: 'yong', name: '용약사', roman: 'YONG', title: '압도적인 범위의 약사', role: '광역형', weaponName: '퍼플 메가', gun: 'dragon',
    description: '거대한 보라색 약물로 세상을 정화하는 약사', quote: '약이 닿는 곳에, 새로운 세상이 시작된다.',
    basic: { weapon: 'yong_basic', name: '퍼플 메가', desc: '피해는 낮지만 폭발 범위가 넓은 알약' },
    special: { weapon: 'yong_special', name: '다크 익스플로전', desc: '거대한 보라색 대폭발' },
    ultimate: { weapon: 'yong_ult', name: '약물 드래곤', desc: '약물의 용이 지면을 휩쓸며 연속 폭발' },
    palette: C('#a855f7', '#4a1a9c', '#e0c2ff', '#b26bff'),
  }),
  sagong: mk({
    id: 'sagong', name: '사공약사', roman: 'SAGONG', title: '정확한 조제의 약사', role: '조제형', weaponName: '블루 멀티 런처', gun: 'gatling',
    description: '작은 파란 알약 다발을 쏟아내는 약사', quote: '올바른 약은, 올바른 조제에서 시작된다.',
    basic: { weapon: 'sagong_basic', name: '블루 멀티 런처', desc: '파란 알약 3발을 부채꼴로 발사' },
    special: { weapon: 'sagong_special', name: '분산 조제샷', desc: '알약 7발을 넓게 분산' },
    ultimate: { weapon: 'sagong_ult', name: '블루 스프레이', desc: '알약 10발 연속 난사' },
    palette: C('#1e66ff', '#0b2f80', '#8fb6ff', '#3f8cff'),
  }),
  jo: mk({
    id: 'jo', name: '조약사', roman: 'JO', title: '강인한 전장의 약사', role: '전사형', weaponName: '투척 도끼', gun: 'axe',
    description: '강인한 체력과 정확한 투척으로 적을 격파하는 약사', quote: '하나의 도끼가, 수많은 생명을 지킨다.',
    basic: { weapon: 'jo_basic', name: '투척 도끼', desc: '중력을 덜 받아 곧게 날아가는 도끼' },
    special: { weapon: 'jo_special', name: '연속 투척', desc: '도끼 3자루를 연속 투척' },
    ultimate: { weapon: 'jo_ult', name: '도끼 폭풍', desc: '거대한 도끼가 6갈래로 분열' },
    palette: C('#d4142a', '#6e0612', '#ff7a88', '#ff2a40'),
  }),
  du: mk({
    id: 'du', name: '두약사', roman: 'DU', title: '그림자 속의 약사', role: '암살형', weaponName: '주사기 단검', gun: 'syringe',
    description: '그늘 속에서 적을 제거하는 암살자형 약사', quote: '보이지 않는 곳에서, 가장 확실한 치료가 시작된다.',
    basic: { weapon: 'du_basic', name: '독 주사', desc: '빠르고 정확한 독 주사기 투척' },
    special: { weapon: 'du_special', name: '섀도우 스텝', desc: '착탄 지점으로 순간이동 + 다음 공격 피해 1.5배' },
    ultimate: { weapon: 'du_ult', name: '베놈 블리츠', desc: '독 주사기 6발 연속 투척' },
    palette: C('#a855f7', '#4a1a7a', '#e0c2ff', '#b26bff'),
  }),
};

export const CHAR_LIST: CharTypeId[] = ['paeng', 'gu', 'bang', 'cheol', 'seok', 'dong', 'yong', 'sagong', 'jo', 'du'];
