// 무기·탄·이펙트용 절차적 픽셀아트 생성기. 캐릭터는 public/chars/*.png (레퍼런스 일러스트에서 추출).

import type { CharTypeDef, GunStyle } from '../core/characters';
import type { ProjLook } from '../core/weapons';

/** 캐릭터 PNG: 높이 120px 텍스처를 0.5배로 표시 → 월드 60px (줌 2에서 화면 1:1 픽셀) */
export const CHAR_SCALE = 0.5;
export const GUN_W = 48;
export const GUN_H = 20;
export const GUN_PIVOT_X = 12;
export const GUN_PIVOT_Y = 10;

type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, clip?: (x: number, y: number) => boolean) {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (!clip || clip(x, y))) ctx.fillRect(x, y, 1, 1);
    }
  }
}

const SKIN = '#ffd6b8';
const SKIN_SH = '#e8a888';
const COAT = '#f5f7fc';
const COAT_SH = '#cfd6e4';
const COAT_OL = '#525b72';
const DARK = '#1c1826';
const METAL = '#5a6a8a';
const METAL_L = '#aab8d0';

/** 무기 + 앞팔. (GUN_PIVOT_X, GUN_PIVOT_Y) = 어깨 회전축, 오른쪽이 포구 */
export function drawGun(ctx: Ctx, style: GunStyle, pal: CharTypeDef['palette']) {
  const { accent: A, accentDark: D, accentLight: L, glow: G } = pal;
  ctx.clearRect(0, 0, GUN_W, GUN_H);
  const cy = GUN_PIVOT_Y;
  switch (style) {
    case 'bazooka':
      px(ctx, 1, cy - 4, 9, 8, '#2a2630');
      px(ctx, 9, cy - 5, 2, 10, D);
      px(ctx, 11, cy - 5, 24, 10, '#3a2a30');
      px(ctx, 11, cy - 4, 24, 8, '#f4f4f8');
      px(ctx, 11, cy + 1, 24, 3, '#d0d0dc');
      for (const bx of [15, 23, 31]) {
        px(ctx, bx, cy - 4, 3, 8, A);
        px(ctx, bx, cy + 1, 3, 3, D);
      }
      px(ctx, 11, cy - 3, 24, 1, '#fff');
      px(ctx, 35, cy - 7, 11, 14, D);
      px(ctx, 36, cy - 6, 10, 12, A);
      px(ctx, 36, cy - 6, 10, 2, L);
      px(ctx, 44, cy - 4, 2, 8, '#3a0a10');
      break;
    case 'cannon':
    case 'dragon':
      px(ctx, 2, cy - 6, 10, 12, DARK);
      px(ctx, 3, cy - 5, 8, 10, style === 'dragon' ? '#33204f' : '#1d3a24');
      px(ctx, 12, cy - 7, 22, 14, DARK);
      px(ctx, 13, cy - 6, 20, 12, D);
      px(ctx, 15, cy - 3, 16, 6, '#0f0820');
      px(ctx, 16, cy - 2, 14, 4, A);
      px(ctx, 16, cy - 2, 14, 1, L);
      if (style === 'cannon') {
        px(ctx, 20, cy - 6, 5, 2, '#fff');
        px(ctx, 21, cy - 7, 3, 4, '#fff');
      }
      px(ctx, 34, cy - 8, 4, 16, DARK);
      px(ctx, 35, cy - 7, 2, 14, G);
      px(ctx, 38, cy - 5, 8, 10, D);
      px(ctx, 39, cy - 4, 7, 8, A);
      px(ctx, 44, cy - 2, 2, 4, L);
      break;
    case 'staff':
      px(ctx, 4, cy - 1, 32, 3, DARK);
      px(ctx, 5, cy - 1, 30, 1, METAL_L);
      px(ctx, 30, cy - 3, 3, 7, METAL);
      ellipse(ctx, 40, cy, 7.5, 7.5, D);
      ellipse(ctx, 40, cy, 6.3, 6.3, A);
      ellipse(ctx, 38.5, cy - 2, 2.5, 2.5, L);
      px(ctx, 39, cy - 4, 3, 9, '#fff');
      px(ctx, 36, cy - 1, 9, 3, '#fff');
      break;
    case 'bow':
      // 화살
      px(ctx, 6, cy, 34, 1, '#7a5a2a');
      px(ctx, 40, cy - 2, 4, 5, A);
      px(ctx, 44, cy - 1, 3, 3, L);
      px(ctx, 6, cy - 2, 4, 5, '#fff');
      // 활대 (세로 곡선)
      for (let y = 0; y < GUN_H; y++) {
        const t = (y - cy) / cy;
        const x = 30 + Math.round((1 - t * t) * 5);
        px(ctx, x, y, 2, 1, y % 5 === 0 ? L : A);
        px(ctx, x - 1, y, 1, 1, D);
      }
      px(ctx, 30, 0, 1, GUN_H, 'rgba(255,255,255,0.7)');
      break;
    case 'sniper':
      px(ctx, 2, cy - 2, 12, 6, DARK);
      px(ctx, 6, cy + 3, 4, 5, DARK);
      px(ctx, 12, cy - 3, 18, 6, '#2a1840');
      px(ctx, 13, cy - 2, 16, 3, D);
      px(ctx, 30, cy - 1, 16, 3, '#2a1840');
      px(ctx, 30, cy - 1, 16, 1, A);
      px(ctx, 44, cy - 2, 3, 5, DARK);
      // 스코프
      px(ctx, 16, cy - 8, 12, 4, DARK);
      px(ctx, 17, cy - 7, 10, 2, A);
      px(ctx, 26, cy - 8, 3, 4, G);
      px(ctx, 20, cy - 4, 2, 2, DARK);
      break;
    case 'book':
      // 펼친 마법서 (손 앞에 떠 있음)
      px(ctx, 24, cy - 8, 20, 16, '#2a3550');
      px(ctx, 25, cy - 7, 8, 14, '#e8eef8');
      px(ctx, 35, cy - 7, 8, 14, '#e8eef8');
      px(ctx, 33, cy - 8, 2, 16, D);
      for (let y = cy - 5; y < cy + 6; y += 3) {
        px(ctx, 26, y, 6, 1, L);
        px(ctx, 36, y, 6, 1, L);
      }
      px(ctx, 27, cy - 2, 3, 3, A);
      px(ctx, 37, cy - 2, 3, 3, A);
      ellipse(ctx, 46, cy, 2, 2, G);
      break;
    case 'gatling':
      px(ctx, 2, cy - 5, 12, 10, DARK);
      px(ctx, 12, cy - 6, 10, 12, '#e8eef8');
      px(ctx, 12, cy - 6, 10, 2, '#fff');
      px(ctx, 14, cy - 3, 6, 6, A);
      px(ctx, 15, cy - 2, 4, 1, '#fff');
      px(ctx, 16, cy - 3, 2, 6, '#fff');
      for (const by of [-5, -1, 3]) {
        px(ctx, 22, cy + by, 22, 3, METAL);
        px(ctx, 22, cy + by, 22, 1, METAL_L);
      }
      px(ctx, 30, cy - 6, 3, 12, D);
      px(ctx, 42, cy - 6, 4, 12, A);
      px(ctx, 44, cy - 5, 2, 10, G);
      break;
    case 'axe':
      px(ctx, 4, cy - 1, 30, 3, '#3a2a28');
      px(ctx, 4, cy - 1, 30, 1, '#6a4a40');
      // 도끼날
      for (let y = -9; y <= 9; y++) {
        const w = 8 - Math.round(Math.abs(y) * 0.45);
        px(ctx, 32, cy + y, w + 4, 1, y === -9 || y === 9 ? '#5a5a6a' : '#c8ccd8');
        px(ctx, 32 + w + 3, cy + y, 1, 1, '#ffffff');
      }
      px(ctx, 35, cy - 3, 3, 7, A);
      px(ctx, 33, cy - 1, 7, 3, A);
      px(ctx, 30, cy - 3, 3, 7, D);
      break;
    case 'syringe':
      px(ctx, 2, cy - 6, 3, 12, METAL);
      px(ctx, 4, cy - 1, 4, 3, METAL_L);
      px(ctx, 8, cy - 6, 2, 12, METAL);
      px(ctx, 10, cy - 5, 24, 10, '#2b3a55');
      px(ctx, 11, cy - 4, 22, 8, '#d6f1ff');
      px(ctx, 11, cy - 1, 16, 4, A);
      px(ctx, 11, cy - 1, 16, 1, L);
      for (let x = 14; x < 33; x += 4) px(ctx, x, cy - 4, 1, 2, '#7b8bab');
      px(ctx, 11, cy - 4, 22, 1, '#fff');
      px(ctx, 34, cy - 2, 4, 4, METAL);
      px(ctx, 38, cy - 1, 9, 2, METAL_L);
      break;
  }
  // 앞팔 (흰 가운 소매 + 손)
  px(ctx, 7, cy - 1, 12, 6, COAT_OL);
  px(ctx, 8, cy, 10, 4, COAT);
  px(ctx, 8, cy + 3, 10, 1, COAT_SH);
  px(ctx, 17, cy + 1, 5, 5, SKIN);
  px(ctx, 17, cy + 5, 5, 1, SKIN_SH);
}

// ───────────────────────── 색 유틸 ─────────────────────────
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
/** amt>0 밝게, amt<0 어둡게 */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
}

// ───────────────────────── 탄/파티클 텍스처 ─────────────────────────
export function drawProjectile(look: ProjLook, color: string): HTMLCanvasElement {
  const light = shade(color, 0.55);
  const dark = shade(color, -0.45);
  switch (look) {
    case 'big_capsule': {
      const c = makeCanvas(24, 12);
      capsule(c.getContext('2d')!, 0, 0, 24, 12, color, '#fbfbff');
      return c;
    }
    case 'pill': {
      const c = makeCanvas(10, 6);
      capsule(c.getContext('2d')!, 0, 0, 10, 6, color, light);
      return c;
    }
    case 'orb': {
      const c = makeCanvas(8, 8);
      const ctx = c.getContext('2d')!;
      ellipse(ctx, 4, 4, 3.6, 3.6, dark);
      ellipse(ctx, 4, 4, 2.6, 2.6, color);
      ellipse(ctx, 3.5, 3.5, 1.2, 1.2, '#ffffff');
      return c;
    }
    case 'arrow': {
      const c = makeCanvas(18, 6);
      const ctx = c.getContext('2d')!;
      px(ctx, 0, 1, 4, 4, '#ffffff');
      px(ctx, 2, 2, 12, 2, '#7a5a2a');
      px(ctx, 12, 1, 4, 4, color);
      px(ctx, 16, 2, 2, 2, light);
      return c;
    }
    case 'axe': {
      const c = makeCanvas(16, 16);
      const ctx = c.getContext('2d')!;
      px(ctx, 7, 1, 2, 14, '#3a2a28');
      for (let y = -5; y <= 5; y++) {
        const w = 6 - Math.round(Math.abs(y) * 0.5);
        px(ctx, 9, 8 + y - 2, w, 1, '#c8ccd8');
        px(ctx, 7 - w, 8 + y - 2, w, 1, '#c8ccd8');
      }
      px(ctx, 10, 4, 2, 4, color);
      px(ctx, 4, 4, 2, 4, color);
      return c;
    }
    case 'syringe': {
      const c = makeCanvas(18, 8);
      const ctx = c.getContext('2d')!;
      px(ctx, 0, 1, 2, 6, '#5a6a8a');
      px(ctx, 2, 1, 11, 6, '#2b3a55');
      px(ctx, 3, 2, 9, 4, color);
      px(ctx, 3, 2, 9, 1, light);
      px(ctx, 13, 3, 5, 2, '#d0d8e8');
      return c;
    }
    case 'cross': {
      const c = makeCanvas(14, 14);
      const ctx = c.getContext('2d')!;
      ellipse(ctx, 7, 7, 6.8, 6.8, dark);
      ellipse(ctx, 7, 7, 5.6, 5.6, color);
      px(ctx, 6, 3, 2, 8, '#fff');
      px(ctx, 3, 6, 8, 2, '#fff');
      return c;
    }
    default: {
      const c = makeCanvas(14, 8);
      capsule(c.getContext('2d')!, 0, 0, 14, 8, color, '#fbfbff');
      return c;
    }
  }
}

function capsule(ctx: Ctx, x: number, y: number, w: number, h: number, back: string, front: string) {
  const r = h / 2;
  ellipse(ctx, x + r, y + r, r, r, '#1d1430');
  ellipse(ctx, x + w - r, y + r, r, r, '#1d1430');
  px(ctx, x + r, y, w - 2 * r, h, '#1d1430');
  ellipse(ctx, x + r, y + r, r - 1, r - 1, back);
  px(ctx, x + r, y + 1, w / 2 - r, h - 2, back);
  ellipse(ctx, x + w - r, y + r, r - 1, r - 1, front);
  px(ctx, x + w / 2, y + 1, w / 2 - r, h - 2, front);
  px(ctx, x + w / 2, y + 1, 1, h - 2, '#1d1430');
  px(ctx, x + 2, y + 2, w - 5, 1, 'rgba(255,255,255,0.75)');
}

/** 부드러운 원형 그라디언트 (투명 배경 — 사각형/검은 배경 방지) */
export function softCircle(size: number, hard = 0): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(Math.max(0.01, hard), 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function pixelSquare(size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function smokePuff(size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  // 픽셀 느낌 연기: 몇 개의 원을 겹친 뭉게구름
  const blobs: [number, number, number][] = [[0.5, 0.55, 0.3], [0.35, 0.45, 0.22], [0.65, 0.42, 0.24], [0.5, 0.33, 0.2]];
  for (const [bx, by, br] of blobs) {
    const g = ctx.createRadialGradient(bx * size, by * size, 0, bx * size, by * size, br * size);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return c;
}
