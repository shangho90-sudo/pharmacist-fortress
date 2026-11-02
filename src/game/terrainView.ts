import Phaser from 'phaser';
import { hash2 } from '../core/rng';
import type { Rect, Terrain } from '../core/terrain';
import { MAT, type MapId } from '../core/mapgen';

const CHUNK = 256;

function rgba(r: number, g: number, b: number, a = 255) {
  // 0..255로 고정 (밝게 할 때 넘치면 다른 채널로 번지는 문제 방지)
  r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
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
  /** 암석/흙 단계색 (어두움 → 밝음) */
  ramp: string[];
  /** 지표층 (가장 밝음 → 어두움) */
  top: [string, string, string];
  topDepth: number;
  crack: string;
  /** 박힌 돌 색 (어두움, 중간, 밝음) */
  rock: [string, string, string];
  rockRate: number;
  /** 지표 크레이터 장식 */
  craters?: boolean;
  /** 용암 균열 */
  veins?: boolean;
  /** 뿌리 */
  roots?: boolean;
  /** 광물 반짝이 */
  gem?: string;
  /** 노이즈 스케일 (클수록 큰 무늬) */
  grain: number;
}

const THEMES: Record<MapId, Theme> = {
  herb_forest: { ramp: ['#3e2618', '#5a3822', '#76502f', '#946840', '#b08452'], top: ['#b4ef6a', '#6cc24a', '#3f8f3a'], topDepth: 10, crack: '#2a160e', rock: ['#5f5b70', '#9a96a8', '#d0cede'], rockRate: 0.12, roots: true, gem: '#6fffd2', grain: 1 },
  ice_peaks: { ramp: ['#232c48', '#33405f', '#4a5a80', '#6a7ea6', '#91a6c8'], top: ['#ffffff', '#e2f2ff', '#b8d8f2'], topDepth: 13, crack: '#161c30', rock: ['#3a4868', '#8ea0c4', '#d8e6ff'], rockRate: 0.1, gem: '#bff4ff', grain: 1.2 },
  moon_base: { ramp: ['#1c1d38', '#2b2d52', '#40436e', '#5c618e', '#8188b2'], top: ['#e8ebfa', '#bcc2e0', '#8f96be'], topDepth: 12, crack: '#121226', rock: ['#2a2a48', '#6a6e98', '#b4b8da'], rockRate: 0.1, craters: true, gem: '#7ad8ff', grain: 1.4 },
  pirate_cove: { ramp: ['#20262e', '#303842', '#444e5a', '#5c6874', '#7e8c98'], top: ['#8fd45a', '#5aa83e', '#3a7a34'], topDepth: 8, crack: '#14181e', rock: ['#2e343e', '#7a8490', '#b8c0cc'], rockRate: 0.14, gem: '#e8d08a', grain: 1.1 },
  volcano_lab: { ramp: ['#180e12', '#26181c', '#382428', '#4e3236', '#6a4646'], top: ['#9a8a86', '#6e5e5c', '#4a3a3c'], topDepth: 8, crack: '#0c0608', rock: ['#1a1214', '#5a4a4e', '#8a7476'], rockRate: 0.1, veins: true, grain: 1.2 },
  sky_pharmacy: { ramp: ['#6a4a2e', '#8a6440', '#a87e52', '#c49a68', '#dcb888'], top: ['#c4ff8a', '#7ee05a', '#4ab048'], topDepth: 10, crack: '#4a3020', rock: ['#9a8060', '#e0d0b8', '#fff4e0'], rockRate: 0.08, grain: 1 },
};

/** 부드러운 2D 값 노이즈 (0..1) */
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
function fbm2(x: number, y: number, seed: number, oct = 4) {
  let s = 0,
    amp = 0.5,
    f = 1,
    n = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f, y * f, seed + o * 17) * amp;
    n += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / n;
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
        // 같은 지형 색을 어둡게 + 남색으로 살짝 → 맵마다 자연스러운 동굴 벽
        out[y * w + x] = rgba(r * 0.3 + 10, g * 0.3 + 10, b * 0.34 + 22);
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
    const ramp = th.ramp.map(hex);
    const T = th.top.map(hex);
    const crack = hex(th.crack);
    const rk = th.rock.map(hex);
    const gem = th.gem ? hex(th.gem) : null;
    const wood = [hex('#a8743c'), hex('#8a5a2c'), hex('#6a4220'), hex('#3e2410')];
    const metal = [hex('#c8d2e2'), hex('#8e9ab2'), hex('#5e6a84'), hex('#353e54'), hex('#5ec8ff')];
    const ice = [hex('#f2fbff'), hex('#bfeaff'), hex('#86cdf2'), hex('#4f9fd6')];
    const g = th.grain;
    // 열별 "위에서부터 깊이" (지층/명암 기준)
    for (let x = 0; x < w; x++) {
      let depth = 0;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (!mask[i]) {
          depth = 0;
          continue;
        }
        const m = material[i];
        let c: number[];
        if (m === MAT.wood) {
          const plank = Math.floor(y / 6);
          const off = (plank * 17) % 28;
          const seam = (x + off) % 28 === 0;
          const yy = y % 6;
          const grainN = vnoise(x / 6, y * 1.5, seed + 5);
          c = yy === 0 || seam ? [...wood[3]] : yy === 1 ? [...wood[0]] : grainN > 0.6 ? [...wood[1]] : [...wood[2]];
          if ((x + off) % 28 === 3 && yy === 3) c = [214, 214, 222];
        } else if (m === MAT.metal) {
          const ey = y % 8;
          c = ey === 0 || ey === 7 ? [...metal[3]] : ey === 1 ? [...metal[0]] : ey < 4 ? [...metal[1]] : [...metal[2]];
          if (x % 16 === 4 && (ey === 2 || ey === 5)) c = [236, 242, 250];
          if (x % 64 === 12 && ey === 3) c = [...metal[4]];
        } else if (m === MAT.ice) {
          const n = fbm2(x / 8, y / 8, seed + 9, 2);
          c = depth < 2 ? [...ice[0]] : n > 0.6 ? [...ice[1]] : n > 0.4 ? [...ice[2]] : [...ice[3]];
          if (hash2(x, y, seed) < 0.03) c = [255, 255, 255];
        } else {
          const topDepth = th.topDepth + Math.floor(vnoise(x / 6, 0, seed + 3) * 5);
          // 지표층 (잔디/눈/표토) — 아래쪽 경계는 물결 모양
          if (depth < topDepth) {
            c = depth < 2 ? [...T[0]] : depth < topDepth * 0.55 ? [...T[1]] : [...T[2]];
            if (depth >= 2 && hash2(x, y, seed + 1) < 0.08) c = [...T[0]];
          } else {
            // 암석: 가로로 늘어난 노이즈 + 잔무늬 → 5단계 포스터라이즈
            // 가로로 길게 늘어난 암석층 + 잔무늬 → 5단계 포스터라이즈
            const n = fbm2(x / (44 * g), y / (11 * g), seed) * 0.7 + fbm2(x / (7 * g), y / (5 * g), seed + 40, 2) * 0.3;
            let band = Math.floor(((n - 0.28) / 0.44) * 4.99);
            // 깊이에 따른 명암 (위 밝게, 깊을수록 어둡게)
            if (depth < topDepth + 10) band += 1;
            if (depth > 110) band -= 1;
            if (depth > 260) band -= 1;
            // 지층 (지표를 따라 흐르는 어두운 줄)
            const sd = depth + Math.floor(vnoise(x / 40, y / 40, seed + 2) * 14);
            if (sd % 38 < 2) band -= 1;
            band = Math.max(0, Math.min(4, band));
            c = [...ramp[band]];
            // 균열 (능선 노이즈 선)
            // 균열: 드문드문 끊기는 가는 선 + 아래쪽 밝은 테두리(음각 느낌)
            const r = Math.abs(fbm2(x / 46, y / 46, seed + 77, 3) - 0.5);
            const on = vnoise(x / 30, y / 30, seed + 78) > 0.55;
            const r2 = Math.abs(fbm2(x / 46, (y - 1) / 46, seed + 77, 3) - 0.5);
            if (on && r < 0.006 && depth > topDepth + 6) c = [...crack];
            else if (on && r2 < 0.006 && depth > topDepth + 6) c = mix(c, ramp[Math.min(4, band + 2)], 0.7);
            // 박힌 바위 (지터 셀 중심의 둥근 돌, 좌상단 하이라이트 / 우하단 그림자)
            const cs = 20;
            const gx = Math.floor(x / cs),
              gy = Math.floor(y / cs);
            const hv = hash2(gx, gy, seed + 11);
            if (hv < th.rockRate && depth > topDepth + 6) {
              const ccx = gx * cs + 4 + hash2(gx, gy, seed + 12) * 12;
              const ccy = gy * cs + 4 + hash2(gx, gy, seed + 13) * 12;
              const rr = 3 + hv / th.rockRate * 6;
              const dx = x + 0.5 - ccx,
                dy = y + 0.5 - ccy;
              const d = Math.sqrt(dx * dx + dy * dy * 1.5) / rr;
              if (d < 1) {
                if (d > 0.82) c = [...rk[0]];
                else c = dx + dy < -rr * 0.5 ? [...rk[2]] : dx + dy > rr * 0.4 ? mix(rk[0], rk[1], 0.5) : [...rk[1]];
              }
            }
            if (th.veins) {
              // 드문드문 이어지는 용암 균열 (밝은 심지 + 붉은 테두리)
              const v = Math.abs(fbm2(x / 70, y / 70, seed + 31, 3) - 0.5);
              const gate = vnoise(x / 60, y / 60, seed + 33) > 0.6;
              if (gate && v < 0.006 && depth > 12) c = mix([255, 120, 30], [255, 220, 100], vnoise(x / 3, y / 3, seed));
              else if (gate && v < 0.014 && depth > 12) c = mix(c, [170, 50, 20], 0.5);
            }
            if (th.roots && depth < 70 && Math.abs(fbm2(x / 14, y / 30, seed + 21, 2) - 0.5) < 0.012) c = [74, 46, 26];
            if (gem && depth > 40 && hash2(x >> 1, y >> 1, seed + 50) < 0.0015) c = [...gem];
          }
        }
        this.base[i] = rgba(c[0], c[1], c[2]);
        depth++;
      }
    }
    // 지표 크레이터 장식 (달)
    if (th.craters) {
      for (let k = 0; k < 70; k++) {
        const cx = hash2(k, 1, seed) * w;
        const top = this.terrain.surfaceBelow(cx, 0);
        if (top < 0) continue;
        const cy = top + 8 + hash2(k, 2, seed) * 60;
        const r = 4 + hash2(k, 3, seed) * 11;
        for (let y = Math.floor(cy - r); y <= cy + r; y++)
          for (let x = Math.floor(cx - r * 1.5); x <= cx + r * 1.5; x++) {
            if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) continue;
            const dx = (x - cx) / (r * 1.5),
              dy = (y - cy) / r;
            const d = dx * dx + dy * dy;
            if (d > 1) continue;
            const i = y * w + x;
            const col = this.base[i];
            const cr = col & 255,
              cg = (col >> 8) & 255,
              cb = (col >> 16) & 255;
            // 오목한 그릇: 위쪽 안벽 어둡게, 아래쪽 안벽 밝게, 테두리 밝게
            const k2 = d > 0.75 ? 1.18 : dy < 0 ? 0.72 : 1.06;
            this.base[i] = rgba(cr * k2, cg * k2, cb * k2);
          }
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
    const pad = 5;
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
        // 조명: 1px 외곽선, 위가 트인 면은 밝게, 아래가 트인 면은 그림자
        const air = (dx: number, dy: number) => {
          const xx = wx + dx,
            yy = wy + dy;
          if (xx < 0 || xx >= W) return false;
          if (yy < 0) return true;
          if (yy >= t.h) return false;
          return m[yy * W + xx] === 0;
        };
        let k = 1;
        if (air(0, -1) || air(-1, 0) || air(1, 0) || air(0, 1)) {
          k = air(0, -1) && !sc ? 0.62 : 0.5; // 외곽선
        } else if (air(0, -2) || air(-1, -2) || air(1, -2)) k = 1.28;
        else if (air(0, -3)) k = 1.16;
        else if (air(0, -4)) k = 1.07;
        else if (air(0, 2)) k = 0.72;
        else if (air(0, 3)) k = 0.84;
        else if (air(-2, 0) || air(2, 0)) k = 0.88;
        r *= k;
        g *= k;
        b *= k;
        if (sc) {
          const s2 = sc / 255;
          r = r * (1 - s2) + 30 * s2;
          g = g * (1 - s2) + 20 * s2;
          b = b * (1 - s2) + 30 * s2;
        }
        out[y * w + x] = rgba(r, g, b);
      }
    }
    ctx.putImageData(img, x0 - ch.x, y0 - ch.y);
  }
}
