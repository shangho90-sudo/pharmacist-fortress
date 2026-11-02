// 절차적 픽셀아트 생성기. 모든 프레임은 동일한 캔버스 크기/기준점을 사용 → 애니메이션 중 잘림·흔들림 없음.
import { CHAR_TYPES, type CharTypeId, type CharTypeDef } from '../core/characters';

export const CHAR_W = 40;
export const CHAR_H = 48;
export const GUN_W = 46;
export const GUN_H = 18;
export const GUN_PIVOT_X = 12;
export const GUN_PIVOT_Y = 9;

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

// 공통 팔레트 (레퍼런스: 흰 가운 + 검은 셔츠/바지 + 흰 운동화 + 검은 머리)
const SKIN = '#ffdcc0';
const SKIN_SH = '#efb594';
const SKIN_DK = '#c98a6e';
const OUTLINE = '#3a2028';
const HAIR = '#1f1c26';
const HAIR_MID = '#2f2b3a';
const HAIR_HI = '#4d485e';
const HAIR_DK = '#0e0c13';
const COAT = '#f5f7fc';
const COAT_SH = '#cfd6e4';
const COAT_DK = '#9aa4ba';
const COAT_OL = '#525b72';
const SHIRT = '#22202b';
const SHIRT_HI = '#36333f';
const PANTS = '#1d1b24';
const PANTS_HI = '#34313f';
const SHOE = '#f6f6fa';
const SHOE_SH = '#c4c6d2';
const SHOE_OL = '#3e3f4e';
const WHITE = '#ffffff';
const MOUTH = '#8e2a34';
const GOLD = '#e0ac2a';

export type Eyes = 'open' | 'closed' | 'squint' | 'x' | 'happy' | 'fierce';
export type Mouth = 'neutral' | 'open' | 'smile' | 'frown' | 'grit' | 'grin';

export interface Pose {
  upperDy: number;
  upperDx: number;
  legL: number;
  legR: number;
  legLiftL: number;
  legLiftR: number;
  eyes: Eyes;
  mouth: Mouth;
  armsUp: boolean;
  backArm: boolean;
}

const BASE: Pose = { upperDy: 0, upperDx: 0, legL: 0, legR: 0, legLiftL: 0, legLiftR: 0, eyes: 'open', mouth: 'neutral', armsUp: false, backArm: true };

function spike(ctx: Ctx, x: number, baseY: number, h: number, lean: number, w = 3) {
  for (let i = 0; i < h; i++) {
    const ww = Math.max(1, Math.round(w * (1 - i / h)));
    const xx = x + Math.round(lean * i * 0.7) + Math.floor((w - ww) / 2);
    px(ctx, xx, baseY - i, ww, 1, i === 0 ? HAIR : HAIR_DK);
    if (ww > 1 && i < h - 1) px(ctx, xx + (lean < 0 ? ww - 1 : 0), baseY - i, 1, 1, HAIR_MID);
  }
}

function drawHead(ctx: Ctx, def: CharTypeDef, ox: number, oy: number, eyes: Eyes, mouth: Mouth) {
  const hx = 21 + ox,
    hy = 15 + oy;
  // 뒷머리 (뒤통수 = 왼쪽)
  ellipse(ctx, hx - 2, hy - 1.5, 10.4, 9.6, HAIR_DK, (_x, y) => y <= hy + 5);
  ellipse(ctx, hx - 2, hy - 1.5, 9.5, 8.7, HAIR, (_x, y) => y <= hy + 4);
  // 뻗친 머리
  const spikes: [number, number, number, number][] = [
    [hx - 12, hy - 1, 3, -1.3],
    [hx - 10, hy - 6, 3, -1],
    [hx - 6, hy - 9, 3, -0.6],
    [hx - 2, hy - 10, 3, 0],
    [hx + 3, hy - 9, 2, 0.8],
  ];
  for (const [sx, sy, h, l] of spikes) spike(ctx, sx, sy, h, l, 4);
  // 얼굴
  ellipse(ctx, hx + 1, hy + 2, 9.8, 8.9, OUTLINE, (x) => x > hx - 7);
  ellipse(ctx, hx + 1, hy + 2, 8.9, 8.0, SKIN);
  ellipse(ctx, hx + 1, hy + 2, 8.9, 8.0, SKIN_SH, (x, y) => y >= hy + 8 || x <= hx - 6);
  // 귀
  px(ctx, hx - 6, hy + 1, 3, 4, SKIN_SH);
  px(ctx, hx - 5, hy + 2, 1, 2, SKIN_DK);
  // 옆머리(구레나룻)
  px(ctx, hx - 8, hy - 2, 3, 6, HAIR);
  px(ctx, hx - 7, hy + 4, 1, 2, HAIR);
  // 앞머리 캡
  ellipse(ctx, hx + 0.5, hy - 3, 10.6, 7.4, HAIR_DK, (_x, y) => y <= hy - 3);
  ellipse(ctx, hx + 0.5, hy - 3, 9.8, 6.6, HAIR, (_x, y) => y <= hy - 3);
  // 하이라이트(윤기)
  px(ctx, hx - 4, hy - 7, 5, 1, HAIR_HI);
  px(ctx, hx - 5, hy - 6, 2, 1, HAIR_HI);
  px(ctx, hx + 2, hy - 7, 2, 1, HAIR_MID);
  px(ctx, hx - 2, hy - 8, 3, 1, HAIR_MID);
  // 앞머리 가닥 (이마로 흘러내림)
  const strands = [2, 3, 1, 3, 2, 1, 2, 3, 1, 2, 2, 1, 2, 1, 1];
  for (let i = 0; i < strands.length; i++) {
    const x = hx - 5 + i;
    const L = strands[i];
    px(ctx, x, hy - 3, 1, L, i % 4 === 1 ? HAIR_MID : HAIR);
  }
  // 눈썹
  const by = hy + (eyes === 'fierce' ? 0 : -1);
  px(ctx, hx - 2, by, 4, 1, HAIR_DK);
  px(ctx, hx + 4, by, 4, 1, HAIR_DK);
  if (eyes === 'fierce') {
    px(ctx, hx + 1, by + 1, 1, 1, HAIR_DK);
    px(ctx, hx + 4, by + 1, 1, 1, HAIR_DK);
  }
  // 눈 (뒤쪽 눈 / 앞쪽 눈)
  const ey = hy + 2;
  // (눈: 3x4 큰 눈동자)
  const eyeXs = [hx - 2, hx + 4];
  const ec = def.palette.eye;
  for (const ex of eyeXs) {
    switch (eyes) {
      case 'open':
      case 'fierce':
        px(ctx, ex - (ex === eyeXs[1] ? 0 : 0), ey, 4, 1, OUTLINE); // 윗속눈썹
        px(ctx, ex, ey + 1, 3, 4, ec);
        px(ctx, ex + 1, ey + 2, 1, 2, '#1a0a14');
        px(ctx, ex, ey + 1, 1, 1, WHITE);
        px(ctx, ex + 2, ey + 4, 1, 1, shade(ec, 0.5));
        px(ctx, ex + 3, ey + 1, 1, 4, WHITE);
        if (eyes === 'fierce') px(ctx, ex, ey + 1, 4, 1, OUTLINE);
        break;
      case 'closed':
        px(ctx, ex, ey + 3, 4, 1, OUTLINE);
        break;
      case 'happy':
        px(ctx, ex, ey + 2, 1, 1, OUTLINE);
        px(ctx, ex + 1, ey + 1, 2, 1, OUTLINE);
        px(ctx, ex + 3, ey + 2, 1, 1, OUTLINE);
        break;
      case 'squint':
        px(ctx, ex, ey + 1, 1, 1, OUTLINE);
        px(ctx, ex + 1, ey + 2, 2, 1, OUTLINE);
        px(ctx, ex, ey + 3, 1, 1, OUTLINE);
        break;
      case 'x':
        px(ctx, ex, ey + 1, 1, 1, OUTLINE);
        px(ctx, ex + 2, ey + 1, 1, 1, OUTLINE);
        px(ctx, ex + 1, ey + 2, 1, 1, OUTLINE);
        px(ctx, ex, ey + 3, 1, 1, OUTLINE);
        px(ctx, ex + 2, ey + 3, 1, 1, OUTLINE);
        break;
    }
  }
  // 코
  px(ctx, hx + 8, hy + 6, 1, 1, SKIN_DK);
  // 입
  const mx = hx + 3,
    my = hy + 8;
  switch (mouth) {
    case 'neutral':
      px(ctx, mx, my, 3, 1, MOUTH);
      break;
    case 'smile':
      px(ctx, mx - 1, my - 1, 1, 1, MOUTH);
      px(ctx, mx, my, 3, 1, MOUTH);
      px(ctx, mx + 3, my - 1, 1, 1, MOUTH);
      break;
    case 'grin':
      px(ctx, mx - 1, my - 1, 5, 2, MOUTH);
      px(ctx, mx - 1, my - 1, 5, 1, WHITE);
      break;
    case 'open':
      px(ctx, mx, my - 1, 3, 3, MOUTH);
      px(ctx, mx + 1, my, 1, 1, '#ff8a96');
      break;
    case 'frown':
      px(ctx, mx - 1, my, 1, 1, MOUTH);
      px(ctx, mx, my - 1, 3, 1, MOUTH);
      px(ctx, mx + 3, my, 1, 1, MOUTH);
      break;
    case 'grit':
      px(ctx, mx - 1, my - 1, 5, 2, OUTLINE);
      px(ctx, mx - 1, my - 1, 5, 1, WHITE);
      break;
  }
}

function drawBody(ctx: Ctx, def: CharTypeDef, ox: number, oy: number) {
  const { accent, accentDark } = def.palette;
  const top = 25 + oy;
  const cx = 20 + ox;
  // 목
  px(ctx, cx - 2, top - 2, 4, 3, SKIN_SH);
  for (let r = 0; r < 16; r++) {
    const y = top + r;
    const hw = r < 1 ? 7 : r < 10 ? 8 : 8 + Math.min(2, Math.floor((r - 9) / 3));
    const x0 = cx - hw,
      x1 = cx + hw - 1;
    px(ctx, x0, y, x1 - x0 + 1, 1, COAT_OL);
    if (r < 15) {
      px(ctx, x0 + 1, y, x1 - x0 - 1, 1, COAT);
      px(ctx, x0 + 1, y, 3, 1, COAT_SH); // 뒤쪽 음영
      if (r > 3) px(ctx, x0 + 1, y, 1, 1, COAT_DK);
    }
  }
  // 열린 가운 사이 검은 셔츠
  for (let r = 0; r < 11; r++) {
    const w = r < 3 ? 6 - r : 4;
    px(ctx, cx - Math.floor(w / 2), top + r, w, 1, SHIRT);
  }
  px(ctx, cx - 1, top + 1, 1, 8, SHIRT_HI);
  // 칼라/라펠
  for (let r = 0; r < 5; r++) {
    px(ctx, cx - 4 + Math.floor(r / 2), top + r, 1, 1, COAT_OL);
    px(ctx, cx + 3 - Math.floor(r / 2), top + r, 1, 1, COAT_OL);
  }
  px(ctx, cx - 6, top, 2, 2, COAT);
  px(ctx, cx + 4, top, 2, 2, COAT);
  // 벨트
  px(ctx, cx - 2, top + 9, 4, 1, '#0f0e14');
  px(ctx, cx - 1, top + 9, 2, 1, GOLD);
  // 가운 자락 사이 (다리 사이로 갈라짐)
  px(ctx, cx - 1, top + 11, 2, 5, PANTS);
  px(ctx, cx - 2, top + 11, 1, 4, COAT_OL);
  px(ctx, cx + 1, top + 11, 1, 4, COAT_OL);
  // 주머니 + 펜
  px(ctx, cx - 7, top + 6, 4, 1, COAT_DK);
  px(ctx, cx - 7, top + 6, 1, 3, COAT_DK);
  px(ctx, cx - 4, top + 6, 1, 3, COAT_DK);
  px(ctx, cx - 6, top + 4, 1, 2, accent);
  // 앞주머니
  px(ctx, cx + 3, top + 11, 4, 1, COAT_SH);
  // 테마색 포인트 (어깨 패치/밑단)
  px(ctx, cx + 5, top + 1, 2, 1, accent);
  px(ctx, cx - 9, top + 14, 3, 1, accentDark);
  px(ctx, cx + 6, top + 14, 3, 1, accentDark);
}

function drawLegs(ctx: Ctx, def: CharTypeDef, p: Pose) {
  const legs: [number, number][] = [
    [13 + p.legL, p.legLiftL],
    [24 + p.legR, p.legLiftR],
  ];
  for (const [lx, lift] of legs) {
    px(ctx, lx, 40 - lift, 4, 5, PANTS);
    px(ctx, lx, 40 - lift, 1, 5, PANTS_HI);
    // 운동화
    px(ctx, lx - 1, 44 - lift, 7, 4, SHOE_OL);
    px(ctx, lx, 44 - lift, 5, 2, SHOE);
    px(ctx, lx, 46 - lift, 6, 1, SHOE_SH);
    px(ctx, lx + 1, 45 - lift, 3, 1, def.palette.accent);
  }
}

function drawBackArm(ctx: Ctx, ox: number, oy: number) {
  px(ctx, 9 + ox, 27 + oy, 4, 8, COAT_OL);
  px(ctx, 10 + ox, 27 + oy, 2, 7, COAT_SH);
  px(ctx, 9 + ox, 35 + oy, 3, 2, SKIN_SH);
}

function drawArmsUp(ctx: Ctx, ox: number, oy: number) {
  for (const ax of [8, 28]) {
    px(ctx, ax + ox, 15 + oy, 4, 11, COAT_OL);
    px(ctx, ax + 1 + ox, 16 + oy, 2, 10, COAT);
    px(ctx, ax + ox, 11 + oy, 4, 4, SKIN);
    px(ctx, ax + ox, 14 + oy, 4, 1, SKIN_SH);
  }
}

export function drawCharacter(ctx: Ctx, id: CharTypeId, pose: Partial<Pose>) {
  const def = CHAR_TYPES[id];
  const p = { ...BASE, ...pose };
  ctx.clearRect(0, 0, CHAR_W, CHAR_H);
  if (p.backArm && !p.armsUp) drawBackArm(ctx, p.upperDx, p.upperDy);
  drawLegs(ctx, def, p);
  drawBody(ctx, def, p.upperDx, p.upperDy);
  drawHead(ctx, def, p.upperDx, p.upperDy, p.eyes, p.mouth);
  if (p.armsUp) drawArmsUp(ctx, p.upperDx, p.upperDy);
}

/** 무기 + 앞팔. (GUN_PIVOT_X, GUN_PIVOT_Y)가 어깨 회전축. */
export function drawGun(ctx: Ctx, id: CharTypeId) {
  const def = CHAR_TYPES[id];
  const { accent, accentDark, accentLight, glow } = def.palette;
  ctx.clearRect(0, 0, GUN_W, GUN_H);
  if (id === 'paeng') {
    // 레드&화이트 캡슐 바주카
    px(ctx, 1, 5, 9, 8, '#2a2630'); // 후미
    px(ctx, 2, 6, 7, 6, '#4a4552');
    px(ctx, 9, 4, 2, 10, accentDark);
    px(ctx, 11, 4, 24, 10, '#3a2a30');
    px(ctx, 11, 5, 24, 8, '#f4f4f8');
    px(ctx, 11, 10, 24, 3, '#d0d0dc');
    for (const bx of [15, 23, 31]) {
      px(ctx, bx, 5, 3, 8, accent);
      px(ctx, bx, 10, 3, 3, accentDark);
    }
    px(ctx, 11, 6, 24, 1, WHITE);
    // 확장된 포구
    px(ctx, 35, 2, 10, 14, accentDark);
    px(ctx, 36, 3, 9, 12, accent);
    px(ctx, 36, 3, 9, 2, accentLight);
    px(ctx, 43, 5, 2, 8, '#3a0a10');
    px(ctx, 44, 6, 1, 6, glow);
    // 손잡이
    px(ctx, 18, 13, 3, 4, '#2a2630');
  } else {
    // 보라빛 에너지 캡슐포
    px(ctx, 1, 4, 10, 10, '#1d1030');
    px(ctx, 2, 5, 8, 8, '#33204f');
    px(ctx, 3, 6, 2, 6, accent);
    px(ctx, 11, 3, 22, 12, '#160a26');
    px(ctx, 12, 4, 20, 10, '#2b1746');
    // 유리 캡슐 코어
    px(ctx, 14, 6, 16, 6, '#0f0820');
    px(ctx, 15, 7, 14, 4, accent);
    px(ctx, 15, 7, 14, 1, accentLight);
    px(ctx, 22, 7, 1, 4, '#ffffff');
    // 포구 링 (발광)
    px(ctx, 33, 2, 4, 14, '#160a26');
    px(ctx, 34, 3, 2, 12, glow);
    px(ctx, 37, 5, 8, 8, '#2b1746');
    px(ctx, 38, 6, 7, 6, accentDark);
    px(ctx, 43, 7, 2, 4, accentLight);
    px(ctx, 18, 14, 3, 3, '#160a26');
  }
  // 앞팔 (흰 소매 + 손)
  px(ctx, 7, 9, 12, 5, COAT_OL);
  px(ctx, 8, 10, 10, 3, COAT);
  px(ctx, 8, 12, 10, 1, COAT_SH);
  px(ctx, 17, 11, 4, 4, SKIN);
  px(ctx, 17, 14, 4, 1, SKIN_SH);
}

export interface CharFrames {
  [name: string]: HTMLCanvasElement;
}

export const FRAME_NAMES = ['idle0', 'idle1', 'blink', 'walk0', 'walk1', 'walk2', 'walk3', 'aim', 'shoot', 'hit', 'win', 'lose'] as const;

export function buildCharacterFrames(id: CharTypeId): CharFrames {
  const poses: Record<(typeof FRAME_NAMES)[number], Partial<Pose>> = {
    idle0: {},
    idle1: { upperDy: 1 },
    blink: { eyes: 'closed' },
    walk0: { legL: 1, legR: -1, legLiftR: 1 },
    walk1: { upperDy: -1 },
    walk2: { legL: -1, legR: 1, legLiftL: 1 },
    walk3: { upperDy: -1 },
    aim: { eyes: 'fierce', mouth: 'neutral' },
    shoot: { eyes: 'fierce', mouth: 'grit', upperDx: -1 },
    hit: { eyes: 'x', mouth: 'open', upperDx: -1, upperDy: 1, legL: -1 },
    win: { eyes: 'happy', mouth: 'grin', armsUp: true },
    lose: { eyes: 'x', mouth: 'frown' },
  };
  const out: CharFrames = {};
  for (const name of FRAME_NAMES) {
    const c = makeCanvas(CHAR_W, CHAR_H);
    drawCharacter(c.getContext('2d')!, id, poses[name]);
    out[name] = c;
  }
  const g = makeCanvas(GUN_W, GUN_H);
  drawGun(g.getContext('2d')!, id);
  out.gun = g;
  return out;
}

/** UI용 확대 초상화 (무기 포함, dataURL) */
export function portraitDataUrl(id: CharTypeId, scale = 4, frame: Partial<Pose> = {}, withGun = true): string {
  const src = makeCanvas(CHAR_W + 16, CHAR_H);
  const sctx = src.getContext('2d')!;
  const body = makeCanvas(CHAR_W, CHAR_H);
  drawCharacter(body.getContext('2d')!, id, { eyes: 'fierce', mouth: 'smile', ...frame });
  sctx.drawImage(body, 0, 0);
  const gun = makeCanvas(GUN_W, GUN_H);
  drawGun(gun.getContext('2d')!, id);
  if (withGun) {
    sctx.save();
    sctx.translate(20, 48 - 25);
    sctx.rotate(-0.2);
    sctx.drawImage(gun, -GUN_PIVOT_X, -GUN_PIVOT_Y);
    sctx.restore();
  }
  const c = makeCanvas(src.width * scale, src.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
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
export function drawProjectile(id: string): HTMLCanvasElement {
  switch (id) {
    case 'mega_capsule': {
      const c = makeCanvas(26, 13);
      capsule(c.getContext('2d')!, 0, 0, 26, 13, '#e3262f', '#fbfbff');
      return c;
    }
    case 'dragon_capsule': {
      const c = makeCanvas(18, 10);
      capsule(c.getContext('2d')!, 0, 0, 18, 10, '#6d28d9', '#d8b4fe');
      return c;
    }
    case 'dragon_shard': {
      const c = makeCanvas(8, 8);
      const ctx = c.getContext('2d')!;
      ellipse(ctx, 4, 4, 3.6, 3.6, '#6d28d9');
      ellipse(ctx, 4, 4, 2.4, 2.4, '#b26bff');
      ellipse(ctx, 4.5, 3.5, 1.2, 1.2, '#f3e8ff');
      return c;
    }
    default: {
      const c = makeCanvas(14, 8);
      capsule(c.getContext('2d')!, 0, 0, 14, 8, '#e5383b', '#fbfbff');
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
