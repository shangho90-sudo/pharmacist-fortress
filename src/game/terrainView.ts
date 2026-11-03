import Phaser from 'phaser';
import { hash2 } from '../core/rng';
import type { Rect, Terrain } from '../core/terrain';
import { MAT, type MapId } from '../core/mapgen';

/**
 * 다층 머티리얼 지형 렌더러
 *
 * 1) 내부 머티리얼(정적, 맵 생성 시 1회): 맵마다 4~6개의 암석/흙 변형 팔레트를 월드 좌표 노이즈로
 *    디더링 블렌딩 → 지층·흙덩이·바위·자갈·균열·특수 지형(용암 균열/얼음 결정/크레이터) 합성.
 *    타일을 쓰지 않으므로 이음새나 반복 패턴이 없다.
 * 2) 표면층·조명(동적, 그릴 때마다 현재 마스크에서 계산): 각 픽셀의 "위로 노출된 깊이"와 주변 지표의
 *    기울기를 보고 잔디/눈/먼지/화산재 층을 깔고, 가파르면 바위 절벽면으로 처리. 외곽선·오버행 그림자·
 *    측면 광원(왼쪽 위)·그을음을 적용 → 폭발로 새로 드러난 단면도 즉시 같은 규칙으로 그려진다.
 * 3) 장식(공기 픽셀): 풀잎·꽃·뿌리·고드름·눈덩이를 지형 경계에서 계산 → 파괴 시 자동 갱신.
 *
 * 렌더링과 충돌 판정은 같은 Terrain.mask 하나만 읽으므로 항상 일치한다.
 * 256px 청크로 나눠 폭발 영역이 걸친 청크만 다시 그린다.
 */

const CHUNK = 256;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
/** 표면층 계산 시 위로 살펴보는 최대 깊이 */
const SURF_SCAN = 24;

type RGB = readonly [number, number, number];

function rgba(r: number, g: number, b: number, a = 255) {
  r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}
function mix(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

type SurfaceKind = 'grass' | 'snow' | 'dust' | 'ash';
type Feature = 'lava' | 'crystal' | 'crater' | 'roots';

interface Theme {
  /** 내부 암석/흙 변형 팔레트 4~6개 (각 6단계, 어두움 → 밝음) */
  variants: string[][];
  /** 표면층: [햇빛 하이라이트, 윗면, 중간, 아래] */
  surface: { kind: SurfaceKind; cols: [string, string, string, string]; depth: number; fringe: string };
  /** 가파른 절벽면 하이라이트 */
  cliff: string;
  crack: string;
  /** 박힌 바위 [어두움, 중간, 밝음] */
  boulder: [string, string, string];
  boulderRate: number;
  boulderCell: number;
  /** 자갈 색 */
  pebbles: string[];
  features: Feature[];
  /** 공기 장식 */
  deco: 'meadow' | 'snow' | 'none';
  /** 이끼 낀 바위 윗면 */
  mossy?: boolean;
}

const THEMES: Record<MapId, Theme> = {
  herb_forest: {
    variants: [
      ['#22130b', '#36200f', '#4c2f18', '#664224', '#805833', '#9a6f44'],
      ['#2a120c', '#401c12', '#58281a', '#723826', '#8c4c34', '#a66446'],
      ['#221c1c', '#352c2a', '#4a3e3a', '#605250', '#786866', '#928280'],
      ['#1a1008', '#2a1a0e', '#3c2614', '#52341e', '#6a462a', '#82583a'],
      ['#241a0e', '#3a2a16', '#523c20', '#6c502c', '#86663a', '#a07e4c'],
    ],
    surface: { kind: 'grass', cols: ['#e8ff94', '#9be03c', '#5cae2a', '#3a7a22'], depth: 13, fringe: '#2c5a1a' },
    cliff: '#b08a64',
    crack: '#140a05',
    boulder: ['#2a2434', '#6e6680', '#b4accb'],
    boulderRate: 0.24,
    boulderCell: 44,
    pebbles: ['#8a8098', '#6e6680', '#a89a86'],
    features: ['roots'],
    deco: 'meadow',
    mossy: true,
  },
  ice_peaks: {
    variants: [
      ['#121a30', '#1d2844', '#2b3a5c', '#3f5378', '#5a7096', '#7f95b6'],
      ['#142438', '#1e3650', '#2a4c6c', '#3a668c', '#5284aa', '#78a8c8'],
      ['#181a24', '#262a38', '#373c4e', '#4c5266', '#666c82', '#868ca0'],
      ['#101828', '#18243c', '#223452', '#30486c', '#44608a', '#6480a8'],
    ],
    surface: { kind: 'snow', cols: ['#ffffff', '#f4faff', '#dceaf8', '#aec8e6'], depth: 15, fringe: '#7f9ccc' },
    cliff: '#a8c0e0',
    crack: '#0a1020',
    boulder: ['#28324a', '#7488aa', '#d2e0f4'],
    boulderRate: 0.18,
    boulderCell: 40,
    pebbles: ['#8ea4c8', '#c8d8ee', '#5a6c90'],
    features: ['crystal'],
    deco: 'snow',
  },
  moon_base: {
    variants: [
      ['#141530', '#20223f', '#2e3254', '#40466c', '#585f86', '#7880a4'],
      ['#1a1830', '#272440', '#363256', '#4a456e', '#625c88', '#7e78a4'],
      ['#121a2a', '#1c2840', '#283856', '#384c6e', '#4e6688', '#6e86a6'],
      ['#1c1c24', '#2a2a36', '#3a3a4a', '#4e4e62', '#68687e', '#86869c'],
    ],
    surface: { kind: 'dust', cols: ['#f0f2fc', '#cdd2ea', '#a6acd0', '#8088b2'], depth: 7, fringe: '#5a6290' },
    cliff: '#9aa2cc',
    crack: '#0c0c1e',
    boulder: ['#22223c', '#6a6e98', '#b8bcde'],
    boulderRate: 0.12,
    boulderCell: 40,
    pebbles: ['#9aa0c4', '#6e7498', '#c4c8e2'],
    features: ['crater'],
    deco: 'none',
  },
  pirate_cove: {
    variants: [
      ['#181c22', '#262c34', '#363e48', '#4a545e', '#606c78', '#7c8894'],
      ['#1c1a18', '#2c2824', '#3e3832', '#544c44', '#6c6258', '#887c70'],
      ['#141a1e', '#202a30', '#2e3c44', '#40525c', '#566a76', '#728692'],
      ['#201810', '#32261a', '#463626', '#5c4834', '#745c44', '#8e7456'],
    ],
    surface: { kind: 'grass', cols: ['#d0f48a', '#86cc4a', '#549a34', '#3a7428'], depth: 10, fringe: '#2c5420' },
    cliff: '#9aa4b0',
    crack: '#0c0e12',
    boulder: ['#262c36', '#727c8a', '#bcc4d0'],
    boulderRate: 0.2,
    boulderCell: 38,
    pebbles: ['#8a929e', '#c8b88e', '#5e6670'],
    features: [],
    deco: 'meadow',
    mossy: true,
  },
  volcano_lab: {
    variants: [
      ['#0e0a0c', '#181215', '#231a1e', '#30242a', '#3e3036', '#4e3e44'],
      ['#120a0a', '#1e1010', '#2c1818', '#3c2222', '#4e2e2c', '#623c38'],
      ['#0c0c10', '#16161c', '#202028', '#2c2c36', '#3a3a46', '#4c4c58'],
      ['#100c0a', '#1c1612', '#28201a', '#362c24', '#463a30', '#584a3e'],
    ],
    surface: { kind: 'ash', cols: ['#9a8e8c', '#726666', '#544848', '#3c3232'], depth: 6, fringe: '#2a2022' },
    cliff: '#6a5a5c',
    crack: '#060304',
    boulder: ['#141012', '#4a4044', '#8a7a7c'],
    boulderRate: 0.16,
    boulderCell: 40,
    pebbles: ['#5a4e50', '#3a3234', '#7a6a6c'],
    features: ['lava'],
    deco: 'none',
  },
  sky_pharmacy: {
    variants: [
      ['#3e2a1c', '#56402a', '#705638', '#8a6e4a', '#a4885e', '#bea276'],
      ['#3a2c26', '#524036', '#6a5448', '#846c5c', '#9e8672', '#b8a08a'],
      ['#44301e', '#5e442c', '#785a3c', '#92724e', '#ac8c64', '#c6a67c'],
      ['#342a24', '#4a3e34', '#625446', '#7a6c5a', '#948670', '#ae9e86'],
    ],
    surface: { kind: 'grass', cols: ['#e4ffa0', '#9ae85a', '#5cb440', '#3e8a32'], depth: 12, fringe: '#2e6a28' },
    cliff: '#c8ac86',
    crack: '#24180e',
    boulder: ['#5a4a3e', '#a8957e', '#e8dccb'],
    boulderRate: 0.14,
    boulderCell: 40,
    pebbles: ['#d8c8ae', '#a8957e', '#ece2d0'],
    features: ['roots'],
    deco: 'meadow',
    mossy: true,
  },
};

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

interface Chunk {
  x: number;
  y: number;
  w: number;
  h: number;
  tex: Phaser.Textures.CanvasTexture;
  img: Phaser.GameObjects.Image;
}

export class TerrainView {
  readonly terrain: Terrain;
  private base: Uint32Array;
  private scorch: Uint8Array;
  private chunks: Chunk[] = [];
  private theme: Theme;
  private material: Uint8Array;
  private seed: number;
  private surf: RGB[];
  private fringe: RGB;
  private cliff: RGB;
  /** 마지막 redraw에 걸린 시간(ms) — 성능 확인용 */
  lastRedrawMs = 0;

  constructor(scene: Phaser.Scene, terrain: Terrain, material: Uint8Array, mapId: MapId, seed: number, depth = 0) {
    this.terrain = terrain;
    this.material = material;
    this.seed = seed;
    this.theme = THEMES[mapId] ?? THEMES.herb_forest;
    this.surf = this.theme.surface.cols.map(hex);
    this.fringe = hex(this.theme.surface.fringe);
    this.cliff = hex(this.theme.cliff);
    this.base = new Uint32Array(terrain.w * terrain.h);
    this.scorch = new Uint8Array(terrain.w * terrain.h);
    this.buildBase();
    const cols = Math.ceil(terrain.w / CHUNK),
      rows = Math.ceil(terrain.h / CHUNK);
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * CHUNK,
          y = cy * CHUNK;
        const w = Math.min(CHUNK, terrain.w - x),
          h = Math.min(CHUNK, terrain.h - y);
        const key = `terrain_${cx}_${cy}_${seed}_${Math.random().toString(36).slice(2, 7)}`;
        const tex = scene.textures.createCanvas(key, w, h)!;
        // 지형은 픽셀아트: 최근접 필터 (확대해도 번지지 않음)
        tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
        const img = scene.add.image(x, y, key).setOrigin(0, 0).setDepth(depth);
        this.chunks.push({ x, y, w, h, tex, img });
      }
    this.redraw({ x: 0, y: 0, w: terrain.w, h: terrain.h });
  }

  destroy() {
    for (const c of this.chunks) {
      c.img.destroy();
      c.tex.destroy();
    }
    this.chunks = [];
  }

  /** 땅 픽셀의 기본 색 (파편 색상 추출용) */
  colorAt(x: number, y: number): number {
    const ix = Math.max(0, Math.min(this.terrain.w - 1, Math.floor(x)));
    const iy = Math.max(0, Math.min(this.terrain.h - 1, Math.floor(y)));
    const c = this.base[iy * this.terrain.w + ix];
    return ((c & 255) << 16) | (((c >> 8) & 255) << 8) | ((c >> 16) & 255);
  }

  // ───────────────────────── 1) 내부 머티리얼 ─────────────────────────
  private buildBase() {
    const { w, h, mask } = this.terrain;
    const th = this.theme;
    const seed = this.seed;
    const material = this.material;
    const V = th.variants.map((v) => v.map(hex));
    const nv = V.length;
    const crack = hex(th.crack);
    const bd = th.boulder.map(hex);
    const pb = th.pebbles.map(hex);
    const wood = [hex('#a8743c'), hex('#8a5a2c'), hex('#6a4220'), hex('#3e2410')];
    const metal = [hex('#c8d2e2'), hex('#8e9ab2'), hex('#5e6a84'), hex('#353e54'), hex('#5ec8ff')];
    const ice = [hex('#f2fbff'), hex('#bfeaff'), hex('#86cdf2'), hex('#4f9fd6')];
    const hasF = (f: Feature) => th.features.includes(f);
    // 지층/깊이 기준선: 각 열의 지표 높이를 가로로 부드럽게 평균 → 절벽에서 세로 이음새가 생기지 않음
    const topY = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h && !mask[y * w + x]) y++;
      topY[x] = y;
    }
    const smoothTop = new Float32Array(w);
    {
      const R = 48;
      let acc = 0,
        cnt = 0;
      for (let x = -R; x < w + R; x++) {
        const add = x + R,
          rem = x - R - 1;
        if (add >= 0 && add < w && topY[add] < h) {
          acc += topY[add];
          cnt++;
        }
        if (rem >= 0 && rem < w && topY[rem] < h) {
          acc -= topY[rem];
          cnt--;
        }
        if (x >= 0 && x < w) smoothTop[x] = cnt ? acc / cnt : h;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const depth = Math.max(0, y - smoothTop[x]);
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
          // 변형 팔레트 선택: 큰 영역 노이즈 + 경계 디더링 블렌딩 (타일 이음새 없음)
          const vf = Math.max(0, Math.min(0.999, (fbm2(x / 230, y / 150, seed + 300, 3) - 0.28) / 0.44)) * (nv - 1);
          const v0 = Math.floor(vf);
          // 경계는 좁게(약 12px) + 4×4 베이어 순서 디더 → 지저분한 점 노이즈 없이 자연스럽게 섞임
          const tb = Math.max(0, Math.min(1, (vf - v0 - 0.5) * 5 + 0.5));
          const vi = BAYER[(y & 3) * 4 + (x & 3)] < tb ? Math.min(nv - 1, v0 + 1) : v0;
          const ramp = V[vi];
          // 지층(지표를 따라 흐르는 띠) + 큰 노이즈 + 약한 잔무늬 → 6단계
          const strata = Math.sin((depth + vnoise(x / 70, y / 70, seed + 5) * 28) / 10) * 0.5 + 0.5;
          const n = fbm2(x / 64, y / 16, seed) * 0.6 + strata * 0.28 + fbm2(x / 10, y / 7, seed + 40, 2) * 0.12;
          let band = Math.floor(((n - 0.3) / 0.4) * 5.99);
          // 깊이 명암 (지표 근처 밝게, 깊을수록 어둡게)
          if (depth < 26) band += 1;
          if (depth > 110) band -= 1;
          if (depth > 240) band -= 1;
          band = Math.max(0, Math.min(5, band));
          c = [...ramp[band]];
          // 흙/돌덩이 셰이딩 (엇갈린 격자, 왼쪽 위 광원)
          {
            const cc = 13;
            const rowK = Math.floor(y / cc) % 2;
            const qx = Math.floor((x + rowK * 6) / cc),
              qy = Math.floor(y / cc);
            if (hash2(qx, qy, seed + 64) < 0.55) {
            const ox = qx * cc - rowK * 6 + cc / 2 + (hash2(qx, qy, seed + 61) - 0.5) * 6;
            const oy = qy * cc + cc / 2 + (hash2(qx, qy, seed + 62) - 0.5) * 6;
            const r0 = 3 + hash2(qx, qy, seed + 63) * 4;
            const dx = x + 0.5 - ox,
              dy = y + 0.5 - oy;
            const dd = Math.sqrt(dx * dx + dy * dy * 1.4) / r0;
            if (dd < 1) {
              const lit = (-dx - dy) / r0;
              if (lit > 0.45) c = mix(c, ramp[Math.min(5, band + 1)], 0.6);
              else if (lit < -0.45 && dd > 0.6) c = mix(c, ramp[Math.max(0, band - 1)], 0.5);
            }
            }
          }
          // 균열: 끊기는 가는 선 + 아래쪽 밝은 테두리
          {
            const on = vnoise(x / 34, y / 34, seed + 78) > 0.58;
            if (on && depth > 10) {
              const r1 = Math.abs(fbm2(x / 52, y / 52, seed + 77, 3) - 0.5);
              const r2 = Math.abs(fbm2(x / 52, (y - 1) / 52, seed + 77, 3) - 0.5);
              if (r1 < 0.006) c = [...crack];
              else if (r2 < 0.006) c = mix(c, ramp[Math.min(5, band + 2)], 0.65);
            }
          }
          // 자갈 (1~2px, 하이라이트 1px)
          if (depth > 8) {
            const ph = hash2(x >> 1, y >> 1, seed + 70);
            if (ph < 0.004 && vnoise(x / 40, y / 40, seed + 72) > 0.55) {
              const col = pb[Math.floor(hash2(x >> 1, y >> 1, seed + 71) * pb.length)];
              c = (x & 1) === 0 && (y & 1) === 0 ? mix(col, [255, 255, 255], 0.35) : [...col];
            }
          }
          // 박힌 바위
          {
            const cs = th.boulderCell;
            const gx = Math.floor(x / cs),
              gy = Math.floor(y / cs);
            const hv = hash2(gx, gy, seed + 11);
            if (hv < th.boulderRate && depth > 8) {
              const ccx = gx * cs + cs * 0.3 + hash2(gx, gy, seed + 12) * cs * 0.4;
              const ccy = gy * cs + cs * 0.3 + hash2(gx, gy, seed + 13) * cs * 0.4;
              const rr = 5 + (hv / th.boulderRate) * cs * 0.28;
              const dx = x + 0.5 - ccx,
                dy = y + 0.5 - ccy;
              const wob = 1 + (vnoise(x / 3, y / 3, seed + 14) - 0.5) * 0.24;
              const d = (Math.sqrt(dx * dx + dy * dy * 1.6) / rr) * wob;
              if (d < 1) {
                const lit = (-dx - dy * 1.3) / rr;
                if (d > 0.86) c = [...bd[0]];
                else if (lit > 0.55) c = mix(bd[2], [255, 255, 255], 0.12);
                else if (lit > 0.05) c = [...bd[1]];
                else if (lit > -0.5) c = mix(bd[0], bd[1], 0.55);
                else c = mix(bd[0], bd[1], 0.28);
                if (th.mossy && depth < 80 && dy < -rr * 0.35 && d < 0.86 && vnoise(x / 2, y / 2, seed + 15) > 0.45) c = mix(c, [110, 190, 50], 0.65);
                if (Math.abs(dx - dy * 0.5 - rr * 0.15) < 0.6 && d < 0.7) c = [...bd[0]];
              } else if (d < 1.18 && dy > 0) c = mix(c, [0, 0, 0], 0.32);
            }
          }
          // 맵 특수 지형
          if (hasF('roots') && depth > 8 && depth < 80 && Math.abs(fbm2(x / 16, y / 34, seed + 21, 2) - 0.5) < 0.011) c = mix(c, [60, 36, 20], 0.85);
          if (hasF('crystal') && depth > 24) {
            // 얼음 결정: 셀마다 마름모 결정 + 흰 반짝임
            const cs = 26;
            const gx = Math.floor(x / cs),
              gy = Math.floor(y / cs);
            if (hash2(gx, gy, seed + 81) < 0.11) {
              const ccx = gx * cs + 6 + hash2(gx, gy, seed + 82) * (cs - 12);
              const ccy = gy * cs + 6 + hash2(gx, gy, seed + 83) * (cs - 12);
              const s2 = 3 + hash2(gx, gy, seed + 84) * 4;
              const dx = Math.abs(x + 0.5 - ccx),
                dy = Math.abs(y + 0.5 - ccy);
              const dd = dx / (s2 * 0.6) + dy / s2;
              if (dd < 1) c = dd > 0.75 ? [70, 140, 210] : x + 0.5 < ccx ? [200, 236, 255] : [120, 190, 240];
              if (dd < 0.25 && y + 0.5 < ccy) c = [255, 255, 255];
            }
          }
        }
        this.base[i] = rgba(c[0], c[1], c[2]);
      }
    }
    if (hasF('lava')) this.drawLavaCracks();
    if (hasF('crater')) this.drawCraters();
  }

  private blendBase(x: number, y: number, col: readonly number[], k: number) {
    const { w, h, mask } = this.terrain;
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) return;
    const i = y * w + x;
    const o = this.base[i];
    this.base[i] = rgba((o & 255) * (1 - k) + col[0] * k, ((o >> 8) & 255) * (1 - k) + col[1] * k, ((o >> 16) & 255) * (1 - k) + col[2] * k);
  }

  /** 용암 균열: 지그재그로 갈라지는 균열 (밝은 심지 + 붉은 테두리 + 빛 번짐) */
  private drawLavaCracks() {
    const { w } = this.terrain;
    const seed = this.seed;
    const crack = (x: number, y: number, ang: number, len: number, lvl: number) => {
      for (let s = 0; s < len; s++) {
        const sl = 6 + hash2(s, lvl, seed + Math.floor(x)) * 10;
        const a2 = ang + (hash2(s, 7, seed + Math.floor(y)) - 0.5) * 1.1;
        const nx = x + Math.cos(a2) * sl,
          ny = y + Math.sin(a2) * sl;
        const steps = Math.ceil(sl);
        for (let t = 0; t <= steps; t++) {
          const px = x + ((nx - x) * t) / steps,
            py = y + ((ny - y) * t) / steps;
          for (let oy = -4; oy <= 4; oy++)
            for (let ox = -4; ox <= 4; ox++) {
              const d = Math.abs(ox) + Math.abs(oy);
              if (d >= 4 && d <= 5) this.blendBase(px + ox, py + oy, [120, 34, 16], 0.18);
              else if (d === 3) this.blendBase(px + ox, py + oy, [170, 46, 18], 0.35);
              else if (d === 2) this.blendBase(px + ox, py + oy, [220, 74, 22], 0.6);
            }
          this.blendBase(px, py, [255, 220, 120], 1);
          this.blendBase(px + 1, py, [255, 150, 40], 0.95);
          this.blendBase(px, py + 1, [255, 110, 30], 0.8);
        }
        x = nx;
        y = ny;
        if (lvl > 0 && hash2(s, 9, seed + Math.floor(x)) < 0.2) crack(x, y, ang + (hash2(s, 11, seed) < 0.5 ? -0.9 : 0.9), Math.floor(len / 2), lvl - 1);
      }
    };
    const count = Math.round(w / 100);
    for (let k = 0; k < count; k++) {
      const cx = hash2(k, 1, seed + 91) * w;
      const top = this.terrain.surfaceBelow(cx, 0);
      if (top < 0) continue;
      const cy = top + 26 + hash2(k, 2, seed + 91) * 280;
      const ang = (hash2(k, 3, seed + 91) < 0.5 ? 0.35 : Math.PI - 0.35) + (hash2(k, 4, seed + 91) - 0.5) * 0.6;
      crack(cx, cy, ang, 4 + Math.floor(hash2(k, 5, seed + 91) * 6), 2);
    }
  }

  /** 달 크레이터: 지표 근처의 그릇 모양 함몰 (안쪽 위 어둡게, 아래 밝게, 테두리 하이라이트) */
  private drawCraters() {
    const { w, h, mask } = this.terrain;
    const seed = this.seed;
    for (let k = 0; k < 80; k++) {
      const cx = hash2(k, 1, seed) * w;
      const top = this.terrain.surfaceBelow(cx, 0);
      if (top < 0) continue;
      const r = 4 + hash2(k, 3, seed) * 12;
      const cy = top + r * 0.5 + hash2(k, 2, seed) * 6;
      for (let y = Math.floor(cy - r); y <= cy + r; y++)
        for (let x = Math.floor(cx - r * 1.5); x <= cx + r * 1.5; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) continue;
          const dx = (x - cx) / (r * 1.5),
            dy = (y - cy) / r;
          const d = dx * dx + dy * dy;
          if (d > 1) continue;
          const i = y * w + x;
          const col = this.base[i];
          const k2 = d > 0.78 ? (dy < 0 ? 1.25 : 0.8) : dy < 0 ? 0.68 : 1.08;
          this.base[i] = rgba((col & 255) * k2, ((col >> 8) & 255) * k2, ((col >> 16) & 255) * k2);
        }
    }
  }

  // ───────────────────────── 그을음 ─────────────────────────
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
        const v = Math.round(Math.max(0, Math.min(1, (R - d) / 9)) * 70 + hash2(x, y, 3) * 15);
        const i = y * w + x;
        if (v > this.scorch[i]) this.scorch[i] = Math.min(190, v);
      }
  }

  // ───────────────────────── 다시 그리기 ─────────────────────────
  redraw(rect: Rect) {
    this.redrawMany([rect]);
  }

  /** 여러 폭발을 한 번에: 걸친 청크를 각각 한 번만 갱신 */
  redrawMany(rects: Rect[]) {
    const t0 = performance.now();
    const pad = 26; // 표면층·장식(풀잎·고드름) 높이만큼 여유
    for (const ch of this.chunks) {
      let ix0 = ch.x + ch.w,
        iy0 = ch.y + ch.h,
        ix1 = ch.x,
        iy1 = ch.y;
      for (const rect of rects) {
        const x0 = Math.max(ch.x, rect.x - pad),
          y0 = Math.max(ch.y, rect.y - pad);
        const x1 = Math.min(ch.x + ch.w, rect.x + rect.w + pad),
          y1 = Math.min(ch.y + ch.h, rect.y + rect.h + pad);
        if (x0 >= x1 || y0 >= y1) continue;
        ix0 = Math.min(ix0, x0);
        iy0 = Math.min(iy0, y0);
        ix1 = Math.max(ix1, x1);
        iy1 = Math.max(iy1, y1);
      }
      if (ix0 >= ix1 || iy0 >= iy1) continue;
      this.paint(ch, ix0, iy0, ix1 - ix0, iy1 - iy0);
      ch.tex.refresh();
    }
    this.lastRedrawMs = performance.now() - t0;
  }

  private solid(x: number, y: number): boolean {
    const t = this.terrain;
    if (x < 0 || x >= t.w || y < 0 || y >= t.h) return false;
    return t.mask[y * t.w + x] === 1;
  }

  /** (x, 기준 y) 근처의 지표면 높이: 위아래 ±R에서 공기→땅 전환점. 없으면 NaN */
  private surfaceNear(x: number, y: number, R: number): number {
    const t = this.terrain;
    if (x < 0 || x >= t.w) return NaN;
    // 기준점이 땅이면 위로, 공기면 아래로 탐색
    if (this.solid(x, y)) {
      for (let k = 1; k <= R; k++) if (!this.solid(x, y - k)) return y - k + 1;
      return NaN;
    }
    for (let k = 1; k <= R; k++) if (this.solid(x, y + k)) return y + k;
    return NaN;
  }

  // ───────────────────────── 2) 표면층·조명 ─────────────────────────
  private paint(ch: Chunk, x0: number, y0: number, w: number, h: number) {
    const ctx = ch.tex.getContext();
    const img = ctx.createImageData(w, h);
    const out = new Uint32Array(img.data.buffer);
    const t = this.terrain;
    const W = t.w;
    const m = t.mask;
    const th = this.theme;
    const S = this.surf;
    const seed = this.seed;
    const meadow = th.deco === 'meadow',
      snowy = th.deco === 'snow';
    for (let lx = 0; lx < w; lx++) {
      const wx = x0 + lx;
      // 영역 위쪽에서 이미 이어지는 땅의 두께
      let run = 0;
      for (let k = 1; k <= SURF_SCAN && y0 - k >= 0; k++) {
        if (m[(y0 - k) * W + wx]) run++;
        else break;
      }
      let surfDepth = 0;
      let steep = false;
      if (run > 0) {
        const top = y0 - run;
        ({ surfDepth, steep } = this.surfaceAt(wx, top));
      }
      for (let ly = 0; ly < h; ly++) {
        const wy = y0 + ly;
        const i = wy * W + wx;
        const o = ly * w + lx;
        if (!m[i]) {
          run = 0;
          out[o] = th.deco === 'none' ? 0 : this.decoAt(wx, wy, meadow, snowy);
          continue;
        }
        run++;
        if (run === 1) ({ surfDepth, steep } = this.surfaceAt(wx, wy));
        const c = this.base[i];
        let r = c & 255,
          g = (c >> 8) & 255,
          b = (c >> 16) & 255;
        const isGround = this.material[i] === MAT.ground;
        // 표면층 (잔디/눈/먼지/화산재)
        if (isGround && run <= surfDepth) {
          const tt = run / surfDepth;
          let col: readonly number[] = run === 1 ? S[0] : tt < 0.4 ? S[1] : tt < 0.78 ? S[2] : S[3];
          // 잔디결/눈결: 밝은 털 + 어두운 점
          const hv = hash2(wx, wy, seed + 5);
          if (run > 1 && tt < 0.78 && hv < 0.14) col = S[Math.max(0, (tt < 0.4 ? 1 : 2) - 1)];
          else if (run > 2 && hv > 0.93) col = S[Math.min(3, (tt < 0.4 ? 1 : 2) + 1)];
          // 아래 경계: 들쭉날쭉한 프린지
          if (run >= surfDepth - 1 && hash2(wx, 3, seed + 6) < 0.5) col = this.fringe;
          r = col[0];
          g = col[1];
          b = col[2];
        } else if (isGround && steep && run <= 3) {
          // 가파른 절벽면: 표면층 대신 밝은 암벽 모서리
          const k = run === 1 ? 0.55 : run === 2 ? 0.3 : 0.12;
          r = r + (this.cliff[0] - r) * k;
          g = g + (this.cliff[1] - g) * k;
          b = b + (this.cliff[2] - b) * k;
        } else if (isGround && run <= surfDepth + 3 && th.surface.kind === 'snow') {
          // 눈 아래 푸른 그림자
          r *= 0.82;
          g *= 0.86;
          b = b * 0.92 + 14;
        }
        // 조명: 외곽선 / 오버행 그림자 / 측면 광원
        const airL = !this.solid(wx - 1, wy),
          airR = !this.solid(wx + 1, wy),
          airD = !this.solid(wx, wy + 1);
        let k = 1;
        if (airD) k = 0.5;
        else if (airL || airR) k = run <= surfDepth && isGround ? 0.82 : 0.58;
        else if (!this.solid(wx, wy + 2)) k = 0.66;
        else if (!this.solid(wx, wy + 3)) k = 0.8;
        else if (!this.solid(wx - 2, wy) || !this.solid(wx - 3, wy)) k = 1.1;
        else if (!this.solid(wx + 2, wy) || !this.solid(wx + 3, wy)) k = 0.84;
        // 지표 근처는 하늘빛을 받아 살짝 밝게 (앰비언트)
        if (run > surfDepth && run < surfDepth + 6 && k === 1) k = 1.06;
        r *= k;
        g *= k;
        b *= k;
        const sc = this.scorch[i];
        if (sc) {
          const s2 = sc / 255;
          r = r * (1 - s2) + 28 * s2;
          g = g * (1 - s2) + 20 * s2;
          b = b * (1 - s2) + 24 * s2;
        }
        out[o] = rgba(r, g, b);
      }
    }
    ctx.putImageData(img, x0 - ch.x, y0 - ch.y);
  }

  /** 지표 (x, top)의 기울기에 따라 표면층 두께와 절벽 여부 결정 */
  private surfaceAt(x: number, top: number): { surfDepth: number; steep: boolean } {
    const th = this.theme;
    const hl = this.surfaceNear(x - 4, top, 14),
      hr = this.surfaceNear(x + 4, top, 14);
    let slope: number;
    if (Number.isNaN(hl) && Number.isNaN(hr)) slope = 0;
    else if (Number.isNaN(hl) || Number.isNaN(hr)) slope = 2.2; // 한쪽이 낭떠러지 → 가장자리
    else slope = Math.abs(hr - hl) / 8;
    // 위에 덮인 땅(오버행 아래 천장)이 가까우면 표면층 없음
    const k = Math.max(0, Math.min(1, 1 - (slope - 0.55) / 0.9));
    const jitter = Math.floor(vnoise(x / 7, 0, this.seed + 3) * 4);
    return { surfDepth: k <= 0 ? 0 : Math.max(2, Math.round(th.surface.depth * (0.35 + 0.65 * k)) + jitter), steep: slope > 1.1 };
  }

  private distDown(x: number, y: number, max: number): number {
    const t = this.terrain;
    if (x < 0 || x >= t.w) return -1;
    for (let k = 1; k <= max; k++) {
      const yy = y + k;
      if (yy >= t.h) return -1;
      if (t.mask[yy * t.w + x]) return this.material[yy * t.w + x] === MAT.ground ? k : -1;
    }
    return -1;
  }
  private distUp(x: number, y: number, max: number): number {
    const t = this.terrain;
    if (x < 0 || x >= t.w) return -1;
    for (let k = 1; k <= max; k++) {
      const yy = y - k;
      if (yy < 0) return -1;
      if (t.mask[yy * t.w + x]) return this.material[yy * t.w + x] === MAT.ground ? k : -1;
    }
    return -1;
  }

  // ───────────────────────── 3) 공기 장식 ─────────────────────────
  private decoAt(x: number, y: number, meadow: boolean, snowy: boolean): number {
    const sd = this.seed;
    const S = this.surf;
    const k = this.distDown(x, y, 9);
    if (k > 0) {
      const sy = y + k;
      // 절벽 모서리(옆이 바로 낭떠러지)에는 장식 없음
      if (!this.solid(x - 3, sy + 2) || !this.solid(x + 3, sy + 2)) return 0;
      if (meadow) {
        // 꽃
        for (let dx = -1; dx <= 1; dx++) {
          const fx = x + dx;
          if (hash2(fx, 31, sd) < 0.045 && hash2(fx >> 2, sy >> 3, sd + 3) < 0.7) {
            const fk = dx === 0 ? k : this.distDown(fx, y, 9);
            if (fk < 0) continue;
            const fh = 6 + Math.floor(hash2(fx, 32, sd) * 3);
            const pal = [
              [255, 138, 192],
              [255, 208, 228],
              [255, 224, 102],
              [199, 166, 255],
              [255, 255, 255],
            ];
            const col = pal[Math.floor(hash2(fx, 33, sd) * pal.length)];
            if (fk === fh && dx !== 0) return rgba(col[0], col[1], col[2]);
            if (dx === 0 && (fk === fh || fk === fh + 1)) return fk === fh ? rgba(255, 230, 120) : rgba(col[0], col[1], col[2]);
            if (dx === 0 && fk < fh) return rgba(S[3][0], S[3][1], S[3][2]);
          }
        }
        // 풀잎
        if (hash2(x, sy, sd + 7) < 0.82) {
          const bh = 1 + Math.floor(hash2(x, 34, sd) * 3 + vnoise(x / 9, 0, sd + 8) * 4);
          if (k <= bh) {
            const tt = k / bh;
            const c = tt > 0.66 ? S[0] : tt > 0.33 ? S[1] : S[2];
            return rgba(c[0], c[1], c[2]);
          }
        }
      } else if (snowy) {
        // 눈 둔덕: 지표 위로 1~3px 둥근 눈더미
        const bump = Math.floor(vnoise(x / 6, sy / 20, sd + 12) * 4) - 1;
        if (k <= bump) return k === bump ? rgba(255, 255, 255) : rgba(236, 246, 255);
      }
      return 0;
    }
    // 오버행 아래
    const u = this.distUp(x, y, 20);
    if (u > 0) {
      if (meadow) {
        if (u <= 2 && hash2(x, y - u, sd + 9) < 0.45) return rgba(76, 140, 44);
        if (hash2(x, 41, sd) < 0.07) {
          const len = 6 + Math.floor(hash2(x, 42, sd) * 13);
          if (u <= len) return u === len ? rgba(90, 168, 52) : rgba(74, 46, 24);
        }
      } else if (snowy) {
        // 고드름: 위에서 가늘어지는 얼음 기둥
        if (hash2(x >> 1, 43, sd) < 0.22) {
          const len = 4 + Math.floor(hash2(x >> 1, 44, sd) * 14);
          const wdt = (x & 1) === 0 || u < len * 0.45;
          if (u <= len && wdt) {
            const tt = u / len;
            return tt > 0.85 ? rgba(255, 255, 255) : (x & 1) === 0 ? rgba(200, 236, 255) : rgba(130, 196, 240);
          }
        }
      }
    }
    return 0;
  }
}
