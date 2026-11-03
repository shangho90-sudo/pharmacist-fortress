import { WORLD_H, WORLD_W } from './constants';
import { Rng, hash2 } from './rng';
import { Terrain } from './terrain';

export type MapId = 'herb_forest' | 'ice_peaks' | 'moon_base' | 'pirate_cove' | 'volcano_lab' | 'sky_pharmacy';

export interface MapInfo {
  id: MapId;
  name: string;
  icon: string;
  description: string;
  /** 중력 배율 (탄/캐릭터 공통) */
  gravityScale: number;
  /** 바람 배율 (0이면 무풍) */
  windScale: number;
  /** 물/용암 수면 y (닿으면 탈락). null이면 맵 아래 허공 */
  liquidY: number | null;
  liquid: 'water' | 'ice_water' | 'lava' | null;
  /** 배경 이미지 (public/bg) — 없으면 절차적 배경 */
  backdrop: string | null;
  tags: string[];
}

export const MAP_INFO: Record<MapId, MapInfo> = {
  herb_forest: { id: 'herb_forest', name: '약초의 숲', icon: '🌿', description: '고대 유적과 폭포, 거대한 버섯이 자라는 판타지 숲', gravityScale: 1, windScale: 1, liquidY: null, liquid: null, backdrop: 'herb_forest', tags: ['기본'] },
  ice_peaks: { id: 'ice_peaks', name: '빙결 설산', icon: '❄️', description: '얼음 성채 아래 계단식 설벽과 얼어붙은 호수', gravityScale: 1, windScale: 1.2, liquidY: 1010, liquid: 'ice_water', backdrop: 'ice_peaks', tags: ['강풍', '나무 다리', '호수 추락'] },
  moon_base: { id: 'moon_base', name: '달 기지', icon: '🌙', description: '지구가 떠오른 달 표면과 제약 우주정거장', gravityScale: 0.62, windScale: 0, liquidY: null, liquid: null, backdrop: null, tags: ['저중력', '무풍', '동굴'] },
  pirate_cove: { id: 'pirate_cove', name: '해적의 만', icon: '🏴‍☠️', description: '난파선이 잠든 만, 양쪽 해안의 나무 부두', gravityScale: 1, windScale: 1, liquidY: 880, liquid: 'water', backdrop: 'pirate_cove', tags: ['바다 추락', '부두', '암초'] },
  volcano_lab: { id: 'volcano_lab', name: '화산 연구소', icon: '🌋', description: '용암 바다 위 현무암 지대와 거대한 분화구', gravityScale: 1, windScale: 0.8, liquidY: 1000, liquid: 'lava', backdrop: 'volcano_lab', tags: ['용암', '험준한 지형'] },
  sky_pharmacy: { id: 'sky_pharmacy', name: '하늘의 약국', icon: '☁️', description: '구름 위에 떠 있는 약국 섬들', gravityScale: 1, windScale: 1.3, liquidY: null, liquid: null, backdrop: 'sky_pharmacy', tags: ['공중섬', '낙하 주의', '강풍'] },
};

export const MAP_LIST: MapId[] = ['herb_forest', 'ice_peaks', 'moon_base', 'pirate_cove', 'volcano_lab', 'sky_pharmacy'];
/** 하위 호환: 맵 목록 */
export const MAPS = MAP_LIST.map((id) => MAP_INFO[id]);

/** 재질: 렌더러가 색/무늬를 결정 (물리적으로는 모두 같은 파괴 가능 지형) */
export const MAT = { ground: 0, wood: 1, metal: 2, ice: 3 } as const;

export interface GeneratedMap {
  terrain: Terrain;
  /** 픽셀별 재질 */
  material: Uint8Array;
  spawnXs: number[];
  info: MapInfo;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}
/** 1D 값 노이즈 (사칙연산만 사용 — 결정론적) */
function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  return a + (b - a) * smooth(f);
}
function fbm(x: number, seed: number, oct = 5): number {
  let v = 0,
    amp = 1,
    freq = 1,
    norm = 0;
  for (let o = 0; o < oct; o++) {
    v += valueNoise(x * freq, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return v / norm;
}

class Builder {
  t: Terrain;
  mat: Uint8Array;
  constructor(public w: number, public h: number) {
    this.t = new Terrain(w, h);
    this.mat = new Uint8Array(w * h);
  }
  set(x: number, y: number, v: 0 | 1, m = 0) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.t.mask[i] = v;
    if (v) this.mat[i] = m;
  }
  column(x: number, top: number, bottom = this.h, m = 0) {
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(this.h, bottom); y++) this.set(x, y, 1, m);
  }
  rect(x0: number, y0: number, w: number, h: number, v: 0 | 1, m = 0) {
    for (let y = Math.floor(y0); y < y0 + h; y++) for (let x = Math.floor(x0); x < x0 + w; x++) this.set(x, y, v, m);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, v: 0 | 1, m = 0) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x + 0.5 - cx) / rx,
          dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, v, m);
      }
  }
  /** 위쪽 반은 납작하고 아래로 뾰족해지는 떠 있는 섬 */
  island(cx: number, top: number, halfW: number, depth: number, seed: number, m = 0) {
    for (let x = Math.floor(cx - halfW); x <= cx + halfW; x++) {
      const u = (x - cx) / halfW;
      const edge = 1 - u * u;
      if (edge <= 0) continue;
      const topY = top + (1 - edge) * 10 + (hash2(x >> 2, 3, seed) - 0.5) * 3;
      const bot = top + 8 + depth * edge * (0.6 + 0.4 * fbm(x / 40, seed));
      this.column(x, topY, bot, m);
    }
  }
}

/** 시작 위치: 목표 x 주변에서 액체보다 위에 있는 평탄한 지면을 찾는다 */
function findSpawns(b: Builder, targets: number[], liquidY: number | null): number[] {
  const out: number[] = [];
  const limit = (liquidY ?? b.h) - 40;
  for (const tx of targets) {
    let best = tx,
      bestScore = Infinity;
    for (let dx = -260; dx <= 260; dx += 4) {
      const x = tx + dx;
      if (x < 40 || x > b.w - 40) continue;
      const s = b.t.surfaceBelow(x, 0);
      if (s < 0 || s > limit || s < 120) continue;
      const s1 = b.t.surfaceBelow(x - 8, 0),
        s2 = b.t.surfaceBelow(x + 8, 0);
      const flat = Math.abs(s1 - s) + Math.abs(s2 - s);
      const score = Math.abs(dx) * 0.15 + flat * 3;
      if (score < bestScore && !out.some((o) => Math.abs(o - x) < 160)) {
        bestScore = score;
        best = x;
      }
    }
    out.push(best);
  }
  return out;
}

function targetsFor(w: number, players: number) {
  const margin = players <= 2 ? w * 0.2 : w * 0.1;
  const xs: number[] = [];
  for (let i = 0; i < players; i++) xs.push(Math.round(players === 1 ? w / 2 : margin + (i / (players - 1)) * (w - 2 * margin)));
  return xs;
}

// ─────────────────────────────── 맵별 생성기 ───────────────────────────────

function genHerb(b: Builder, rng: Rng) {
  const { w, h } = b;
  const s1 = rng.int(1, 1e6),
    s2 = rng.int(1, 1e6);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const sym = (fbm(u * 6, s1) + fbm((1 - u) * 6, s1)) * 0.5;
    const detail = fbm(u * 28, s2);
    const c = (u - 0.5) * (u - 0.5);
    const hill = 120 / (1 + c / 0.006 + (c * c) / 0.0002);
    const e = Math.abs(u - 0.5) * 2;
    const edge = e * e * e * e * e * e * 90;
    let y = h * 0.6 - (sym - 0.5) * 340 - (detail - 0.5) * 50 - hill - edge;
    y = Math.max(h * 0.28, Math.min(h * 0.86, y));
    b.column(x, Math.round(y));
  }
  for (const cx of [w * 0.3, w * 0.7]) b.island(cx, h * 0.3 - 10, 110, 70, s1);
}

function genIce(b: Builder, rng: Rng, liquidY: number) {
  const { w, h } = b;
  const s1 = rng.int(1, 1e6);
  // 계단식 설벽: 구간마다 평평한 고원
  const segW = 128;
  const heights: number[] = [];
  for (let i = 0; i * segW < w + segW; i++) {
    const u = (i * segW + segW / 2) / w;
    const v = (fbm(u * 9, s1) + fbm((1 - u) * 9, s1)) * 0.5;
    const jag = hash2(i, 5, s1) - 0.5;
    let y = h * 0.62 - (v - 0.5) * 700 - jag * 90;
    const c = Math.abs(u - 0.5);
    if (c < 0.09) y = liquidY - 30; // 가운데 얼어붙은 호수 계곡
    else y -= (c - 0.09) * 260; // 바깥으로 갈수록 높게
    heights.push(Math.round(Math.max(h * 0.3, Math.min(liquidY - 60, y)) / 40) * 40);
  }
  const surf = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const i = Math.floor(x / segW);
    // 고원 윗면의 완만한 눈 둔덕
    surf[x] = heights[i] - Math.round(fbm(x / 70, s1 + 9) * 16) + Math.round((hash2(x >> 3, 1, s1) - 0.5) * 3);
    b.column(x, surf[x]);
  }
  // 고원 가장자리에 튀어나온 얼음 처마 + 고드름
  for (let i = 1; i * segW < w; i++) {
    const x = i * segW;
    const hl = heights[i - 1],
      hr = heights[i];
    if (Math.abs(hl - hr) < 60) continue;
    const highLeft = hl < hr;
    const top = Math.min(hl, hr);
    const dir = highLeft ? 1 : -1;
    const len = 26 + Math.floor(hash2(i, 9, s1) * 18);
    for (let k = 0; k < len; k++) {
      const xx = x + dir * k;
      b.column(xx, top, top + 14 - Math.floor((k / len) * 6), MAT.ground);
      if (k % 5 === 2) {
        const il = 6 + Math.floor(hash2(xx, 4, s1) * 12);
        for (let j = 0; j < il; j++) {
          const wdt = j < il * 0.5 ? 2 : 1;
          b.rect(xx, top + 14 - Math.floor((k / len) * 6) + j, wdt, 1, 1, MAT.ice);
        }
      }
    }
  }
  // 호수의 얼음 조각
  for (const u of [0.455, 0.5, 0.545]) b.ellipse(w * u, liquidY - 4, 26, 10, 1, MAT.ice);
  // 계곡을 가로지르는 나무 다리 (파괴 가능)
  const bl = Math.floor(w * 0.39),
    br = Math.ceil(w * 0.61);
  const by = Math.min(surf[bl], surf[br]);
  for (let x = bl; x <= br; x++) {
    const sag = Math.round(((x - bl) * (br - x)) / ((br - bl) * (br - bl)) * 4 * 18);
    b.rect(x, by + sag, 1, 5, 1, MAT.wood);
  }
  // 다리 기둥
  for (const px of [bl + 4, br - 6]) b.rect(px, by - 18, 4, 18, 1, MAT.wood);
}

/** 각도별 반지름이 흔들리는 불규칙한 구멍 (사칙연산만 사용) */
function blob(b: Builder, cx: number, cy: number, r: number, seed: number, v: 0 | 1, m = 0, squash = 0.85) {
  const BINS = 12;
  const rs: number[] = [];
  for (let i = 0; i < BINS; i++) rs.push(0.72 + hash2(i, 7, seed) * 0.5);
  for (let y = Math.floor(cy - r * 1.3); y <= cy + r * 1.3; y++)
    for (let x = Math.floor(cx - r * 1.3); x <= cx + r * 1.3; x++) {
      const dx = x + 0.5 - cx,
        dy = (y + 0.5 - cy) / squash;
      const d2 = dx * dx + dy * dy;
      // 다이아몬드 각도 → 구간 보간
      let a = 0;
      if (dx !== 0 || dy !== 0) a = dy >= 0 ? (dx >= 0 ? dy / (dx + dy) : 1 - dx / (-dx + dy)) : dx < 0 ? 2 - dy / (-dx - dy) : 3 + dx / (dx - dy);
      const f = (a / 4) * BINS;
      const i0 = Math.floor(f) % BINS;
      const t = f - Math.floor(f);
      const rr = r * (rs[i0] * (1 - t) + rs[(i0 + 1) % BINS] * t);
      if (d2 <= rr * rr) b.set(x, y, v, m);
    }
}

function genMoon(b: Builder, rng: Rng) {
  const { w, h } = b;
  const s1 = rng.int(1, 1e6),
    s2 = rng.int(1, 1e6);
  const surf = new Int32Array(w);
  // 지표 크레이터 (그릇 모양으로 파인 곳) — 좌우 대칭
  const craters: [number, number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const u = 0.08 + hash2(k, 1, s1) * 0.32;
    const rad = 40 + hash2(k, 2, s1) * 60;
    const dep = 14 + hash2(k, 3, s1) * 26;
    craters.push([u * w, rad, dep], [(1 - u) * w, rad, dep]);
  }
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const v = (fbm(u * 6, s1) + fbm((1 - u) * 6, s1)) * 0.5;
    // 완만한 메사 + 거친 바위 능선
    const step = Math.round(v * 4) / 4;
    const mix = step * 0.6 + v * 0.4;
    const ridge = 1 - Math.abs(fbm(u * 60, s2) * 2 - 1);
    let y = h * 0.64 - (mix - 0.5) * 380 - ridge * 14 - (fbm(u * 160, s2 + 3) - 0.5) * 6;
    for (const [cx, rad, dep] of craters) {
      const d = Math.abs(x - cx) / rad;
      if (d < 1) y += dep * (1 - d * d);
      else if (d < 1.35) y -= dep * 0.35 * (1 - (d - 1) / 0.35); // 가장자리 둔덕
    }
    y = Math.max(h * 0.3, Math.min(h * 0.85, y));
    surf[x] = Math.round(y);
    b.column(x, surf[x]);
  }
  // 튀어나온 바위 (지표 위로 솟은 덩어리)
  for (let k = 0; k < 7; k++) {
    const u = 0.05 + hash2(k, 4, s2) * 0.4;
    for (const xx of [u * w, (1 - u) * w]) {
      const r = 10 + hash2(k, 5, s2) * 16;
      blob(b, xx, surf[Math.floor(xx)] - r * 0.25, r, s2 + k, 1, MAT.ground, 0.7);
    }
  }
  // 내부 동굴 — 수를 줄이고 모양을 불규칙하게
  const keep = targetsFor(w, 4);
  for (let k = 0; k < 6; k++) {
    const u = 0.04 + hash2(k, 6, s1) * 0.42;
    const x = u * w;
    const s = surf[Math.floor(x)];
    const r = 18 + hash2(k, 7, s1) * 34;
    const y = s + r + 40 + hash2(k, 8, s1) * 220;
    if (keep.some((kx) => Math.abs(kx - x) < 100 + r) && y - r < s + 60) continue;
    blob(b, x, y, r, s1 + k, 0, 0, 0.6);
    blob(b, w - x, y, r, s1 + k, 0, 0, 0.6);
  }
  // 금속 다리 2개 (대칭)
  for (const [a, c] of [[0.24, 0.36], [0.64, 0.76]]) {
    const xa = Math.floor(w * a),
      xc = Math.floor(w * c);
    const y = Math.min(b.t.surfaceBelow(xa, 0), b.t.surfaceBelow(xc, 0)) - 6;
    b.rect(xa, y, xc - xa, 8, 1, MAT.metal);
    for (let x = xa + 24; x < xc - 12; x += 64) {
      const ground = b.t.surfaceBelow(x, y + 8);
      if (ground > 0) b.rect(x, y + 8, 6, ground - y - 8, 1, MAT.metal);
    }
  }
}

function genPirate(b: Builder, rng: Rng, liquidY: number) {
  const { w, h } = b;
  const s1 = rng.int(1, 1e6);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const d = Math.min(u, 1 - u); // 가장자리로부터 거리
    if (d > 0.37) continue; // 가운데 바다
    const v = (fbm(u * 8, s1) + fbm((1 - u) * 8, s1)) * 0.5;
    let y = h * 0.56 - (v - 0.5) * 220 - (0.37 - d) * 200;
    if (d > 0.33) y += ((d - 0.33) / 0.04) * (liquidY + 40 - y); // 해안 절벽
    b.column(x, Math.round(y));
  }
  // 암초
  for (const [u, rr] of [[0.44, 22], [0.5, 30], [0.56, 22]] as const) b.ellipse(w * u, liquidY + 4, rr, rr * 1.4, 1);
  // 나무 부두 (안쪽 해안에서 바다 쪽으로)
  for (const side of [-1, 1]) {
    const edgeX = side < 0 ? Math.floor(w * 0.33) : Math.ceil(w * 0.67);
    const top = b.t.surfaceBelow(edgeX - side * 4, 0);
    const len = 120;
    const x0 = side < 0 ? edgeX - 10 : edgeX - len + 10;
    b.rect(x0, top, len, 7, 1, MAT.wood);
    for (let k = 10; k < len; k += 36) b.rect(x0 + k, top + 7, 5, liquidY + 30 - top, 1, MAT.wood);
    // 부두 위 상자
    const cx = side < 0 ? x0 + len - 40 : x0 + 20;
    b.rect(cx, top - 16, 16, 16, 1, MAT.wood);
  }
}

function genVolcano(b: Builder, rng: Rng) {
  const { w, h } = b;
  const s1 = rng.int(1, 1e6),
    s2 = rng.int(1, 1e6);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const v = (fbm(u * 6, s1) + fbm((1 - u) * 6, s1)) * 0.5;
    // 능선형 노이즈로 험준하게
    const r = 1 - Math.abs(fbm(u * 18, s2) * 2 - 1);
    let y = h * 0.66 - (v - 0.5) * 300 - r * 70;
    // 가운데 화산 + 분화구
    const c = Math.abs(u - 0.5);
    if (c < 0.16) {
      const cone = (0.16 - c) / 0.16;
      y -= cone * cone * 330;
      if (c < 0.035) y += ((0.035 - c) / 0.035) * 110;
    }
    y = Math.max(h * 0.25, Math.min(h * 0.86, y));
    b.column(x, Math.round(y));
  }
}

function genSky(b: Builder, rng: Rng) {
  const { w, h } = b;
  const s1 = rng.int(1, 1e6);
  // [x비율, 윗면 y, 반폭, 깊이] — 좌우 대칭 배치
  const isl: [number, number, number, number][] = [
    [0.2, 660, 150, 150],
    [0.5, 560, 190, 200],
    [0.35, 420, 90, 80],
    [0.08, 470, 80, 90],
    [0.33, 780, 100, 90],
    [0.5, 300, 70, 60],
  ];
  for (const [u, top, hw, dep] of isl) {
    b.island(w * u, top, hw, dep, s1);
    if (u !== 0.5) b.island(w * (1 - u), top, hw, dep, s1 + 1);
  }
  // 가운데 섬의 작은 약국 건물 (파괴 가능)
  const cx = Math.floor(w * 0.5);
  b.rect(cx - 30, 300 - 34, 60, 34, 1, MAT.wood);
  b.rect(cx - 36, 300 - 40, 72, 6, 1, MAT.metal);
  void h;
}

/** 맵 생성 (시드 + 맵 id → 항상 같은 지형) */
export function generateMap(seed: number, players: number, mapId: MapId = 'herb_forest', w = WORLD_W, h = WORLD_H): GeneratedMap {
  const info = MAP_INFO[mapId] ?? MAP_INFO.herb_forest;
  const b = new Builder(w, h);
  const rng = new Rng(seed);
  switch (info.id) {
    case 'herb_forest':
      genHerb(b, rng);
      break;
    case 'ice_peaks':
      genIce(b, rng, info.liquidY!);
      break;
    case 'moon_base':
      genMoon(b, rng);
      break;
    case 'pirate_cove':
      genPirate(b, rng, info.liquidY!);
      break;
    case 'volcano_lab':
      genVolcano(b, rng);
      break;
    case 'sky_pharmacy':
      genSky(b, rng);
      break;
  }
  const spawnXs = findSpawns(b, targetsFor(w, players), info.liquidY);
  return { terrain: b.t, material: b.mat, spawnXs, info };
}
