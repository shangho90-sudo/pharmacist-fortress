// 약초의 숲 버섯 스프라이트 생성기 (픽셀 단위 셰이딩).
// 텍스처 해상도는 월드 1px당 RES 텍셀(=HD), 화면에는 1/RES 배율로 그린다.
// 광원: 왼쪽 위 (배경 원화와 동일 방향).
import { hash2, Rng } from '../core/rng';
import { makeCanvas } from './art';

export const MUSH_RES = 2;

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed),
    b = hash2(xi + 1, yi, seed),
    c = hash2(xi, yi + 1, seed),
    d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

export type MushKind = 'magic' | 'forest' | 'tan';

interface Palette {
  capTop: RGB;
  capEdge: RGB;
  capDark: RGB;
  rim: RGB;
  spot: RGB;
  gill: RGB;
  gillLight: RGB;
  stem: RGB;
  stemDark: RGB;
  translucent: number;
  spots: number;
}
const PAL: Record<MushKind, Palette> = {
  // 보라색 마법 버섯: 보라→분홍 그라데이션, 반투명 가장자리, 푸른/보랏빛 간접광
  magic: {
    capTop: hex('#7a3ad8'),
    capEdge: hex('#f08ad8'),
    capDark: hex('#2e1260'),
    rim: hex('#ffd2f4'),
    spot: hex('#f4ecff'),
    gill: hex('#8a6ab8'),
    gillLight: hex('#9ec8ff'),
    stem: hex('#ece6f4'),
    stemDark: hex('#6a5a8a'),
    translucent: 0.55,
    spots: 7,
  },
  // 주황색 숲 버섯: 주황/붉은색, 불규칙 흰 반점, 갓 아래 따뜻한 노란 간접광
  forest: {
    capTop: hex('#e8461e'),
    capEdge: hex('#ffa63a'),
    capDark: hex('#6a1408'),
    rim: hex('#ffd08a'),
    spot: hex('#fff6e6'),
    gill: hex('#e8c08a'),
    gillLight: hex('#ffe27a'),
    stem: hex('#f6ecd8'),
    stemDark: hex('#8a6a4a'),
    translucent: 0.15,
    spots: 11,
  },
  // 작은 군집용 갈색 버섯
  tan: {
    capTop: hex('#a0603a'),
    capEdge: hex('#e8b07a'),
    capDark: hex('#3e2010'),
    rim: hex('#f4d4a8'),
    spot: hex('#f4e8d4'),
    gill: hex('#d8b88a'),
    gillLight: hex('#ffe0a0'),
    stem: hex('#f0e6d2'),
    stemDark: hex('#7a6248'),
    translucent: 0.1,
    spots: 3,
  },
};

class Buf {
  d: Float32Array; // r,g,b,a (0..1 a)
  constructor(public w: number, public h: number) {
    this.d = new Float32Array(w * h * 4);
  }
  put(x: number, y: number, c: RGB, a = 1) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const ea = this.d[i + 3];
    const oa = a + ea * (1 - a);
    if (oa <= 0) return;
    for (let k = 0; k < 3; k++) this.d[i + k] = (c[k] * a + this.d[i + k] * ea * (1 - a)) / oa;
    this.d[i + 3] = oa;
  }
  alpha(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[(y * this.w + x) * 4 + 3];
  }
  toCanvas(): HTMLCanvasElement {
    const c = makeCanvas(this.w, this.h);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    // 외곽선: 투명과 맞닿은 픽셀을 자기 색의 어두운 톤으로 (검은 선 아님)
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        const a = this.d[i + 3];
        if (a <= 0.01) continue;
        let k = 1;
        if (a > 0.5 && (this.alpha(x - 1, y) < 0.5 || this.alpha(x + 1, y) < 0.5 || this.alpha(x, y - 1) < 0.5 || this.alpha(x, y + 1) < 0.5)) k = 0.55;
        img.data[i] = clamp(this.d[i] * k, 0, 255);
        img.data[i + 1] = clamp(this.d[i + 1] * k, 0, 255);
        img.data[i + 2] = clamp(this.d[i + 2] * k, 0, 255);
        img.data[i + 3] = Math.round(clamp(a) * 255);
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

/** 명도 포스터라이즈 + 순서 디더 (픽셀아트 질감) */
function post(c: RGB, x: number, y: number, steps = 14): RGB {
  const d = BAYER[(y & 3) * 4 + (x & 3)] / steps;
  return c.map((v) => Math.round(clamp(v / 255 + d) * steps) / steps * 255) as RGB;
}

interface MushParams {
  kind: MushKind;
  capR: number; // 갓 반폭 (월드 px)
  capH: number;
  stemH: number;
  bend: number; // 줄기 휘어짐 (월드 px, +는 오른쪽)
  skew: number; // 갓 비대칭 -0.3..0.3
  ring: boolean;
  seed: number;
}

/** 버섯 1개를 버퍼에 그린다. (bx, by) = 밑동 중심 (텍셀) */
function drawMushroom(B: Buf, bx: number, by: number, p: MushParams, base = true) {
  const S = MUSH_RES;
  const pal = PAL[p.kind];
  const a = p.capR * S,
    ch = p.capH * S,
    sh = p.stemH * S;
  const capCx = bx + p.bend * S,
    capCy = by - sh; // 갓 아래 가장자리 중심
  const L = [-0.6, -0.62, 0.5]; // 광원 (왼쪽 위 앞)
  const rng = new Rng(p.seed);
  const stemW = (v: number) => a * (0.22 + 0.06 * (1 - v) + (v < 0.1 ? (0.1 - v) * 1.1 : 0)) * (1 + 0.06 * Math.sin(v * 6 + p.seed));
  const stemX = (v: number) => bx + p.bend * S * Math.pow(v, 1.5);
  // 1) 밑동 흙 둔덕 + 뿌리
  if (base) {
    const mw = a * 0.62,
      mh = 4 * S;
    for (let y = -mh; y <= 2 * S; y++)
      for (let x = -Math.ceil(mw); x <= mw; x++) {
        const top = -mh * Math.pow(Math.max(0, 1 - (x / mw) ** 2), 0.7) * (0.8 + 0.4 * vnoise(x / (2 * S), 0, p.seed + 5));
        if (y < top) continue;
        const t = clamp((y - top) / (mh + 2 * S));
        const lit = clamp(0.6 - x / mw * 0.3 - t * 0.6);
        B.put(bx + x, by + y, post(lerp(hex('#24140a'), hex('#7a5232'), lit), bx + x, by + y), 1);
      }
    for (let r = 0; r < 5; r++) {
      let x = bx + rng.range(-a * 0.15, a * 0.15),
        y = by - rng.range(0, 3) * S;
      const dir = r % 2 ? 1 : -1;
      const len = a * rng.range(0.4, 0.75);
      for (let k = 0; k < len; k++) {
        x += dir * rng.range(0.7, 1.1);
        y += rng.range(-0.15, 0.5);
        const th = Math.max(1, Math.round((1 - k / len) * 2.2 * S * 0.6));
        for (let j = 0; j < th; j++) B.put(x, y + j, j === 0 ? hex('#8a6a46') : hex('#4a2e18'), 1);
      }
    }
  }
  // 2) 갓 아래 주름(gills): 아래에서 살짝 올려다본 타원면
  const gry = ch * 0.34,
    gcy = ch * 0.02;
  for (let y = 0; y <= gry; y++)
    for (let x = -a * 0.97; x <= a * 0.97; x++) {
      const ex = x / (a * 0.97),
        ey = y / gry;
      if (ex * ex + ey * ey > 1) continue;
      const ang = Math.atan2(y + gry * 0.8, x);
      const line = Math.sin(ang * (a / S) * 1.15 + p.seed) > 0.3;
      const center = 1 - Math.abs(ex);
      let c = line ? lerp(pal.gill, pal.capDark, 0.45) : pal.gill;
      c = lerp(c, pal.gillLight, (1 - ey) * 0.45 * Math.abs(ex)); // 간접광 (가장자리)
      c = lerp(c, [24, 14, 16], center * 0.5 + ey * 0.25); // 안쪽 그늘
      B.put(capCx + x, capCy + gcy + y, post(c, (capCx + x) | 0, (capCy + gcy + y) | 0), 1);
    }
  // 3) 줄기: 휘어진 테이퍼 원통 + 세로 주름
  for (let yy = 0; yy <= sh + gry * 0.5; yy++) {
    const v = yy / sh;
    const y = by - yy;
    const cx = stemX(Math.min(1, v));
    const wHalf = stemW(Math.min(1, v));
    for (let x = Math.floor(cx - wHalf); x <= cx + wHalf; x++) {
      const rel = (x + 0.5 - cx) / wHalf;
      if (Math.abs(rel) > 1) continue;
      const nz = Math.sqrt(1 - rel * rel);
      let lit = clamp(-rel * 0.6 + nz * 0.6 + 0.08);
      if (p.ring && v > 0.56 && v < 0.66) lit *= 0.6 + (v - 0.56) * 2; // 턱받이 그림자
      const stria = vnoise(rel * 5 + p.seed, y / (9 * S), p.seed + 3) + vnoise(rel * 11, y / (5 * S), p.seed + 4) * 0.5;
      lit *= 0.7 + stria * 0.32;
      if (v > 0.72) lit *= clamp(1 - (v - 0.72) * 2.2, 0.25); // 갓 그늘
      let c = lerp(pal.stemDark, pal.stem, lit);
      if (v > 0.6) c = lerp(c, pal.gillLight, 0.1 * (1 - Math.abs(rel))); // 갓 아래 반사광
      if (v < 0.16) c = lerp(c, hex('#4e9a2a'), clamp((0.16 - v) * 7 * (0.6 + 0.6 * vnoise(x / S, y / S, p.seed))) * 0.85); // 이끼
      B.put(x, y, post(c, x, y), 1);
    }
  }
  // 턱받이(스커트): 아래로 늘어진 막
  if (p.ring) {
    const v0 = 0.66;
    const cx = stemX(v0),
      wh = stemW(v0);
    const dh = 3.5 * S;
    for (let j = 0; j < dh; j++)
      for (let x = -wh * (1.15 + j / dh * 0.3); x <= wh * (1.15 + j / dh * 0.3); x++) {
        const rel = x / (wh * (1.15 + j / dh * 0.3));
        const edge = j > dh - 1 - Math.abs(Math.sin(x / S * 1.3)) * S;
        if (edge && j > dh - S) continue;
        const lit = clamp(0.85 - rel * 0.45 - j / dh * 0.35);
        B.put(cx + x, by - v0 * sh + j, post(lerp(pal.stemDark, pal.stem, lit), (cx + x) | 0, (by - v0 * sh + j) | 0), 1);
      }
  }
  // 4) 밑동 이끼 덩이·풀
  if (base) {
    for (let k = 0; k < 7; k++) {
      const mx = bx + rng.range(-a * 0.45, a * 0.45),
        my = by - rng.range(0, 2.5) * S,
        mr = rng.range(1.6, 3.2) * S;
      for (let y = -mr; y <= mr * 0.4; y++)
        for (let x = -mr; x <= mr; x++) {
          if (x * x + y * y > mr * mr) continue;
          const lit = clamp(0.5 - (x + y) / mr * 0.35 + (vnoise(x, y, p.seed + k) - 0.5) * 0.4);
          B.put(mx + x, my + y, post(lerp(hex('#1e4a1a'), hex('#8ccf4a'), lit), (mx + x) | 0, (my + y) | 0), 1);
        }
    }
    for (let k = 0; k < a * 0.9; k++) {
      const x0 = bx + rng.range(-a * 0.65, a * 0.65);
      const hgt = rng.range(2.5, 8) * S * (1 - Math.abs(x0 - bx) / (a * 0.85));
      const lean = rng.range(-0.35, 0.35);
      for (let j = 0; j < hgt; j++) B.put(x0 + lean * j, by - j + S, j > hgt * 0.65 ? hex('#b2e862') : j > hgt * 0.3 ? hex('#66b23a') : hex('#2e6e24'), 1);
    }
  }
  // 5) 갓: 비대칭 돔 + 두툼하게 말린 가장자리
  const spots: [number, number, number][] = [];
  for (let k = 0; k < pal.spots; k++) {
    const big = k % 4 === 0;
    spots.push([rng.range(-0.85, 0.85), rng.range(0.12, 0.9), rng.range(0.045, 0.09) * (big ? 1.7 : 1)]);
  }
  const lipH = Math.max(2.5 * S, ch * 0.14);
  for (let y = Math.floor(-ch * 1.3); y <= ch * 0.2; y++)
    for (let x = Math.floor(-a * 1.08); x <= a * 1.08; x++) {
      const t = x / a;
      const ang = Math.atan2(-y, x);
      const wob = 1 + 0.05 * (vnoise(ang * 3.2, 0, p.seed + 7) - 0.5) * 2;
      const tt = t / wob;
      if (Math.abs(tt) > 1) continue;
      const hgt = ch * (1 + p.skew * tt);
      const topY = -hgt * Math.pow(1 - tt * tt, 0.5);
      const botY = ch * 0.12 * (1 - tt * tt) + ch * 0.03 * Math.sin(tt * 8 + p.seed) * (1 - tt * tt);
      if (y < topY || y > botY) continue;
      const ey = clamp(-y / hgt); // 0 가장자리 → 1 꼭대기
      // 구면 법선 근사
      const nx = tt * 0.95,
        ny = -Math.sqrt(clamp(1 - tt * tt)) * (0.35 + ey * 0.65);
      const nz = Math.sqrt(clamp(1 - nx * nx - ny * ny * 0.6)) + 0.25;
      const len = Math.hypot(nx, ny, nz) || 1;
      let diff = clamp((nx * L[0] + ny * L[1] + nz * L[2]) / len);
      let c = lerp(pal.capEdge, pal.capTop, Math.pow(ey, 0.7));
      const grain = (vnoise(x / (1.4 * S), y / (1.4 * S), p.seed + 11) - 0.5) * 0.14 + (vnoise(x / (5 * S), y / (5 * S), p.seed + 12) - 0.5) * 0.12;
      // 두툼한 말린 가장자리: 아래 밴드에서 법선이 아래를 향함
      const fromBot = botY - y;
      if (fromBot < lipH) {
        const u = fromBot / lipH; // 0 맨 아래 → 1 위
        diff = diff * (0.45 + 0.55 * Math.sin(u * Math.PI * 0.5)) + (u > 0.55 && u < 0.85 ? 0.12 : 0);
      }
      // 반점: 사마귀처럼 살짝 솟은 흰 조각 (오른쪽 아래 그림자)
      let spot = 0,
        spotSh = 0;
      for (const [sx, sy, sr] of spots) {
        const sq = 0.35 + 0.65 * Math.sqrt(clamp(1 - sx * sx));
        const dx = (tt - sx) / (sr * sq),
          dy = (ey - sy) / (sr * 1.25);
        const nn = (vnoise(x / (1.2 * S), y / (1.2 * S), p.seed + 9) - 0.5) * 0.7;
        const dd = dx * dx + dy * dy + nn;
        if (dd < 1) spot = Math.max(spot, dd < 0.7 ? 1 : 0.6);
        const dx2 = (tt - sx - sr * 0.25) / (sr * sq),
          dy2 = (ey - sy + sr * 0.3) / (sr * 1.25);
        if (dx2 * dx2 + dy2 * dy2 + nn < 1.1) spotSh = 1;
      }
      let col = lerp(pal.capDark, c, clamp(0.12 + diff * 1.05 + grain));
      if (spotSh && !spot) col = lerp(col, pal.capDark, 0.35);
      if (spot) col = lerp(col, lerp(lerp(pal.capDark, pal.spot, 0.55), pal.spot, clamp(diff * 1.3)), spot);
      const spec = Math.pow(diff, 14) * (spot ? 0.15 : 0.4);
      col = lerp(col, [255, 255, 255], spec);
      // 반투명 가장자리 (빛이 비침)
      if (fromBot < 2.5 * S) col = lerp(col, pal.rim, pal.translucent * (1 - fromBot / (2.5 * S)) * (0.6 + 0.4 * (1 - Math.abs(tt))));
      // 오른쪽 역광 (숲의 푸른 간접광)
      if (tt > 0.55) col = lerp(col, hex('#86c4ff'), 0.14 * ((tt - 0.55) / 0.45) * (1 - ey));
      B.put(capCx + x, capCy + y, post(col, (capCx + x) | 0, (capCy + y) | 0), 1);
    }
  if (p.kind === 'magic') {
    // 은은한 가장자리 빛 (네온 금지: 약하게)
    for (let x = -a; x <= a; x++) {
      const tt = x / a;
      const y = ch * 0.12 * (1 - tt * tt);
      for (let g = 1; g <= 3 * S; g++) B.put(capCx + x, capCy + y + g, pal.rim, 0.1 * (1 - g / (3 * S)));
    }
  }
}

export interface MushSprite {
  canvas: HTMLCanvasElement;
  /** 밑동 위치 (텍셀) */
  ox: number;
  oy: number;
}

/** 큰 버섯 1개 */
export function makeMushroom(kind: MushKind, size: number, seed: number): MushSprite {
  const rng = new Rng(seed);
  const p: MushParams = {
    kind,
    capR: size * rng.range(0.9, 1.15),
    capH: size * rng.range(0.45, 0.85),
    stemH: size * rng.range(1.3, 2.0),
    bend: size * rng.range(-0.35, 0.35),
    skew: rng.range(-0.25, 0.25),
    ring: rng.next() < 0.45,
    seed,
  };
  const S = MUSH_RES;
  const W = Math.ceil((p.capR * 2.4 + Math.abs(p.bend) * 2) * S) + 8;
  const H = Math.ceil((p.capH * 1.45 + p.stemH + 8) * S) + 6;
  const B = new Buf(W, H);
  const bx = W / 2 - (p.bend * S) / 2,
    by = H - 3 * S;
  drawMushroom(B, bx, by, p);
  return { canvas: B.toCanvas(), ox: bx / W, oy: by / H };
}

/** 작은 군집 버섯 3~6개 */
export function makeCluster(seed: number, size = 9): MushSprite {
  const rng = new Rng(seed);
  const S = MUSH_RES;
  const n = rng.int(3, 6);
  const W = Math.ceil(size * 7 * S),
    H = Math.ceil(size * 4.2 * S);
  const B = new Buf(W, H);
  const by = H - 3 * S;
  const items = Array.from({ length: n }, (_, k) => ({ k, s: size * rng.range(0.45, 1.05), x: W / 2 + rng.range(-size * 2.3, size * 2.3) * S })).sort((a, b) => b.s - a.s);
  // 공통 이끼 둔덕
  for (let x = -W * 0.42; x <= W * 0.42; x++) {
    const hgt = (1 - (x / (W * 0.42)) ** 2) * 4 * S;
    for (let j = 0; j < hgt; j++) B.put(W / 2 + x, by - j + 2 * S, j > hgt * 0.6 ? hex('#8ccc4a') : hex('#4a8a2c'), 1);
  }
  for (const it of items) {
    const kind: MushKind = rng.next() < 0.55 ? 'tan' : rng.next() < 0.5 ? 'forest' : 'magic';
    drawMushroom(B, it.x, by + rng.range(0, 2) * S, { kind, capR: it.s * 0.9, capH: it.s * 0.6, stemH: it.s * rng.range(0.9, 1.6), bend: rng.range(-it.s * 0.3, it.s * 0.3), skew: rng.range(-0.2, 0.2), ring: false, seed: seed + it.k * 31 }, false);
  }
  for (let k = 0; k < size * 3; k++) {
    const x = W / 2 + rng.range(-W * 0.4, W * 0.4);
    const hgt = rng.range(2, 5) * S;
    for (let j = 0; j < hgt; j++) B.put(x, by - j + 2 * S, j > hgt * 0.5 ? hex('#b4ec66') : hex('#5aa832'), 1);
  }
  return { canvas: B.toCanvas(), ox: 0.5, oy: (by + 2 * S) / H };
}
