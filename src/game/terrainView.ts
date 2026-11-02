import Phaser from 'phaser';
import { hash2 } from '../core/rng';
import type { Rect, Terrain } from '../core/terrain';
import { MAT, type MapId } from '../core/mapgen';

const CHUNK = 256;

function rgba(r: number, g: number, b: number, a = 255) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; // little-endian ImageData
}
function hex(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}
function mix(a: readonly number[], b: readonly number[], t: number) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

interface Theme {
  top: [string, string, string];
  topDepth: number;
  body: [string, string, string];
  deep: [string, string];
  stone: string;
  stoneHi: string;
  stoneDk: string;
  stoneRate: number;
  fleck: string;
  fleckRate: number;
  craters?: boolean;
  veins?: boolean;
  roots?: boolean;
}

const THEMES: Record<MapId, Theme> = {
  herb_forest: { top: ['#b4ef6a', '#6cc24a', '#3f8f3a'], topDepth: 9, body: ['#8a5a3b', '#6e4630', '#9c6b45'], deep: ['#5d4e5c', '#463a4a'], stone: '#9a96a8', stoneHi: '#c9c6d6', stoneDk: '#5f5b70', stoneRate: 0.16, fleck: '#6fffd2', fleckRate: 0.0025, roots: true },
  ice_peaks: { top: ['#ffffff', '#e2f2ff', '#b8d8f2'], topDepth: 12, body: ['#5a6a8c', '#4a5878', '#6d7ea0'], deep: ['#3a4462', '#2e3652'], stone: '#8ea0c4', stoneHi: '#d8e6ff', stoneDk: '#3a4868', stoneRate: 0.14, fleck: '#bff4ff', fleckRate: 0.006 },
  moon_base: { top: ['#e2e2ea', '#c4c4d0', '#a8a8b8'], topDepth: 7, body: ['#a0a0ae', '#8c8c9c', '#b2b2c0'], deep: ['#6c6c80', '#5a5a70'], stone: '#9090a4', stoneHi: '#d4d4e2', stoneDk: '#4a4a5e', stoneRate: 0.22, fleck: '#7ad8ff', fleckRate: 0.0015, craters: true },
  pirate_cove: { top: ['#8fd45a', '#5aa83e', '#3a7a34'], topDepth: 7, body: ['#5a6470', '#4a5460', '#6a7480'], deep: ['#3c4450', '#323a46'], stone: '#7a8490', stoneHi: '#b8c0cc', stoneDk: '#2e343e', stoneRate: 0.2, fleck: '#e8d08a', fleckRate: 0.004 },
  volcano_lab: { top: ['#9a8a86', '#6e5e5c', '#4a3a3c'], topDepth: 8, body: ['#3a2c30', '#33272b', '#403034'], deep: ['#241a1e', '#1c1418'], stone: '#5a4a4e', stoneHi: '#8a7476', stoneDk: '#1a1214', stoneRate: 0.12, fleck: '#ffb03a', fleckRate: 0.001, veins: true },
  sky_pharmacy: { top: ['#c4ff8a', '#7ee05a', '#4ab048'], topDepth: 9, body: ['#c8a070', '#b08a5a', '#d6b080'], deep: ['#e8e4f4', '#d0cce4'], stone: '#e0d0b8', stoneHi: '#fff4e0', stoneDk: '#9a8060', stoneRate: 0.1, fleck: '#ffffff', fleckRate: 0.004 },
};

/**
 * 지형 렌더러. 물리 마스크(Terrain.mask)를 그대로 읽어 그리므로 화면과 충돌 판정이 항상 일치한다.
 * 맵을 256px 청크로 나눠, 폭발로 바뀐 청크만 다시 그리고 GPU에 업로드한다.
 */
export class TerrainView {
  private base: Uint32Array;
  private scorch: Uint8Array;
  private chunks: { cx: number; cy: number; x: number; y: number; w: number; h: number; tex: Phaser.Textures.CanvasTexture; img: Phaser.GameObjects.Image }[] = [];
  private cols: number;
  private walls: { tex: Phaser.Textures.CanvasTexture; img: Phaser.GameObjects.Image }[] = [];
  readonly terrain: Terrain;

  constructor(scene: Phaser.Scene, terrain: Terrain, material: Uint8Array, mapId: MapId, seed: number, depth = 0) {
    this.terrain = terrain;
    this.base = new Uint32Array(terrain.w * terrain.h);
    this.scorch = new Uint8Array(terrain.w * terrain.h);
    this.buildBase(material, THEMES[mapId] ?? THEMES.herb_forest, seed);
    this.cols = Math.ceil(terrain.w / CHUNK);
    const rows = Math.ceil(terrain.h / CHUNK);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const x = cx * CHUNK,
          y = cy * CHUNK;
        const w = Math.min(CHUNK, terrain.w - x),
          h = Math.min(CHUNK, terrain.h - y);
        const key = `terrain_${cx}_${cy}_${seed}_${Math.random().toString(36).slice(2, 7)}`;
        const tex = scene.textures.createCanvas(key, w, h)!;
        const img = scene.add.image(x, y, key).setOrigin(0, 0).setDepth(depth);
        this.chunks.push({ cx, cy, x, y, w, h, tex, img });
        // 파괴되지 않는 뒷벽(배경): 초기 지형을 어둡게 한 번만 그린다 → 분화구 안이 동굴 벽처럼 보임
        const bkey = key + '_wall';
        const btex = scene.textures.createCanvas(bkey, w, h)!;
        this.paintWall(btex, x, y, w, h);
        btex.refresh();
        this.walls.push({ tex: btex, img: scene.add.image(x, y, bkey).setOrigin(0, 0).setDepth(depth - 1) });
      }
    }
    this.redraw({ x: 0, y: 0, w: terrain.w, h: terrain.h });
  }

  destroy() {
    for (const c of this.chunks) {
      c.img.destroy();
      c.tex.destroy();
    }
    this.chunks = [];
    for (const w of this.walls) {
      w.img.destroy();
      w.tex.destroy();
    }
    this.walls = [];
  }

  private paintWall(tex: Phaser.Textures.CanvasTexture, x0: number, y0: number, w: number, h: number) {
    const ctx = tex.getContext();
    const img = ctx.createImageData(w, h);
    const out = new Uint32Array(img.data.buffer);
    const W = this.terrain.w;
    const m = this.terrain.mask;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * W + x0 + x;
        if (!m[i]) continue;
        const c = this.base[i];
        const r = c & 255,
          g = (c >> 8) & 255,
          b = (c >> 16) & 255;
        const l = (r + g + b) / 3;
        // 어둡고 채도가 낮은 보라빛 흙벽
        out[y * w + x] = rgba(l * 0.22 + r * 0.12 + 18, l * 0.18 + g * 0.08 + 12, l * 0.22 + b * 0.1 + 24);
      }
    ctx.putImageData(img, 0, 0);
  }

  /** 땅 픽셀의 기본 색 (파편 색상 추출용) */
  colorAt(x: number, y: number): number {
    const ix = Math.max(0, Math.min(this.terrain.w - 1, Math.floor(x)));
    const iy = Math.max(0, Math.min(this.terrain.h - 1, Math.floor(y)));
    const c = this.base[iy * this.terrain.w + ix];
    return ((c & 255) << 16) | (((c >> 8) & 255) << 8) | ((c >> 16) & 255);
  }

  private buildBase(material: Uint8Array, th: Theme, seed: number) {
    const { w, h, mask } = this.terrain;
    const T = th.top.map(hex);
    const body = th.body.map(hex);
    const deep = th.deep.map(hex);
    const stone = hex(th.stone),
      stoneHi = hex(th.stoneHi),
      stoneDk = hex(th.stoneDk);
    const fleck = hex(th.fleck);
    const wood = [hex('#9a6a38'), hex('#7a4e26'), hex('#5a361a')];
    const metal = [hex('#9aa6ba'), hex('#6a7690'), hex('#3a445a'), hex('#5ec8ff')];
    const ice = [hex('#e6f8ff'), hex('#a8e4ff'), hex('#6ac0ef')];
    for (let x = 0; x < w; x++) {
      let depth = 0;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (!mask[i]) {
          depth = 0;
          continue;
        }
        const n = hash2(x >> 2, y >> 2, seed);
        const n2 = hash2(x, y, seed + 7);
        const m = material[i];
        let c: number[];
        if (m === MAT.wood) {
          // 나무 판자: 가로 판자 + 이음새 + 못
          const plank = Math.floor(y / 5);
          const seam = (x + plank * 13) % 24 === 0;
          c = y % 5 === 0 || seam ? [...wood[2]] : (plank % 2 ? [...wood[0]] : [...wood[1]]);
          if ((x + plank * 13) % 24 === 2 && y % 5 === 2) c = [200, 200, 210];
        } else if (m === MAT.metal) {
          // 금속 거더: 테두리 + 리벳 + 파란 표시등
          const ey = y % 6;
          c = ey === 0 || ey === 5 ? [...metal[2]] : ey === 1 ? [...metal[0]] : [...metal[1]];
          if (x % 14 === 3 && ey === 3) c = [210, 220, 235];
          if (x % 56 === 10 && ey === 2) c = [...metal[3]];
        } else if (m === MAT.ice) {
          c = depth < 2 ? [...ice[0]] : n < 0.5 ? [...ice[1]] : [...ice[2]];
          if (n2 < 0.06) c = [255, 255, 255];
        } else {
          const topDepth = th.topDepth + Math.floor(hash2(x >> 1, 0, seed + 3) * 4);
          if (depth < 2) c = [...T[0]];
          else if (depth < 5) c = [...T[1]];
          else if (depth < topDepth) c = mix(T[1], T[2], (depth - 5) / Math.max(1, topDepth - 5));
          else {
            const d = Math.min(1, Math.max(0, (depth - 140) / 140));
            const bc = n < 0.33 ? body[0] : n < 0.66 ? body[1] : body[2];
            c = mix(bc, n < 0.5 ? deep[0] : deep[1], d);
            if (((y + Math.floor(hash2(x >> 4, 1, seed) * 6)) % 46) < 2) c = mix(c, [20, 14, 24], 0.3);
            // 돌/크레이터
            const gx = Math.floor(x / 14),
              gy = Math.floor(y / 14);
            const sh = hash2(gx, gy, seed + 11);
            if (sh < th.stoneRate && depth > 12) {
              const scx = gx * 14 + 7 + (hash2(gx, gy, seed + 12) - 0.5) * 6;
              const scy = gy * 14 + 7 + (hash2(gx, gy, seed + 13) - 0.5) * 6;
              const rr = 2.5 + sh * 20;
              const dx = x - scx,
                dy = y - scy;
              const d2 = (dx * dx) / (rr * rr) + (dy * dy) / (rr * rr * 0.6);
              if (d2 < 1) {
                if (th.craters) c = d2 > 0.6 ? (dy < 0 ? [...stoneDk] : [...stoneHi]) : mix(c, [...stoneDk], 0.35);
                else c = d2 < 0.35 && dx < 0 && dy < 0 ? [...stoneHi] : dy > rr * 0.3 ? [...stoneDk] : [...stone];
              }
            }
            // 테마 특수 무늬
            if (th.veins) {
              // 사선으로 이어지는 가는 용암 균열
              const band = (x * 3 + y * 5 + Math.floor(hash2(x >> 5, y >> 5, seed + 31) * 400)) % 97;
              const crack = band < 2 && hash2(x >> 4, y >> 4, seed + 32) < 0.35;
              if (crack && depth > 10) c = mix([255, 110, 30], [255, 210, 90], hash2(x >> 1, y >> 1, seed));
              else if (band < 4 && hash2(x >> 4, y >> 4, seed + 32) < 0.35 && depth > 10) c = mix(c, [150, 40, 20], 0.5);
            }
            if (th.roots && depth > topDepth && depth < 60 && hash2(x >> 1, (y + (x >> 3)) >> 3, seed + 21) < 0.04) c = [90, 58, 34];
            if (depth > 50 && n2 < th.fleckRate) c = [...fleck];
            const v = (n2 - 0.5) * 10;
            c = [c[0] + v, c[1] + v, c[2] + v];
          }
        }
        this.base[i] = rgba(c[0], c[1], c[2]);
        depth++;
      }
    }
  }

  /** 폭발 주변 그을림 기록 */
  addScorch(cx: number, cy: number, r: number) {
    const { w, h } = this.terrain;
    const R = r + 7;
    const x0 = Math.max(0, Math.floor(cx - R)),
      x1 = Math.min(w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)),
      y1 = Math.min(h - 1, Math.ceil(cy + R));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > R) continue;
        const v = Math.round(Math.max(0, Math.min(1, (R - d) / 9)) * 150 + hash2(x, y, 3) * 30);
        const i = y * w + x;
        if (v > this.scorch[i]) this.scorch[i] = Math.min(190, v);
      }
  }

  /** 변경 영역(rect)이 걸친 청크만 다시 그린다 */
  redraw(rect: Rect) {
    const pad = 2;
    const rx0 = Math.max(0, rect.x - pad),
      ry0 = Math.max(0, rect.y - pad);
    const rx1 = Math.min(this.terrain.w, rect.x + rect.w + pad),
      ry1 = Math.min(this.terrain.h, rect.y + rect.h + pad);
    for (const ch of this.chunks) {
      const ix0 = Math.max(rx0, ch.x),
        iy0 = Math.max(ry0, ch.y);
      const ix1 = Math.min(rx1, ch.x + ch.w),
        iy1 = Math.min(ry1, ch.y + ch.h);
      if (ix0 >= ix1 || iy0 >= iy1) continue;
      this.paint(ch, ix0, iy0, ix1 - ix0, iy1 - iy0);
      ch.tex.refresh();
    }
  }

  private paint(ch: (typeof this.chunks)[number], x0: number, y0: number, w: number, h: number) {
    const ctx = ch.tex.getContext();
    const img = ctx.createImageData(w, h);
    const out = new Uint32Array(img.data.buffer);
    const t = this.terrain;
    const W = t.w;
    const m = t.mask;
    for (let y = 0; y < h; y++) {
      const wy = y0 + y;
      for (let x = 0; x < w; x++) {
        const wx = x0 + x;
        const i = wy * W + wx;
        if (!m[i]) {
          out[y * w + x] = 0;
          continue;
        }
        let c = this.base[i];
        let r = c & 255,
          g = (c >> 8) & 255,
          b = (c >> 16) & 255;
        const sc = this.scorch[i];
        if (sc) {
          const k = sc / 255;
          r = r * (1 - k) + 34 * k;
          g = g * (1 - k) + 20 * k;
          b = b * (1 - k) + 22 * k;
        }
        // 외곽선: 빈 공간과 맞닿은 픽셀을 어둡게 → 파괴된 가장자리가 자연스럽게 보임
        const up = wy > 0 ? m[i - W] : 0;
        const left = wx > 0 ? m[i - 1] : 1;
        const right = wx < W - 1 ? m[i + 1] : 1;
        const down = wy < t.h - 1 ? m[i + W] : 1;
        if (!left || !right || !down || (!up && sc)) {
          const k = sc ? 0.45 : 0.3;
          r *= 1 - k;
          g *= 1 - k;
          b *= 1 - k;
        } else if (wy > 1 && !m[i - 2 * W] && sc) {
          r *= 0.8;
          g *= 0.8;
          b *= 0.8;
        }
        out[y * w + x] = rgba(r, g, b);
      }
    }
    ctx.putImageData(img, x0 - ch.x, y0 - ch.y);
  }
}
