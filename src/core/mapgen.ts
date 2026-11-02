import { WORLD_H, WORLD_W } from './constants';
import { Rng, hash2 } from './rng';
import { Terrain } from './terrain';

export interface MapInfo {
  id: string;
  name: string;
  description: string;
}

export const MAPS: MapInfo[] = [
  { id: 'herb_forest', name: '약초의 숲', description: '초록빛 숲과 거대한 약초, 버섯이 자라는 전장' },
];

export interface GeneratedMap {
  terrain: Terrain;
  /** 생성 시점의 원래 지표면 y (렌더러가 잔디/흙 층을 칠할 때 사용) */
  surface: Int16Array;
  spawnXs: number[];
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

function fbm(x: number, seed: number): number {
  let v = 0,
    amp = 1,
    freq = 1,
    norm = 0;
  for (let o = 0; o < 5; o++) {
    v += valueNoise(x * freq, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return v / norm; // 0..1
}

/**
 * 약초의 숲 지형 생성. 좌우 대칭 성분을 섞어 시작 위치가 공정하도록 한다.
 */
export function generateMap(seed: number, players: number, w = WORLD_W, h = WORLD_H): GeneratedMap {
  const terrain = new Terrain(w, h);
  const surface = new Int16Array(w);
  const rng = new Rng(seed);
  const s1 = rng.int(1, 1e6);
  const s2 = rng.int(1, 1e6);

  const base = h * 0.6;
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const sym = (fbm(u * 6, s1) + fbm((1 - u) * 6, s1)) * 0.5; // 대칭 큰 굴곡
    const detail = fbm(u * 28, s2); // 비대칭 작은 굴곡
    // 중앙은 언덕, 양 끝은 약간 솟은 절벽 느낌
    // 사칙연산만 사용(엔진 간 동일 결과 보장)
    const c = (u - 0.5) * (u - 0.5);
    const hill = 120 / (1 + c / 0.006 + (c * c) / 0.0002);
    const e = Math.abs(u - 0.5) * 2;
    const edge = e * e * e * e * e * e * 90;
    let y = base - (sym - 0.5) * 340 - (detail - 0.5) * 50 - hill - edge;
    y = Math.max(h * 0.28, Math.min(h * 0.86, y));
    surface[x] = Math.round(y);
  }

  const m = terrain.mask;
  for (let x = 0; x < w; x++) {
    for (let y = surface[x]; y < h; y++) m[y * w + x] = 1;
  }

  // 떠 있는 섬 2개 (대칭)
  const islandY = h * 0.3;
  for (const cx of [w * 0.3, w * 0.7]) {
    const rx = 110,
      ry = 34;
    for (let y = Math.floor(islandY - ry); y < islandY + ry * 1.6; y++) {
      for (let x = Math.floor(cx - rx); x < cx + rx; x++) {
        const dx = (x - cx) / rx;
        const dyTop = (y - islandY) / ry;
        const dyBot = (y - islandY) / (ry * 1.6);
        const inside = y < islandY ? dx * dx + dyTop * dyTop * 4 < 1 && y > islandY - ry * 0.35 : dx * dx + dyBot * dyBot < 1;
        if (inside && x >= 0 && x < w && y >= 0 && y < h) {
          m[y * w + x] = 1;
        }
      }
    }
    for (let x = Math.floor(cx - rx); x < cx + rx; x++) {
      for (let y = Math.floor(islandY - ry); y < islandY + ry * 1.6; y++) {
        if (terrain.solidAt(x, y)) {
          if (surface[x] > y) surface[x] = Math.min(surface[x], y); // 섬도 잔디 처리
          break;
        }
      }
    }
  }

  const spawnXs: number[] = [];
  const margin = players <= 2 ? w * 0.2 : w * 0.1;
  for (let i = 0; i < players; i++) {
    const t = players === 1 ? 0.5 : i / (players - 1);
    spawnXs.push(Math.round(margin + t * (w - 2 * margin)));
  }
  return { terrain, surface, spawnXs };
}
