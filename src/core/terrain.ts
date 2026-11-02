import { Rng } from './rng';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 파괴 가능한 지형. 1바이트 = 1픽셀 마스크(1: 땅, 0: 빈 공간).
 * 렌더링과 충돌 판정이 모두 이 마스크 하나만 참조하므로 둘이 어긋날 수 없다.
 * 맵 밖(좌우/아래/위)은 모두 빈 공간으로 취급한다(아래로 빠지면 추락).
 */
export class Terrain {
  readonly w: number;
  readonly h: number;
  readonly mask: Uint8Array;
  /** 마스크가 바뀔 때마다 증가 (동기화 검증용) */
  version = 0;

  constructor(w: number, h: number, mask?: Uint8Array) {
    this.w = w;
    this.h = h;
    this.mask = mask ?? new Uint8Array(w * h);
  }

  clone(): Terrain {
    const t = new Terrain(this.w, this.h, this.mask.slice());
    t.version = this.version;
    return t;
  }

  isSolid(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return false;
    return this.mask[iy * this.w + ix] === 1;
  }

  /** 정수 좌표 버전(경계 검사 포함) */
  solidAt(ix: number, iy: number): boolean {
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return false;
    return this.mask[iy * this.w + ix] === 1;
  }

  /**
   * 폭발 지점을 중심으로 자연스러운(약간 울퉁불퉁한) 원형 영역을 제거한다.
   * 각도 계산에 삼각함수 대신 '다이아몬드 각도'를 사용해 사칙연산만으로 계산 → 엔진 간 결과 동일.
   * 반환: 실제로 영향을 받은 영역(렌더러/충돌 갱신용). 변화가 없으면 null.
   */
  carve(cx: number, cy: number, r: number, seed: number): Rect | null {
    const BINS = 16;
    const rng = new Rng(seed);
    const radii: number[] = [];
    for (let i = 0; i < BINS; i++) radii.push(0.9 + rng.next() * 0.2);
    const R = r * 1.1 + 1;
    const x0 = Math.max(0, Math.floor(cx - R));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + R));
    if (x0 > x1 || y0 > y1) return null;
    let changed = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const R2 = R * R;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      const row = y * this.w;
      for (let x = x0; x <= x1; x++) {
        const idx = row + x;
        if (this.mask[idx] === 0) continue;
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        const f = (diamondAngle(dx, dy) / 4) * BINS;
        const i = Math.floor(f) % BINS;
        const t = f - Math.floor(f);
        const k = radii[i] * (1 - t) + radii[(i + 1) % BINS] * t;
        const rr = r * k;
        if (d2 <= rr * rr) {
          this.mask[idx] = 0;
          changed = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!changed) return null;
    this.version++;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /** (x0,y0)→(x1,y1) 선분 위에서 처음 만나는 땅 픽셀. 0.5px 간격으로 샘플링(연속 충돌 검사). */
  raycast(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; t: number } | null {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const n = Math.max(1, Math.ceil(len / 0.5));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      if (this.isSolid(x, y)) return { x, y, t };
    }
    return null;
  }

  /** x 열에서 fromY 아래로 처음 나오는 땅의 y (없으면 -1) */
  surfaceBelow(x: number, fromY: number): number {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.w) return -1;
    for (let y = Math.max(0, Math.floor(fromY)); y < this.h; y++) {
      if (this.mask[y * this.w + ix] === 1) return y;
    }
    return -1;
  }

  /** 마스크 체크섬(FNV-1a) — 클라이언트/서버 지형 일치 검증용 */
  checksum(): number {
    let h = 0x811c9dc5;
    const m = this.mask;
    for (let i = 0; i < m.length; i += 7) {
      h ^= m[i] + (i & 0xff);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
}

/** atan2 대신 사용하는 [0,4) 범위의 단조 각도 (사칙연산만 사용) */
export function diamondAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  if (dy >= 0) return dx >= 0 ? dy / (dx + dy) : 1 - dx / (-dx + dy);
  return dx < 0 ? 2 - dy / (-dx - dy) : 3 + dx / (dx - dy);
}
