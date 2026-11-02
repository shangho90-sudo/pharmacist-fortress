// 약초의 숲 다층 패럴랙스 배경 (절차적 픽셀아트)
import { Rng } from '../core/rng';
import { makeCanvas, shade } from './art';

export interface BgLayer {
  canvas: HTMLCanvasElement;
  factor: number;
  y: number;
}

function fbm(rng: Rng, n: number, octaves = 4): number[] {
  const out = new Array(n).fill(0);
  let amp = 1,
    total = 0;
  for (let o = 0; o < octaves; o++) {
    const step = Math.max(2, Math.floor(n / (4 * Math.pow(2, o))));
    const pts: number[] = [];
    for (let i = 0; i <= Math.ceil(n / step) + 1; i++) pts.push(rng.next());
    for (let x = 0; x < n; x++) {
      const i = Math.floor(x / step);
      const t = (x % step) / step;
      const s = t * t * (3 - 2 * t);
      out[x] += (pts[i] + (pts[i + 1] - pts[i]) * s) * amp;
    }
    total += amp;
    amp *= 0.5;
  }
  return out.map((v) => v / total);
}

export function skyCanvas(w: number, h: number, theme: 'herb' | 'volcano' | 'sky' = 'herb'): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  // 픽셀 밴딩 그라디언트 (디더 대신 계단식 밴드)
  const stops =
    theme === 'volcano'
      ? ['#140812', '#2a0c18', '#4a1220', '#7a1e1c', '#b23a1a', '#e8661e']
      : theme === 'sky'
        ? ['#3c9cff', '#5cb4ff', '#82caff', '#aadcff', '#d2eeff', '#f4fbff']
        : ['#3fa9d6', '#5cc3e0', '#86d9e2', '#b3ead7', '#dff5cf', '#fff2c4'];
  const band = Math.ceil(h / stops.length);
  for (let i = 0; i < stops.length; i++) {
    ctx.fillStyle = stops[i];
    ctx.fillRect(0, i * band, w, band + 1);
    // 밴드 경계 디더
    if (i < stops.length - 1) {
      ctx.fillStyle = stops[i + 1];
      for (let x = 0; x < w; x += 2) ctx.fillRect(x + ((i * band) % 2), (i + 1) * band - 2, 1, 1);
      for (let x = 1; x < w; x += 2) ctx.fillRect(x, (i + 1) * band - 1, 1, 1);
    }
  }
  if (theme === 'volcano') {
    // 붉은 화산 빛 + 연기 띠
    const g2 = ctx.createRadialGradient(w * 0.5, h, 0, w * 0.5, h, h * 0.9);
    g2.addColorStop(0, 'rgba(255,140,40,0.55)');
    g2.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
    return c;
  }
  // 태양
  const sx = w * 0.78,
    sy = h * 0.2;
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 140);
  g.addColorStop(0, 'rgba(255,255,220,0.9)');
  g.addColorStop(0.15, 'rgba(255,250,200,0.6)');
  g.addColorStop(1, 'rgba(255,250,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fffbe0';
  for (let y = -12; y <= 12; y++) {
    const hw = Math.floor(Math.sqrt(144 - y * y));
    ctx.fillRect(sx - hw, sy + y, hw * 2, 1);
  }
  return c;
}

export function cloudsCanvas(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const rng = new Rng(seed);
  for (let i = 0; i < 9; i++) {
    const cx = rng.range(0, w),
      cy = rng.range(h * 0.1, h * 0.7);
    const n = rng.int(4, 7);
    for (let k = 0; k < n; k++) {
      const bx = cx + rng.range(-50, 50),
        by = cy + rng.range(-8, 8),
        r = rng.range(14, 30);
      for (let y = -r; y <= r * 0.6; y++) {
        const hw = Math.floor(Math.sqrt(r * r - y * y));
        ctx.fillStyle = y > r * 0.25 ? 'rgba(214,236,244,0.95)' : 'rgba(255,255,255,0.95)';
        // 수평으로 반복 가능한 타일이 되도록 래핑
        for (const off of [-w, 0, w]) ctx.fillRect(Math.round(bx - hw + off), Math.round(by + y), hw * 2, 1);
      }
    }
  }
  return c;
}

function silhouette(ctx: CanvasRenderingContext2D, heights: number[], color: string, h: number) {
  ctx.fillStyle = color;
  for (let x = 0; x < heights.length; x++) ctx.fillRect(x, Math.round(heights[x]), 1, h - Math.round(heights[x]));
}

function mushroom(ctx: CanvasRenderingContext2D, x: number, groundY: number, size: number, cap: string, stem: string, rng: Rng) {
  const stemW = Math.max(3, Math.round(size * 0.22));
  const stemH = Math.round(size * 1.1);
  ctx.fillStyle = stem;
  ctx.fillRect(x - stemW / 2, groundY - stemH, stemW, stemH);
  ctx.fillStyle = shade(stem, -0.15);
  ctx.fillRect(x - stemW / 2, groundY - stemH, Math.max(1, Math.floor(stemW / 3)), stemH);
  const rx = size * 0.75,
    ry = size * 0.45;
  const cy = groundY - stemH;
  for (let y = -ry; y <= 2; y++) {
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    ctx.fillStyle = y > -2 ? shade(cap, -0.25) : cap;
    ctx.fillRect(Math.round(x - hw), Math.round(cy + y), hw * 2, 1);
  }
  ctx.fillStyle = shade(cap, 0.55);
  for (let i = 0; i < 4; i++) {
    const dx = rng.range(-rx * 0.6, rx * 0.6),
      dy = rng.range(-ry * 0.8, -ry * 0.2);
    const s = Math.max(1, Math.round(size * 0.08));
    ctx.fillRect(Math.round(x + dx), Math.round(cy + dy), s, s);
  }
}

function herb(ctx: CanvasRenderingContext2D, x: number, groundY: number, height: number, color: string, rng: Rng) {
  // 거대한 약초 줄기 + 잎
  ctx.fillStyle = shade(color, -0.2);
  let cx = x;
  for (let y = 0; y < height; y++) {
    cx += Math.sin(y / 18) * 0.25;
    ctx.fillRect(Math.round(cx), groundY - y, 3, 1);
    if (y > 20 && y % 22 === 0) {
      const dir = (y / 22) % 2 === 0 ? 1 : -1;
      const len = rng.range(18, 32) * (1 - y / height / 2);
      for (let k = 0; k < len; k++) {
        const ly = groundY - y - Math.sin((k / len) * Math.PI) * 6 - k * 0.3;
        const wdt = Math.max(1, Math.round(Math.sin((k / len) * Math.PI) * 5));
        ctx.fillStyle = k % 5 === 0 ? shade(color, 0.15) : color;
        ctx.fillRect(Math.round(cx + dir * k), Math.round(ly - wdt / 2), 1, wdt);
      }
      ctx.fillStyle = shade(color, -0.2);
    }
  }
  // 꽃/봉오리
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(Math.round(cx) - 2, groundY - height - 4, 7, 5);
  ctx.fillStyle = '#ffb3c8';
  ctx.fillRect(Math.round(cx) - 1, groundY - height - 3, 5, 3);
}

/** 패럴랙스 레이어 생성. viewW/H: 월드 기준 화면 크기, worldW/H: 맵 크기, camTop: 카메라 최상단 */
export function buildForestLayers(viewW: number, viewH: number, worldW: number, worldH: number, camTop: number, seed: number): BgLayer[] {
  const rng = new Rng(seed);
  const layers: BgLayer[] = [];
  const defs = [
    { f: 0.12, base: 0.55, amp: 160, col: '#93c9b6', deco: 'none' },
    { f: 0.3, base: 0.6, amp: 120, col: '#6aa98a', deco: 'herb' },
    { f: 0.5, base: 0.66, amp: 90, col: '#477f66', deco: 'mush' },
  ];
  for (const d of defs) {
    const w = Math.ceil(viewW + (worldW - viewW) * d.f) + 4;
    const fy = d.f * 0.6;
    const scrollRangeY = worldH - viewH - camTop;
    const h = Math.ceil(viewH + scrollRangeY * fy) + 4;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    const groundBase = h * d.base;
    const hs = fbm(rng, w, 4).map((v) => groundBase - v * d.amp);
    // 대기원근: 위쪽으로 갈수록 밝게 (안개 띠)
    if (d.deco === 'herb') {
      for (let i = 0; i < w / 90; i++) {
        const x = rng.range(0, w);
        herb(ctx, x, Math.round(hs[Math.floor(x)] + 6), rng.range(90, 200), '#5d9c7c', rng);
      }
    }
    if (d.deco === 'mush') {
      const caps = ['#b35a7a', '#c77b4a', '#8a5aa8'];
      for (let i = 0; i < w / 160; i++) {
        const x = rng.range(0, w);
        mushroom(ctx, x, Math.round(hs[Math.floor(x)] + 8), rng.range(26, 60), caps[rng.int(0, 2)], '#d8cdb8', rng);
      }
    }
    silhouette(ctx, hs, d.col, h);
    // 능선 하이라이트
    ctx.fillStyle = shade(d.col, 0.18);
    for (let x = 0; x < w; x++) ctx.fillRect(x, Math.round(hs[x]), 1, 2);
    // 나무 실루엣(먼 산 제외)
    if (d.deco !== 'none') {
      ctx.fillStyle = shade(d.col, -0.08);
      for (let i = 0; i < w / 25; i++) {
        const x = Math.floor(rng.range(0, w));
        const th = rng.range(18, 46);
        const gy = hs[x] + 3;
        for (let y = 0; y < th; y++) {
          const hw = Math.round((1 - y / th) * th * 0.28) + 1;
          ctx.fillRect(x - hw, Math.round(gy - y), hw * 2, 1);
        }
      }
    }
    layers.push({ canvas: c, factor: d.f, y: camTop * fy });
  }
  return layers;
}

/** 화산 연구소 레이어 */
export function buildVolcanoLayers(viewW: number, viewH: number, worldW: number, worldH: number, camTop: number, seed: number): BgLayer[] {
  const rng = new Rng(seed);
  const out: BgLayer[] = [];
  const defs = [
    { f: 0.12, base: 0.6, amp: 220, col: '#3a1220', glow: '#ff6a2a' },
    { f: 0.3, base: 0.66, amp: 150, col: '#22080f', glow: '#ff9a3a' },
  ];
  defs.forEach((d, li) => {
    const w = Math.ceil(viewW + (worldW - viewW) * d.f) + 4;
    const fy = d.f * 0.6;
    const h = Math.ceil(viewH + (worldH - viewH - camTop) * fy) + 4;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    const hs = fbm(rng, w, 4).map((v, x) => {
      // 뾰족한 화산 봉우리
      const peak = Math.max(0, 1 - Math.abs(((x / w) * (li ? 5 : 3)) % 1 - 0.5) * 2.6);
      return h * d.base - v * d.amp * 0.5 - peak * peak * d.amp;
    });
    silhouette(ctx, hs, d.col, h);
    // 용암 흐름 (능선에서 흘러내림)
    for (let i = 0; i < w / 160; i++) {
      let x = Math.floor(rng.range(0, w));
      let y = hs[x] + 2;
      ctx.fillStyle = d.glow;
      for (let k = 0; k < 60; k++) {
        ctx.fillRect(x, y, 2, 2);
        y += 2;
        x += rng.int(-1, 1);
        if (x < 0 || x >= w) break;
      }
    }
    // 연구소 실루엣 (가까운 층)
    if (li === 1) {
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(rng.range(0, w - 60));
        const bw = rng.int(30, 60),
          bh = rng.int(40, 110);
        const gy = Math.round(hs[x + (bw >> 1)]) + 6;
        ctx.fillStyle = '#16060c';
        ctx.fillRect(x, gy - bh, bw, bh);
        ctx.fillRect(x + bw / 2 - 2, gy - bh - 20, 4, 20);
        ctx.fillStyle = '#ffb03a';
        for (let wy = gy - bh + 8; wy < gy - 8; wy += 10) for (let wx = x + 5; wx < x + bw - 5; wx += 9) if (rng.next() < 0.55) ctx.fillRect(wx, wy, 3, 4);
      }
    }
    out.push({ canvas: c, factor: d.f, y: camTop * fy });
  });
  return out;
}

/** 하늘의 약국 레이어: 먼 구름 띠 + 떠 있는 섬 실루엣 */
export function buildSkyLayers(viewW: number, viewH: number, worldW: number, worldH: number, camTop: number, seed: number): BgLayer[] {
  const rng = new Rng(seed);
  const out: BgLayer[] = [];
  const defs = [
    { f: 0.1, col: '#ffffff', alpha: 0.9 },
    { f: 0.25, col: '#c8d8f0', alpha: 1 },
  ];
  defs.forEach((d, li) => {
    const w = Math.ceil(viewW + (worldW - viewW) * d.f) + 4;
    const fy = d.f * 0.6;
    const h = Math.ceil(viewH + (worldH - viewH - camTop) * fy) + 4;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    if (li === 0) {
      // 아래쪽 두꺼운 구름 바다
      const hs = fbm(rng, w, 4).map((v) => h * 0.7 - v * 80);
      for (let x = 0; x < w; x++) {
        for (let y = Math.round(hs[x]); y < h; y++) {
          const k = Math.min(1, (y - hs[x]) / 30);
          ctx.fillStyle = k < 0.15 ? '#ffffff' : k < 0.6 ? '#eef6ff' : '#dbe9fb';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    } else {
      // 떠 있는 섬 실루엣 + 약국 건물
      for (let i = 0; i < w / 220; i++) {
        const cx = rng.range(40, w - 40),
          cy = rng.range(h * 0.25, h * 0.6),
          hw = rng.range(26, 60);
        for (let x = Math.floor(cx - hw); x <= cx + hw; x++) {
          const u = (x - cx) / hw;
          const e = 1 - u * u;
          ctx.fillStyle = '#9fb8dc';
          ctx.fillRect(x, Math.round(cy), 1, Math.round(4 + e * hw * 0.9));
          ctx.fillStyle = '#b6e09a';
          ctx.fillRect(x, Math.round(cy) - 1, 1, 3);
        }
        if (rng.next() < 0.5) {
          ctx.fillStyle = '#e8f0ff';
          ctx.fillRect(cx - 12, cy - 18, 24, 18);
          ctx.fillStyle = '#4cd28a';
          ctx.fillRect(cx - 2, cy - 30, 4, 10);
          ctx.fillRect(cx - 5, cy - 27, 10, 4);
        }
      }
    }
    out.push({ canvas: c, factor: d.f, y: camTop * fy });
  });
  return out;
}

/** 빙결 설산: 이미지 배경 앞의 눈 덮인 침엽수 실루엣 */
export function buildPineLayer(viewW: number, viewH: number, worldW: number, worldH: number, camTop: number, seed: number): BgLayer {
  const rng = new Rng(seed);
  const f = 0.32;
  const w = Math.ceil(viewW + (worldW - viewW) * f) + 4;
  const fy = f * 0.6;
  const h = Math.ceil(viewH + (worldH - viewH - camTop) * fy) + 4;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const hs = fbm(rng, w, 3).map((v) => h * 0.74 - v * 70);
  silhouette(ctx, hs, '#9fb6d8', h);
  for (let i = 0; i < w / 18; i++) {
    const x = Math.floor(rng.range(0, w));
    const th = rng.range(24, 58);
    const gy = hs[x] + 4;
    for (let y = 0; y < th; y++) {
      const hw = Math.round((1 - y / th) * th * 0.3) + 1;
      ctx.fillStyle = y % 7 < 2 ? '#f2f8ff' : '#6f88ad';
      ctx.fillRect(x - hw, Math.round(gy - y), hw * 2, 1);
    }
  }
  return { canvas: c, factor: f, y: camTop * fy };
}
