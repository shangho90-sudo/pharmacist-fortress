import Phaser from 'phaser';
import { hash2 } from '../core/rng';
import type { Rect, Terrain } from '../core/terrain';

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

  constructor(scene: Phaser.Scene, terrain: Terrain, surface: Int16Array, seed: number, depth = 0) {
    this.terrain = terrain;
    this.base = new Uint32Array(terrain.w * terrain.h);
    this.scorch = new Uint8Array(terrain.w * terrain.h);
    this.buildBase(surface, seed);
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

  private buildBase(_surface: Int16Array, seed: number) {
    const { w, h, mask } = this.terrain;
    const grassHi = hex('#b4ef6a'),
      grass = hex('#6cc24a'),
      grassDk = hex('#3f8f3a');
    const soilA = hex('#8a5a3b'),
      soilB = hex('#6e4630'),
      soilC = hex('#9c6b45');
    const rockA = hex('#5d4e5c'),
      rockB = hex('#463a4a');
    const stone = hex('#9a96a8'),
      stoneHi = hex('#c9c6d6'),
      stoneDk = hex('#5f5b70');
    const crystal = hex('#6fffd2');
    const root = hex('#5a3a22');
    for (let x = 0; x < w; x++) {
      let depth = 0;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (!mask[i]) {
          depth = 0;
          continue;
        }
        const n = hash2(x >> 2, y >> 2, seed); // 4px 블록 노이즈(픽셀아트 질감)
        const n2 = hash2(x, y, seed + 7);
        const grassDepth = 8 + Math.floor(hash2(x >> 1, 0, seed + 3) * 5);
        let c: number[];
        if (depth < 2) c = [...grassHi];
        else if (depth < 5) c = [...grass];
        else if (depth < grassDepth) c = mix(grass, grassDk, (depth - 5) / (grassDepth - 5));
        else {
          const deep = Math.min(1, Math.max(0, (depth - 160) / 120));
          const s = n < 0.33 ? soilA : n < 0.66 ? soilB : soilC;
          c = mix(s, n < 0.5 ? rockA : rockB, deep);
          // 지층 띠
          if (((y + Math.floor(hash2(x >> 4, 1, seed) * 6)) % 46) < 2) c = mix(c, [40, 26, 30], 0.35);
          // 돌
          const gx = Math.floor(x / 14),
            gy = Math.floor(y / 14);
          const sh = hash2(gx, gy, seed + 11);
          if (sh < 0.16 && depth > 14) {
            const scx = gx * 14 + 7 + (hash2(gx, gy, seed + 12) - 0.5) * 6;
            const scy = gy * 14 + 7 + (hash2(gx, gy, seed + 13) - 0.5) * 6;
            const rr = 2.5 + sh * 18;
            const dx = x - scx,
              dy = y - scy;
            const d2 = (dx * dx) / (rr * rr) + (dy * dy) / (rr * rr * 0.55);
            if (d2 < 1) c = d2 < 0.35 && dx < 0 && dy < 0 ? [...stoneHi] : dy > rr * 0.3 ? [...stoneDk] : [...stone];
          }
          // 약초 뿌리 (표면 근처)
          if (depth > grassDepth && depth < 60 && hash2(x >> 1, (y + (x >> 3)) >> 3, seed + 21) < 0.04) c = [...root];
          // 결정(광물)
          if (depth > 60 && n2 < 0.0025) c = [...crystal];
          // 미세 노이즈
          const v = (n2 - 0.5) * 10;
          c = [c[0] + v, c[1] + v, c[2] + v];
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
