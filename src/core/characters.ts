import type { WeaponId } from './weapons';

export type CharTypeId = 'paeng' | 'yong';

export interface CharTypeDef {
  id: CharTypeId;
  name: string;
  roman: string;
  title: string;
  description: string;
  special: WeaponId;
  specialName: string;
  /** 렌더러 색상 팔레트: accent=무기/테마색, eye=눈동자 */
  palette: { accent: string; accentDark: string; accentLight: string; eye: string; glow: string };
}

export const CHAR_TYPES: Record<CharTypeId, CharTypeDef> = {
  paeng: {
    id: 'paeng',
    name: '팽약사',
    roman: 'PAENG',
    title: '강력한 표적의 약사',
    description: '붉은 캡슐 바주카를 짊어진 정면 승부형 약사',
    special: 'mega_capsule',
    specialName: '초대형 캡슐 폭탄',
    palette: { accent: '#e3262f', accentDark: '#8e1018', accentLight: '#ff7a7f', eye: '#c4142a', glow: '#ff3b3b' },
  },
  yong: {
    id: 'yong',
    name: '용약사',
    roman: 'YONG',
    title: '약이 닿는 곳에 새 세상을',
    description: '보라빛 에너지 캡슐포를 다루는 약사',
    special: 'dragon_capsule',
    specialName: '용의 캡슐포',
    palette: { accent: '#8b3dff', accentDark: '#4a1a9c', accentLight: '#c9a2ff', eye: '#8f3cff', glow: '#b26bff' },
  },
};

export const CHAR_LIST: CharTypeId[] = ['paeng', 'yong'];
