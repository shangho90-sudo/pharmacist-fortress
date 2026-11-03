// 약초의 숲 다층 패럴랙스 배경 (절차적 픽셀아트)
import { Rng } from '../core/rng';
import { makeCanvas, shade } from './art';
import { makeCluster, makeMushroom, MUSH_RES, type MushKind, type MushSprite } from './mushrooms';

export interface BgLayer {
  canvas: HTMLCanvasElement;
  factor: number;
  y: number;
  /** 캔버스 텍셀/월드px 비율 (HD 레이어) */
  res?: number;
  /** 잘라낸 위쪽 여백 (월드 px) */
  oy?: number;
}

/** 투명 위/아래 행을 잘라 오버드로를 줄인다 (패럴랙스 위치는 oy로 보정) */
function cropRows(l: BgLayer): BgLayer {
  const c = l.canvas;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const rowHas = (y: number) => {
    for (let x = 0, i = y * c.width * 4 + 3; x < c.width; x++, i += 4) if (d[i]) return true;
    return false;
  };
  let y0 = 0,
    y1 = c.height - 1;
  while (y0 < y1 && !rowHas(y0)) y0++;
  while (y1 > y0 && !rowHas(y1)) y1--;
  const res = l.res ?? 1;
  y0 -= y0 % res;
  const out = makeCanvas(c.width, y1 - y0 + 1);
  out.getContext('2d')!.drawImage(c, 0, -y0);
  return { ...l, canvas: out, oy: (l.oy ?? 0) + y0 / res };
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
    // 별 대신 떠다니는 화산재 반점
    for (let i = 0; i < (w * h) / 900; i++) {
      ctx.fillStyle = `rgba(255,${120 + Math.floor(Math.random() * 80)},60,${0.15 + Math.random() * 0.35})`;
      ctx.fillRect(Math.random() * w, Math.random() * h * 0.7, 1, 1);
    }
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

/** 부드러운 뭉게 형태(원 여러 개의 그라디언트 합성) */
function puff(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, light: string, mid: string, dark: string, rng: Rng, n = 6) {
  for (let k = 0; k < n; k++) {
    const bx = x + rng.range(-r, r),
      by = y + rng.range(-r * 0.35, r * 0.2),
      br = r * rng.range(0.45, 0.8);
    const g = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.45, br * 0.1, bx, by, br);
    g.addColorStop(0, light);
    g.addColorStop(0.6, mid);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 능선 실루엣 + 위쪽 가장자리 림라이트 */
function ridge(ctx: CanvasRenderingContext2D, hs: number[], h: number, top: string, bottom: string, rim: string, rimW = 2) {
  const w = hs.length;
  const minY = Math.min(...hs);
  const g = ctx.createLinearGradient(0, minY, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x < w; x++) ctx.lineTo(x, hs[x]);
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = rimW;
  ctx.beginPath();
  for (let x = 0; x < w; x++) (x ? ctx.lineTo(x, hs[x] + 1) : ctx.moveTo(x, hs[x] + 1));
  ctx.stroke();
}

/** 화산 연구소: 화산재 구름 · 분화하는 원경 화산 · 용암 강 · 연구소 단지 */
export function buildVolcanoLayers(viewW: number, viewH: number, worldW: number, worldH: number, camTop: number, seed: number): BgLayer[] {
  const rng = new Rng(seed);
  const out: BgLayer[] = [];
  const size = (f: number) => ({ w: Math.ceil(viewW + (worldW - viewW) * f) + 4, h: Math.ceil(viewH + (worldH - viewH - camTop) * f * 0.6) + 4 });
  // 1) 원경: 화산재 구름 + 거대한 화산 (분화 빛)
  {
    const f = 0.08;
    const { w, h } = size(f);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < w / 90; i++) puff(ctx, rng.range(0, w), rng.range(h * 0.05, h * 0.35), rng.range(40, 80), 'rgba(120,60,70,0.55)', 'rgba(70,30,45,0.45)', 'rgba(40,16,28,0)', rng, 5);
    const peaks = Math.max(2, Math.round(w / 700));
    for (let p = 0; p < peaks; p++) {
      const cx = (p + 0.5) * (w / peaks) + rng.range(-80, 80);
      const base = h * 0.62,
        peakH = rng.range(h * 0.32, h * 0.42),
        hw = rng.range(260, 380);
      const hs: number[] = [];
      for (let x = 0; x < w; x++) {
        const d = Math.abs(x - cx) / hw;
        const cone = d < 1 ? (1 - d) * (1 - d * 0.35) : 0;
        const crater = Math.abs(x - cx) < 26 ? 10 * (1 - Math.abs(x - cx) / 26) : 0;
        hs.push(base - cone * peakH + crater + (d < 1 ? Math.sin(x / 9) * 2 : 0));
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - hw, 0, hw * 2, h);
      ctx.clip();
      ridge(ctx, hs, h, '#4a1e26', '#1c0a10', 'rgba(255,120,60,0.55)');
      // 분화구 빛 + 용암 줄기
      const top = base - peakH + 8;
      const glow = ctx.createRadialGradient(cx, top, 2, cx, top, 120);
      glow.addColorStop(0, 'rgba(255,220,120,0.95)');
      glow.addColorStop(0.25, 'rgba(255,120,40,0.55)');
      glow.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - 130, top - 130, 260, 260);
      for (let k = 0; k < 3; k++) {
        let x = cx + rng.range(-8, 8),
          y = top + 4;
        ctx.strokeStyle = k ? 'rgba(255,110,30,0.85)' : 'rgba(255,200,90,0.95)';
        ctx.lineWidth = k ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const dir = rng.next() < 0.5 ? -1 : 1;
        for (let s2 = 0; s2 < 40; s2++) {
          x += dir * rng.range(1, 4);
          y += rng.range(3, 6);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      // 연기 기둥
      for (let k = 0; k < 7; k++) puff(ctx, cx + k * 10 + rng.range(-10, 10), base - peakH - 20 - k * 26, 26 + k * 5, 'rgba(110,70,75,0.6)', 'rgba(60,32,40,0.5)', 'rgba(30,14,20,0)', rng, 4);
    }
    out.push({ canvas: c, factor: f, y: camTop * f * 0.6 });
  }
  // 2) 중경: 험준한 능선 + 용암 폭포 + 연구소
  {
    const f = 0.25;
    const { w, h } = size(f);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    const hs = fbm(rng, w, 5).map((v, x) => h * 0.6 - v * 120 - Math.abs(Math.sin(x / 130)) * 40);
    ridge(ctx, hs, h, '#3a1418', '#14060a', 'rgba(255,140,70,0.45)', 2);
    // 바위 결 (사선 하이라이트)
    ctx.strokeStyle = 'rgba(120,50,50,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < w / 12; i++) {
      const x = rng.range(0, w);
      const y = hs[Math.floor(x)] + rng.range(6, 60);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(6, 16), y + rng.range(8, 20));
      ctx.stroke();
    }
    // 용암 폭포
    for (let i = 0; i < w / 500; i++) {
      const x = rng.range(40, w - 40);
      const y0 = hs[Math.floor(x)] + 4;
      const g = ctx.createLinearGradient(0, y0, 0, h);
      g.addColorStop(0, 'rgba(255,230,140,1)');
      g.addColorStop(0.3, 'rgba(255,130,40,0.95)');
      g.addColorStop(1, 'rgba(200,40,10,0.6)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 3, y0, 7, h - y0);
      const gl = ctx.createRadialGradient(x, y0 + 60, 2, x, y0 + 60, 70);
      gl.addColorStop(0, 'rgba(255,120,40,0.35)');
      gl.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(x - 70, y0 - 10, 140, 140);
    }
    // 연구소 (굴뚝·배관·창문 불빛·경고등)
    for (let i = 0; i < w / 420; i++) {
      const x = Math.floor(rng.range(30, w - 120));
      const bw = rng.int(50, 90),
        bh = rng.int(50, 110);
      const gy = Math.round(hs[Math.min(w - 1, x + (bw >> 1))]) + 10;
      const bg = ctx.createLinearGradient(x, 0, x + bw, 0);
      bg.addColorStop(0, '#2a2028');
      bg.addColorStop(0.5, '#3a2c36');
      bg.addColorStop(1, '#1a1218');
      ctx.fillStyle = bg;
      ctx.fillRect(x, gy - bh, bw, bh);
      ctx.fillStyle = '#4a3a44';
      ctx.fillRect(x, gy - bh, bw, 3);
      ctx.fillStyle = '#2a2028';
      ctx.fillRect(x + bw * 0.7, gy - bh - 34, 9, 34);
      puff(ctx, x + bw * 0.7 + 4, gy - bh - 46, 14, 'rgba(160,140,140,0.5)', 'rgba(90,70,75,0.4)', 'rgba(40,30,35,0)', rng, 3);
      for (let wy = gy - bh + 10; wy < gy - 8; wy += 11)
        for (let wx = x + 6; wx < x + bw - 6; wx += 10) {
          if (rng.next() < 0.6) {
            ctx.fillStyle = rng.next() < 0.2 ? '#7ad8ff' : '#ffc060';
            ctx.fillRect(wx, wy, 5, 5);
            ctx.fillStyle = 'rgba(255,200,120,0.18)';
            ctx.fillRect(wx - 2, wy - 2, 9, 9);
          }
        }
      ctx.fillStyle = '#ff4040';
      ctx.fillRect(x + bw * 0.7 + 3, gy - bh - 37, 3, 3);
      ctx.strokeStyle = '#5a4650';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + bw, gy - bh * 0.4);
      ctx.lineTo(x + bw + 40, gy - bh * 0.4);
      ctx.lineTo(x + bw + 40, gy);
      ctx.stroke();
    }
    out.push({ canvas: c, factor: f, y: camTop * f * 0.6 });
  }
  return out;
}

/** 하늘의 약국: 겹겹이 쌓인 뭉게구름 바다 · 폭포가 흐르는 원경 섬 · 약국 */
export function buildSkyLayers(viewW: number, viewH: number, worldW: number, worldH: number, camTop: number, seed: number): BgLayer[] {
  const rng = new Rng(seed);
  const out: BgLayer[] = [];
  const size = (f: number) => ({ w: Math.ceil(viewW + (worldW - viewW) * f) + 4, h: Math.ceil(viewH + (worldH - viewH - camTop) * f * 0.6) + 4 });
  // 1) 원경 구름 바다 (3단 뭉게)
  {
    const f = 0.08;
    const { w, h } = size(f);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    const rows: [number, string, string, string, number][] = [
      [0.5, 'rgba(255,255,255,0.95)', 'rgba(222,236,252,0.9)', 'rgba(190,212,240,0)', 46],
      [0.62, '#ffffff', '#e8f2fd', 'rgba(200,220,244,0)', 54],
      [0.74, '#ffffff', '#f0f6fe', 'rgba(214,230,248,0)', 62],
    ];
    for (const [yy, l, m, d, r] of rows) {
      for (let x = -40; x < w + 40; x += r * 0.9) puff(ctx, x, h * yy + rng.range(-10, 10), r, l, m, d, rng, 5);
      ctx.fillStyle = m;
      ctx.fillRect(0, h * yy + r * 0.4, w, h);
    }
    out.push({ canvas: c, factor: f, y: camTop * f * 0.6 });
  }
  // 2) 원경 공중섬 (폭포·약국 건물)
  {
    const f = 0.2;
    const { w, h } = size(f);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < w / 260; i++) {
      const cx = rng.range(60, w - 60),
        cy = rng.range(h * 0.22, h * 0.5),
        hw = rng.range(34, 70);
      // 섬 몸통 (아래로 뾰족, 그라디언트)
      const g = ctx.createLinearGradient(0, cy, 0, cy + hw * 1.1);
      g.addColorStop(0, '#b89a7a');
      g.addColorStop(0.5, '#8e7462');
      g.addColorStop(1, 'rgba(120,130,170,0.6)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy);
      ctx.quadraticCurveTo(cx - hw * 0.6, cy + hw * 0.6, cx, cy + hw * 1.1);
      ctx.quadraticCurveTo(cx + hw * 0.6, cy + hw * 0.6, cx + hw, cy);
      ctx.fill();
      // 잔디 윗면
      ctx.fillStyle = '#86d45a';
      ctx.beginPath();
      ctx.ellipse(cx, cy, hw, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c4f08a';
      ctx.beginPath();
      ctx.ellipse(cx - hw * 0.2, cy - 2, hw * 0.6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 나무
      for (let k = 0; k < 2; k++) puff(ctx, cx + rng.range(-hw * 0.6, hw * 0.6), cy - 10, 10, '#a8e46a', '#5aa84a', 'rgba(60,120,60,0)', rng, 3);
      // 폭포
      if (rng.next() < 0.6) {
        const fx = cx + rng.range(-hw * 0.4, hw * 0.4);
        const fg = ctx.createLinearGradient(0, cy, 0, cy + 140);
        fg.addColorStop(0, 'rgba(230,248,255,0.9)');
        fg.addColorStop(1, 'rgba(230,248,255,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(fx - 3, cy + 3, 6, 140);
      }
      // 약국 건물 (흰 벽 + 초록 십자)
      if (rng.next() < 0.55) {
        const bx = cx + rng.range(-hw * 0.4, hw * 0.1);
        ctx.fillStyle = '#f4f8ff';
        ctx.fillRect(bx, cy - 22, 26, 22);
        ctx.fillStyle = '#cfd8ea';
        ctx.fillRect(bx + 18, cy - 22, 8, 22);
        ctx.fillStyle = '#4a7ac8';
        ctx.beginPath();
        ctx.moveTo(bx - 3, cy - 22);
        ctx.lineTo(bx + 13, cy - 32);
        ctx.lineTo(bx + 29, cy - 22);
        ctx.fill();
        ctx.fillStyle = '#3ad06a';
        ctx.fillRect(bx + 10, cy - 18, 6, 2);
        ctx.fillRect(bx + 12, cy - 20, 2, 6);
      }
    }
    // 가까운 얇은 구름 띠
    for (let i = 0; i < w / 160; i++) puff(ctx, rng.range(0, w), rng.range(h * 0.55, h * 0.75), rng.range(24, 40), 'rgba(255,255,255,0.85)', 'rgba(240,247,255,0.7)', 'rgba(230,240,255,0)', rng, 4);
    out.push({ canvas: c, factor: f, y: camTop * f * 0.6 });
  }
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

/** 약초의 숲 중경: 입체감 있는 거대 버섯·덩굴·꽃덤불 (투명 배경, 패럴랙스용) */
export function buildMushroomLayer(viewW: number, viewH: number, worldW: number, worldH: number, camTop: number, seed: number, f = 0.3): BgLayer {
  const rng = new Rng(seed + 77);
  const w = Math.ceil(viewW + (worldW - viewW) * f) + 4;
  const fy = f * 0.6;
  const h = Math.ceil(viewH + (worldH - viewH - camTop) * fy) + 4;
  const c = makeCanvas(w * MUSH_RES, h * MUSH_RES);
  const ctx = c.getContext('2d')!;
  ctx.scale(MUSH_RES, MUSH_RES);
  const ground = h * 0.56;
  // 덤불 띠 (바닥 연결): 아래로 갈수록 짙은 숲 그늘
  const hs = fbm(rng, w, 4).map((v) => ground - v * 70);
  const shade = ctx.createLinearGradient(0, ground - 70, 0, h);
  shade.addColorStop(0, '#2c6a34');
  shade.addColorStop(0.35, '#1a4a2a');
  shade.addColorStop(1, '#0e2a1c');
  ctx.fillStyle = shade;
  for (let x = 0; x < w; x++) ctx.fillRect(x, Math.round(hs[x]) + 6, 1, h);
  // 잎 뭉치 3겹 (뒤 어둡게 → 앞 밝게)
  const rows: [number, number, string[]][] = [
    [-14, 14, ['#6aa84a', '#2f6a34', '#1a4a2a']],
    [0, 12, ['#8fd04a', '#3f8a3a', '#245a2e']],
    [12, 10, ['#b4ec5a', '#5aa83a', '#2f6a34']],
  ];
  const frontRow = rows.pop()!;
  for (const row of rows) drawLeafRow(ctx, w, hs, rng, row);
  // 거대 버섯 (HD 스프라이트, 왼쪽 위 광원) — 뒤쪽 잎 뭉치와 앞쪽 잎 뭉치 사이에 배치
  const later = placeMushrooms(ctx, w, hs, rng, seed, 'mid');
  drawLeafRow(ctx, w, hs, rng, frontRow);
  for (const f2 of later) f2(); // 작은 군집은 앞 잎 뭉치 위에 (깊이감)
  // 꽃 핀 덩굴 (위로 감겨 올라감)
  for (let i = 0; i < w / 220; i++) {
    let x = rng.range(0, w);
    const base = hs[Math.floor(x)] + 8;
    const len = rng.range(120, 230);
    ctx.strokeStyle = '#3f7a2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, base);
    for (let y = 0; y < len; y += 4) {
      x += Math.sin(y / 18 + i) * 1.4;
      ctx.lineTo(x, base - y);
      if (y % 24 === 0 && y > 10) {
        const dir = (y / 24) % 2 ? 1 : -1;
        ctx.fillStyle = '#7acc3a';
        ctx.beginPath();
        ctx.ellipse(x + dir * 7, base - y, 7, 3.2, dir * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.stroke();
    ctx.fillStyle = '#ffd0a8';
    ctx.beginPath();
    ctx.arc(x, base - len, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffeec8';
    ctx.beginPath();
    ctx.arc(x, base - len, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // 바닥 꽃
  const fl = ['#ff8ac0', '#ffd0e4', '#ffe066', '#c7a6ff', '#ffffff'];
  for (let i = 0; i < w / 10; i++) {
    const x = rng.range(0, w);
    const y = hs[Math.floor(x)] + rng.range(-4, 14);
    ctx.fillStyle = fl[rng.int(0, fl.length - 1)];
    ctx.fillRect(Math.round(x), Math.round(y), 3, 3);
    ctx.fillStyle = '#ffe9a0';
    ctx.fillRect(Math.round(x) + 1, Math.round(y) + 1, 1, 1);
  }
  return cropRows({ canvas: c, factor: f, y: camTop * fy, res: MUSH_RES });
}

function drawLeafRow(ctx: CanvasRenderingContext2D, w: number, hs: number[], rng: Rng, [dy, step, cols]: [number, number, string[]]) {
  for (let i = 0; i < w / step; i++) {
    const x = rng.range(0, w);
    const y = hs[Math.floor(x)] + dy + rng.range(-4, 6);
    const r = rng.range(9, 20);
    const gr = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, 1, x, y, r);
    gr.addColorStop(0, cols[0]);
    gr.addColorStop(0.55, cols[1]);
    gr.addColorStop(1, cols[2]);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 원경용: 채도↓, 숲 공기색으로 헤이즈 (픽셀 단위 처리, CSS 필터 미사용) */
function hazeSprite(sp: MushSprite, amount: number): MushSprite {
  const c = makeCanvas(sp.canvas.width, sp.canvas.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(sp.canvas, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const air = [70, 120, 110];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const g = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    for (let k = 0; k < 3; k++) {
      const v = d[i + k] + (g - d[i + k]) * 0.5; // 채도 50%
      d[i + k] = v + (air[k] - v) * amount;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, ox: sp.ox, oy: sp.oy };
}

const spriteCache = new Map<string, MushSprite[]>();
function mushPool(seed: number, tier: 'far' | 'mid'): { big: MushSprite[]; clusters: MushSprite[] } {
  const key = `${tier}:${seed}`;
  if (!spriteCache.has(key)) {
    const big: MushSprite[] = [];
    const kinds: MushKind[] = ['magic', 'forest'];
    const n = tier === 'mid' ? 4 : 3;
    for (const kind of kinds)
      for (let v = 0; v < n; v++) {
        const size = tier === 'mid' ? 22 + v * 7 : 11 + v * 3;
        let sp = makeMushroom(kind, size, seed * 13 + v * 101 + (kind === 'magic' ? 7 : 3) + (tier === 'far' ? 5000 : 0));
        if (tier === 'far') sp = hazeSprite(sp, 0.42);
        big.push(sp);
      }
    spriteCache.set(key, big);
    const clusters: MushSprite[] = [];
    for (let v = 0; v < 5; v++) {
      let sp = makeCluster(seed * 7 + v * 57 + (tier === 'far' ? 900 : 0), tier === 'mid' ? 8 + (v % 3) * 2 : 6);
      if (tier === 'far') sp = hazeSprite(sp, 0.42);
      clusters.push(sp);
    }
    spriteCache.set(key + ':c', clusters);
  }
  return { big: spriteCache.get(key)!, clusters: spriteCache.get(key + ':c')! };
}

/** 스프라이트를 밑동 기준으로 기울여 그림 (비율 유지, 월드 좌표) */
function stamp(ctx: CanvasRenderingContext2D, sp: MushSprite, x: number, groundY: number, tilt: number, flip: boolean) {
  const W = sp.canvas.width / MUSH_RES,
    H = sp.canvas.height / MUSH_RES;
  ctx.save();
  ctx.translate(x, groundY);
  ctx.rotate(tilt);
  if (flip) ctx.scale(-1, 1); // 좌우 반전만 (광원 방향 유지를 위해 큰 버섯에는 사용하지 않음)
  ctx.drawImage(sp.canvas, -sp.ox * W, -sp.oy * H, W, H);
  ctx.restore();
}

/** 버섯 배치: 간격·높이 불규칙, 큰 버섯 주변에 작은 군집 */
function placeMushrooms(ctx: CanvasRenderingContext2D, w: number, hs: number[], rng: Rng, seed: number, tier: 'far' | 'mid'): (() => void)[] {
  const later: (() => void)[] = [];
  const pool = mushPool(seed, tier);
  const gy = (x: number) => hs[Math.max(0, Math.min(w - 1, Math.floor(x)))];
  let x = rng.range(20, 120);
  let last = -1;
  while (x < w - 20) {
    let bi = rng.int(0, pool.big.length - 1);
    if (bi === last) bi = (bi + 1 + rng.int(0, pool.big.length - 2)) % pool.big.length; // 같은 형태 연속 방지
    last = bi;
    const sp = pool.big[bi];
    const ground = gy(x) + (tier === 'mid' ? rng.range(10, 18) : rng.range(6, 12));
    const tilt = rng.range(-0.13, 0.13);
    if (tier === 'mid') {
      // 접지 그림자 (오른쪽 아래로 드리움)
      const sw = sp.canvas.width / MUSH_RES / 2;
      const gr = ctx.createRadialGradient(x + sw * 0.25, ground, 1, x + sw * 0.25, ground, sw);
      gr.addColorStop(0, 'rgba(8,24,14,0.55)');
      gr.addColorStop(1, 'rgba(8,24,14,0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.ellipse(x + sw * 0.25, ground, sw, sw * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    stamp(ctx, sp, x, ground, tilt, false);
    // 주변 작은 군집 0~2개
    const nc = rng.int(0, 2);
    for (let k = 0; k < nc; k++) {
      const cx = x + (k % 2 ? 1 : -1) * rng.range(22, 46) * (tier === 'mid' ? 1 : 0.6);
      const cs = pool.clusters[rng.int(0, pool.clusters.length - 1)];
      const cy = gy(cx) + (tier === 'mid' ? rng.range(2, 8) : rng.range(8, 14));
      const ct = rng.range(-0.08, 0.08),
        cf = rng.next() < 0.5;
      const go = () => stamp(ctx, cs, cx, cy, ct, cf);
      if (tier === 'mid') later.push(go);
      else go();
    }
    x += tier === 'mid' ? rng.range(170, 430) : rng.range(90, 260);
  }
  return later;
}

/** 약초의 숲 원경 버섯: 작고 채도 낮은 실루엣층 */
export function buildFarMushroomLayer(viewW: number, viewH: number, worldW: number, worldH: number, camTop: number, seed: number, f = 0.2): BgLayer {
  const rng = new Rng(seed + 991);
  const w = Math.ceil(viewW + (worldW - viewW) * f) + 4;
  const fy = f * 0.6;
  const h = Math.ceil(viewH + (worldH - viewH - camTop) * fy) + 4;
  const c = makeCanvas(w * MUSH_RES, h * MUSH_RES);
  const ctx = c.getContext('2d')!;
  ctx.scale(MUSH_RES, MUSH_RES);
  const ground = h * 0.5;
  const hs = fbm(rng, w, 4).map((v) => ground - v * 50);
  placeMushrooms(ctx, w, hs, rng, seed, 'far');
  return cropRows({ canvas: c, factor: f, y: camTop * fy, res: MUSH_RES });
}
