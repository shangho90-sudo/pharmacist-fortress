// 달 기지(우주) 배경: 성운·별·지구·소행성·우주정거장을 절차적 픽셀아트로 그린다.
// 각 요소는 별도 레이어/스프라이트라서 원경·중경·근경 패럴랙스와 움직임을 줄 수 있다.
import { hash2, Rng } from '../core/rng';
import { makeCanvas } from './art';

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

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
function fbm(x: number, y: number, seed: number, oct = 5) {
  let s = 0,
    amp = 0.5,
    f = 1,
    n = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f, y * f, seed + o * 31) * amp;
    n += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return s / n;
}

function put(d: Uint8ClampedArray, w: number, x: number, y: number, c: RGB, a = 255) {
  const i = (y * w + x) * 4;
  if (a >= 255) {
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  } else {
    const k = a / 255,
      ea = d[i + 3] / 255;
    const oa = k + ea * (1 - k);
    if (oa <= 0) return;
    d[i] = (c[0] * k + d[i] * ea * (1 - k)) / oa;
    d[i + 1] = (c[1] * k + d[i + 1] * ea * (1 - k)) / oa;
    d[i + 2] = (c[2] * k + d[i + 2] * ea * (1 - k)) / oa;
    d[i + 3] = oa * 255;
  }
}

/** 가장 먼 층: 짙은 남색~보라 그라디언트 + 성운 + 별 */
export function nebulaCanvas(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const top = hex('#050719'),
    mid = hex('#0d1238'),
    bot = hex('#1a1446');
  const neb1 = hex('#5a2d9a'),
    neb2 = hex('#2a5ab8'),
    neb3 = hex('#c04aa8');
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const base = t < 0.5 ? lerp(top, mid, t * 2) : lerp(mid, bot, (t - 0.5) * 2);
    for (let x = 0; x < w; x++) {
      // 대각선으로 흐르는 은하수 띠
      const band = Math.exp(-Math.pow((y - h * 0.15 - x * 0.35) / (h * 0.22), 2));
      const n = fbm(x / 140, y / 110, seed, 5);
      const n2 = fbm(x / 60, y / 60, seed + 9, 4);
      let col = base;
      const k1 = Math.max(0, n - 0.42) * 1.9 * (0.35 + band * 0.9);
      col = lerp(col, n2 > 0.5 ? neb1 : neb2, Math.min(0.75, k1));
      const k3 = Math.max(0, n2 - 0.64) * 2.2 * band;
      col = lerp(col, neb3, Math.min(0.45, k3));
      // 4단계 포스터라이즈로 픽셀아트 느낌
      const q = 10;
      put(d, w, x, y, [Math.round(col[0] / q) * q, Math.round(col[1] / q) * q, Math.round(col[2] / q) * q]);
    }
  }
  // 별
  const rng = new Rng(seed + 1);
  for (let i = 0; i < (w * h) / 260; i++) {
    const x = rng.int(0, w - 1),
      y = rng.int(0, h - 1);
    const b = rng.next();
    const col: RGB = b > 0.8 ? [255, 255, 255] : b > 0.5 ? [200, 214, 255] : [140, 150, 200];
    put(d, w, x, y, col, b > 0.3 ? 255 : 150);
  }
  ctx.putImageData(img, 0, 0);
  // 밝은 십자 별
  for (let i = 0; i < 14; i++) {
    const x = rng.int(4, w - 5),
      y = rng.int(4, h - 5);
    ctx.fillStyle = 'rgba(190,210,255,0.55)';
    ctx.fillRect(x - 3, y, 7, 1);
    ctx.fillRect(x, y - 3, 1, 7);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 1, y, 3, 1);
    ctx.fillRect(x, y - 1, 1, 3);
  }
  return c;
}

/** 지구: 구면 조명, 대륙·구름·밤의 도시 불빛, 대기광 */
export function earthCanvas(R: number, seed: number): HTMLCanvasElement {
  const halo = Math.round(R * 0.22);
  const S = (R + halo) * 2;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const cx = S / 2,
    cy = S / 2;
  const L = [-0.55, -0.35, 0.76]; // 빛 방향 (왼쪽 위 앞)
  const deep = hex('#0b2f7a'),
    ocean = hex('#1f5fc8'),
    shallow = hex('#3f8fe8');
  const land1 = hex('#3f8a3a'),
    land2 = hex('#7a9a4a'),
    desert = hex('#c8a86a'),
    ice = hex('#eef6ff');
  const cloud = hex('#ffffff');
  const city = hex('#ffc860');
  const atm = hex('#7cc8ff');
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - cx) / R,
        dy = (y + 0.5 - cy) / R;
      const r2 = dx * dx + dy * dy;
      if (r2 > 1) {
        // 대기광 (바깥 후광)
        const dist = Math.sqrt(r2) - 1;
        const k = Math.max(0, 1 - dist / (halo / R));
        const lit = Math.max(0.15, -(dx * L[0] + dy * L[1]) / Math.sqrt(r2) * 0.8 + 0.4);
        if (k > 0) put(d, S, x, y, atm, Math.round(k * k * 170 * lit));
        continue;
      }
      const nz = Math.sqrt(1 - r2);
      // 구면 좌표 → 텍스처 (경도 회전)
      const lon = Math.atan2(dx, nz) + 1.2;
      const lat = Math.asin(dy);
      const u = lon * 1.6,
        v = lat * 1.6;
      // 큰 대륙(저주파) + 해안선 디테일 약간
      const h = fbm(u * 1.1 + 10, v * 1.1 + 10, seed, 4) * 0.85 + fbm(u * 4 + 3, v * 4 + 3, seed + 2, 3) * 0.15;
      // 가로로 흐르는 구름 띠
      const cl = fbm(u * 1.6 + 40, v * 4.5 + 3, seed + 5, 4) * 0.8 + fbm(u * 6, v * 10, seed + 6, 2) * 0.2;
      const light = dx * L[0] + dy * L[1] + nz * L[2];
      let col: RGB;
      const polar = Math.abs(lat) > 1.25 + (fbm(u * 3, 0, seed + 8, 2) - 0.5) * 0.2;
      if (polar) col = ice;
      else if (h > 0.54) col = h > 0.66 ? desert : h > 0.6 ? land2 : land1;
      else col = h > 0.51 ? shallow : h > 0.42 ? ocean : deep;
      // 구름
      if (cl > 0.58) col = lerp(col, cloud, Math.min(0.95, (cl - 0.58) * 5));
      // 조명 + 밤의 도시
      const day = Math.max(0, Math.min(1, light * 1.6 + 0.25));
      let out: RGB = [col[0] * (0.12 + 0.95 * day), col[1] * (0.12 + 0.95 * day), col[2] * (0.18 + 0.9 * day)];
      if (day < 0.2 && h > 0.56 && !polar && cl < 0.58 && hash2(Math.floor(u * 30), Math.floor(v * 30), seed + 3) < 0.12) out = lerp(out, city, 0.8 * (1 - day * 5));
      // 가장자리 대기 림라이트
      const rim = Math.pow(1 - nz, 3);
      out = lerp(out, atm, Math.min(0.75, rim * (0.4 + day)));
      const q = 8;
      put(d, S, x, y, [Math.round(out[0] / q) * q, Math.round(out[1] / q) * q, Math.round(out[2] / q) * q]);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 소행성: 불규칙 외형 + 높이장 기반 조명 + 크레이터 + 푸른 역광 */
export function asteroidCanvas(size: number, seed: number): HTMLCanvasElement {
  const S = size + 4;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const cx = S / 2,
    cy = S / 2;
  const R = size / 2;
  const radius = (ang: number) => R * (0.74 + 0.26 * fbm(Math.cos(ang) * 1.6 + 5, Math.sin(ang) * 1.6 + 5, seed, 3));
  const pal = ['#1b1a30', '#2c2a48', '#423f64', '#5e5a84', '#827ea8', '#aaa6cc'].map(hex);
  const rimC = hex('#7fb6ff');
  const craters: [number, number, number][] = [];
  const rng = new Rng(seed);
  for (let i = 0; i < 3 + Math.floor(size / 18); i++) craters.push([rng.range(-0.5, 0.5) * R, rng.range(-0.5, 0.5) * R, rng.range(0.1, 0.24) * R]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy;
      const ang = Math.atan2(dy, dx);
      const rr = radius(ang);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > rr) continue;
      const e = dist / rr;
      const nz = Math.sqrt(Math.max(0, 1 - e * e));
      // 빛: 왼쪽 위
      let l = (-dx / rr) * 0.55 + (-dy / rr) * 0.45 + nz * 0.6;
      l += (fbm(x / 6, y / 6, seed + 1, 3) - 0.5) * 0.5;
      for (const [kx, ky, kr] of craters) {
        const cd = Math.hypot(dx - kx, dy - ky) / kr;
        if (cd < 1) l += cd > 0.75 ? 0.25 : (dx - kx) * 0.04 + (dy - ky) * 0.04 - 0.15;
      }
      let idx = Math.max(0, Math.min(5, Math.floor(l * 3.2 + 1.2)));
      if (e > 0.93) idx = Math.max(0, idx - 2); // 외곽선
      let col = pal[idx];
      // 오른쪽 아래 푸른 역광
      if (e > 0.8 && dx + dy > rr * 0.6) col = lerp(col, rimC, 0.45);
      put(d, S, x, y, col);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 우주정거장: 중앙 타워 + 링 + 모듈 + 태양전지판 + 포탑 + 창문 조명 */
export function stationCanvas(seed: number): HTMLCanvasElement {
  const W = 300,
    H = 260;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const rng = new Rng(seed);
  const M = ['#1e2438', '#2e3652', '#46506e', '#66708e', '#8e98b4', '#c4cce0'];
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  /** 금속 박스: 위 하이라이트, 아래 그림자, 외곽선 */
  const box = (x: number, y: number, w: number, h: number, shade = 3) => {
    rect(x - 1, y - 1, w + 2, h + 2, M[0]);
    rect(x, y, w, h, M[shade]);
    rect(x, y, w, 2, M[Math.min(5, shade + 1)]);
    rect(x, y + h - 3, w, 3, M[Math.max(1, shade - 1)]);
    rect(x, y, 1, h, M[Math.min(5, shade + 1)]);
  };
  const windows = (x: number, y: number, w: number, h: number, step = 6) => {
    for (let wy = y; wy < y + h - 2; wy += step)
      for (let wx = x; wx < x + w - 2; wx += step) {
        const on = rng.next();
        rect(wx, wy, 3, 2, on > 0.35 ? (on > 0.8 ? '#ffd48a' : '#5ec8ff') : '#1a2a48');
      }
  };
  // 지지 기둥
  for (const px of [92, 128, 170, 206]) {
    box(px, 150, 10, 110, 2);
    for (let y = 160; y < 255; y += 18) rect(px + 2, y, 6, 2, M[4]);
  }
  // 하부 플랫폼
  box(40, 140, 220, 22, 3);
  windows(48, 146, 204, 12, 8);
  // 좌측 모듈 + 태양전지판
  box(6, 110, 64, 26, 3);
  windows(12, 116, 52, 16);
  for (let i = 0; i < 3; i++) {
    rect(-2 + i * 22, 86, 20, 20, '#1b3a7a');
    for (let gy = 87; gy < 105; gy += 4) rect(-1 + i * 22, gy, 18, 1, '#3f7ad8');
  }
  rect(4, 104, 60, 2, M[4]);
  // 중앙 타워
  box(118, 40, 64, 104, 3);
  windows(124, 52, 52, 88, 7);
  // 링 (원반)
  box(84, 64, 132, 16, 4);
  for (let x = 90; x < 210; x += 10) rect(x, 70, 5, 3, '#5ec8ff');
  // 상부 돔 + 안테나 + 접시
  box(130, 22, 40, 18, 4);
  rect(148, 2, 3, 20, M[4]);
  rect(146, 0, 7, 3, '#ff5a5a');
  box(176, 24, 18, 8, 4);
  rect(190, 14, 2, 10, M[4]);
  // 우측 고층 모듈
  box(226, 60, 34, 80, 3);
  windows(230, 66, 26, 70, 7);
  rect(240, 30, 6, 30, M[4]);
  rect(236, 28, 14, 4, '#5ec8ff');
  // 방어 포탑 2개
  for (const [tx, ty] of [[50, 128], [236, 50]] as const) {
    box(tx, ty, 18, 10, 2);
    rect(tx + 12, ty + 2, 22, 4, M[1]);
    rect(tx + 12, ty + 2, 22, 1, M[4]);
    rect(tx + 4, ty - 4, 8, 4, M[3]);
  }
  return c;
}

/** 지나가는 우주선 (작은 스프라이트) */
export function shipCanvas(): HTMLCanvasElement {
  const c = makeCanvas(34, 12);
  const ctx = c.getContext('2d')!;
  const r = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  r(6, 3, 22, 6, '#2e3652');
  r(7, 4, 20, 3, '#8e98b4');
  r(7, 4, 20, 1, '#c4cce0');
  r(24, 4, 6, 4, '#66708e');
  r(28, 5, 4, 2, '#c4cce0');
  r(14, 1, 8, 2, '#46506e');
  r(14, 9, 8, 2, '#46506e');
  r(17, 4, 4, 2, '#5ec8ff');
  r(0, 4, 6, 4, '#ffb84a');
  r(2, 5, 4, 2, '#ffffff');
  return c;
}
