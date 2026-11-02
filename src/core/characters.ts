import type { WeaponId } from './weapons';

export type CharTypeId = 'paeng' | 'gu' | 'bang' | 'cheol' | 'seok' | 'dong' | 'yong' | 'sagong' | 'jo' | 'du';

/** 무기 외형 (렌더러가 그리는 손에 든 무기) */
export type GunStyle = 'bazooka' | 'staff' | 'bow' | 'sniper' | 'cannon' | 'book' | 'gatling' | 'axe' | 'syringe' | 'dragon';

export interface CharTypeDef {
  id: CharTypeId;
  name: string;
  roman: string;
  title: string;
  description: string;
  gun: GunStyle;
  special: WeaponId;
  specialName: string;
  specialDesc: string;
  /** 테마색: accent=무기/이펙트 주색 */
  palette: { accent: string; accentDark: string; accentLight: string; glow: string };
}

const C = (accent: string, accentDark: string, accentLight: string, glow: string) => ({ accent, accentDark, accentLight, glow });

export const CHAR_TYPES: Record<CharTypeId, CharTypeDef> = {
  paeng: {
    id: 'paeng', name: '팽약사', roman: 'PAENG', title: '강력한 표적의 약사', description: '레드 캡슐 바주카로 정면 승부',
    gun: 'bazooka', special: 'mega_capsule', specialName: '초대형 캡슐 폭탄', specialDesc: '거대한 폭발로 넓은 지형을 날려버린다',
    palette: C('#e3262f', '#8e1018', '#ff8a8f', '#ff3b3b'),
  },
  gu: {
    id: 'gu', name: '구약사', roman: 'GU', title: '치유의 지팡이', description: '푸른 십자 지팡이의 회복형 약사',
    gun: 'staff', special: 'heal_cross', specialName: '치유의 십자탄', specialDesc: '폭발 피해 + 자신의 체력 25 회복',
    palette: C('#2f7bff', '#123c96', '#9cc4ff', '#4c9dff'),
  },
  bang: {
    id: 'bang', name: '방약사', roman: 'BANG', title: '황금 활의 명사수', description: '황금 활로 캡슐 화살을 쏜다',
    gun: 'bow', special: 'golden_arrows', specialName: '황금 화살 3연발', specialDesc: '살짝 벌어진 화살 3발을 동시에 발사',
    palette: C('#e8b020', '#8a5a08', '#ffe58a', '#ffd23f'),
  },
  cheol: {
    id: 'cheol', name: '철약사', roman: 'CHEOL', title: '보랏빛 저격수', description: '저격 소총으로 한 점을 꿰뚫는다',
    gun: 'sniper', special: 'sniper_capsule', specialName: '무풍 저격 캡슐', specialDesc: '바람의 영향을 받지 않는 고위력 저격탄',
    palette: C('#8b3dff', '#3d1690', '#c9a2ff', '#a66bff'),
  },
  seok: {
    id: 'seok', name: '석약사', roman: 'SEOK', title: '그린 캡슐 캐논', description: '초록 캡슐 대포로 물량 공세',
    gun: 'cannon', special: 'green_barrage', specialName: '그린 캡슐 난사', specialDesc: '착탄 후 초록 캡슐 5개가 흩어진다',
    palette: C('#2fbf4a', '#0f6a24', '#9df0a8', '#4dff6a'),
  },
  dong: {
    id: 'dong', name: '동약사', roman: 'DONG', title: '마법서의 약사', description: '마법서에서 캡슐을 소환한다',
    gun: 'book', special: 'tome_vortex', specialName: '캡슐 소용돌이', specialDesc: '넓게 퍼지는 캡슐 4발을 소환',
    palette: C('#3aa0ff', '#11508e', '#a8d8ff', '#5ec8ff'),
  },
  yong: {
    id: 'yong', name: '용약사', roman: 'YONG', title: '약이 닿는 곳에 새 세상을', description: '보랏빛 에너지 캡슐포',
    gun: 'dragon', special: 'dragon_capsule', specialName: '용의 캡슐포', specialDesc: '착탄 후 용의 파편 4개가 흩어진다',
    palette: C('#a855f7', '#4a1a9c', '#e0c2ff', '#b26bff'),
  },
  sagong: {
    id: 'sagong', name: '사공약사', roman: 'SAGONG', title: '정확한 조제의 약사', description: '파란 알약 개틀링',
    gun: 'gatling', special: 'blue_spray', specialName: '블루 스프레이', specialDesc: '작은 파란 알약 5발을 부채꼴로 난사',
    palette: C('#1e66ff', '#0b2f80', '#8fb6ff', '#3f8cff'),
  },
  jo: {
    id: 'jo', name: '조약사', roman: 'JO', title: '하나의 도끼가 생명을 지킨다', description: '붉은 십자 도끼 투척',
    gun: 'axe', special: 'axe_storm', specialName: '도끼 폭풍', specialDesc: '회전하는 도끼 3자루를 동시에 투척',
    palette: C('#d4142a', '#6e0612', '#ff7a88', '#ff2a40'),
  },
  du: {
    id: 'du', name: '두약사', roman: 'DU', title: '두 배의 처방', description: '대형 주사기 런처',
    gun: 'syringe', special: 'double_dose', specialName: '더블 도즈', specialDesc: '앞뒤로 이어지는 주사 캡슐 2연발',
    palette: C('#ff8a1a', '#8e4006', '#ffc58a', '#ffa03f'),
  },
};

export const CHAR_LIST: CharTypeId[] = ['paeng', 'gu', 'bang', 'cheol', 'seok', 'dong', 'yong', 'sagong', 'jo', 'du'];
