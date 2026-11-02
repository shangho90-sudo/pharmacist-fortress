import Phaser from 'phaser';
import type { WeaponId } from '../core/weapons';

const D_FX = 30;

interface Palette {
  flash: number;
  fire: number[];
  smoke: number[];
  ring: number;
}

function hexNum(h: string) {
  return parseInt(h.slice(1), 16);
}
function mixNum(a: number, b: number, t: number) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

const BASIC: Palette = { flash: 0xfff3c0, fire: [0xfff1a0, 0xffb347, 0xff6a2a, 0xe03a2a], smoke: [0x5a5058, 0x6e6470, 0x4a4048], ring: 0xfff6d0 };

/** 테마색으로 폭발 팔레트 생성 */
function paletteFor(weapon: WeaponId, color: string): Palette {
  if (weapon === 'basic') return BASIC;
  const c = hexNum(color);
  return {
    flash: mixNum(c, 0xffffff, 0.8),
    fire: [0xffffff, mixNum(c, 0xffffff, 0.6), mixNum(c, 0xffffff, 0.25), c, mixNum(c, 0x000000, 0.35)],
    smoke: [mixNum(c, 0x3a3440, 0.75), mixNum(c, 0x5a5060, 0.8), mixNum(c, 0x2a2430, 0.8)],
    ring: mixNum(c, 0xffffff, 0.65),
  };
}

/**
 * 폭발/발사/피격 이펙트. 모든 이펙트는 호출자가 넘긴 실제 충돌 좌표를 중심으로 생성된다.
 * 텍스처는 모두 투명 배경의 원형 그라디언트/픽셀이므로 사각형·검은 배경이 보이지 않는다.
 */
export class Effects {
  constructor(private scene: Phaser.Scene) {}

  private burst(x: number, y: number, tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, count: number, ttl: number) {
    const e = this.scene.add.particles(x, y, tex, { ...cfg, emitting: false });
    e.setDepth(cfg.blendMode === 'ADD' ? D_FX + 2 : D_FX);
    e.explode(count);
    this.scene.time.delayedCall(ttl, () => e.destroy());
    return e;
  }

  explosion(x: number, y: number, r: number, weapon: WeaponId, debrisColors: number[], color: string) {
    const pal = paletteFor(weapon, color);
    const s = r / 35;
    // 1. 섬광
    const flash = this.scene.add.image(x, y, 'fx_soft').setBlendMode(Phaser.BlendModes.ADD).setDepth(D_FX + 3).setTint(pal.flash);
    flash.setScale((r * 1.4) / 64);
    this.scene.tweens.add({ targets: flash, scale: (r * 3.4) / 64, alpha: 0, duration: 260, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
    const core = this.scene.add.image(x, y, 'fx_soft').setBlendMode(Phaser.BlendModes.ADD).setDepth(D_FX + 3).setTint(0xffffff);
    core.setScale((r * 0.9) / 64);
    this.scene.tweens.add({ targets: core, scale: (r * 0.2) / 64, alpha: 0, duration: 160, onComplete: () => core.destroy() });
    // 2. 충격파 링
    const ring = this.scene.add.graphics().setDepth(D_FX + 1);
    const st = { t: 0 };
    this.scene.tweens.add({
      targets: st,
      t: 1,
      duration: 340,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(Math.max(0.5, 4 * (1 - st.t)) * Math.max(1, s * 0.8), pal.ring, 0.9 * (1 - st.t));
        ring.strokeCircle(x, y, r * (0.4 + 1.5 * st.t));
      },
      onComplete: () => ring.destroy(),
    });
    // 3. 화염
    this.burst(
      x,
      y,
      'fx_soft',
      {
        speed: { min: 20 * s, max: 150 * s },
        lifespan: { min: 280, max: 620 },
        scale: { start: (r / 64) * 0.95, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: pal.fire,
        blendMode: 'ADD',
        gravityY: -60,
      },
      Math.round(18 + 10 * s),
      900,
    );
    // 4. 연기
    this.scene.time.delayedCall(80, () =>
      this.burst(
        x,
        y - 4,
        'fx_smoke',
        {
          speed: { min: 10 * s, max: 60 * s },
          lifespan: { min: 900, max: 1700 },
          scale: { start: (r / 64) * 0.7, end: (r / 64) * 1.6 },
          alpha: { start: 0.55, end: 0 },
          tint: pal.smoke,
          gravityY: -35,
          rotate: { min: 0, max: 360 },
        },
        Math.round(8 + 6 * s),
        2000,
      ),
    );
    // 5. 흙/돌 파편 (지형 색상)
    if (debrisColors.length) {
      this.burst(
        x,
        y,
        'fx_px',
        {
          speed: { min: 110, max: 320 * Math.min(1.6, s) },
          angle: { min: 200, max: 340 },
          lifespan: { min: 600, max: 1300 },
          scale: { min: 1, max: 2.5 },
          gravityY: 620,
          tint: debrisColors,
          rotate: { min: 0, max: 360 },
          alpha: { start: 1, end: 0.6 },
        },
        Math.round(16 + 14 * s),
        1500,
      );
    }
    // 6. 불꽃 스파크
    this.burst(
      x,
      y,
      'fx_px',
      {
        speed: { min: 180, max: 420 * Math.min(1.5, s) },
        lifespan: { min: 180, max: 420 },
        scale: { start: 1.5, end: 0 },
        tint: [0xffffff, 0xfff1a0, pal.fire[1]],
        blendMode: 'ADD',
        gravityY: 300,
      },
      Math.round(10 + 6 * s),
      600,
    );
  }

  muzzle(x: number, y: number, angleRad: number, special: boolean) {
    const f = this.scene.add.image(x, y, 'fx_soft').setBlendMode(Phaser.BlendModes.ADD).setDepth(D_FX + 3).setTint(special ? 0xe9d5ff : 0xfff3b0);
    f.setScale(special ? 0.55 : 0.38);
    this.scene.tweens.add({ targets: f, scale: 0.05, alpha: 0, duration: 140, onComplete: () => f.destroy() });
    const deg = Phaser.Math.RadToDeg(angleRad);
    this.burst(
      x,
      y,
      'fx_px',
      { speed: { min: 60, max: 200 }, angle: { min: deg - 25, max: deg + 25 }, lifespan: 220, scale: { start: 1.4, end: 0 }, tint: [0xffffff, 0xffe08a], blendMode: 'ADD' },
      8,
      400,
    );
    this.burst(
      x,
      y,
      'fx_smoke',
      { speed: { min: 10, max: 40 }, angle: { min: deg - 30, max: deg + 30 }, lifespan: 600, scale: { start: 0.15, end: 0.35 }, alpha: { start: 0.4, end: 0 }, tint: 0xd8d0d8 },
      4,
      800,
    );
  }

  damageText(x: number, y: number, amount: number, color = '#ffe14d', sign = '-') {
    const t = this.scene.add
      .text(x, y - 8, `${sign}${amount}`, { fontFamily: 'Galmuri11, "Noto Sans KR", sans-serif', fontSize: '12px', fontStyle: 'bold', color, stroke: '#2a0f1a', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(50)
      .setResolution(4);
    this.scene.tweens.add({ targets: t, y: y - 38, duration: 900, ease: 'Cubic.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 650, duration: 400, onComplete: () => t.destroy() });
    t.setScale(0.4);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  bigText(x: number, y: number, msg: string, color: string) {
    const t = this.scene.add
      .text(x, y, msg, { fontFamily: '"Noto Sans KR", sans-serif', fontSize: '18px', fontStyle: '900', color, stroke: '#1a0a14', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(51)
      .setResolution(4)
      .setScale(0.2);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 300, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, y: y - 26, alpha: 0, delay: 1100, duration: 500, onComplete: () => t.destroy() });
  }

  splash(x: number, y: number, lava: boolean) {
    this.burst(
      x,
      y,
      'fx_px',
      { speed: { min: 80, max: 260 }, angle: { min: 235, max: 305 }, lifespan: { min: 500, max: 1000 }, scale: { min: 1, max: 2.5 }, gravityY: 600, tint: lava ? [0xffe08a, 0xff7a1a, 0xff3a0a] : [0xffffff, 0xc8f0ff, 0x6cc4f0], blendMode: lava ? 'ADD' : 'NORMAL' },
      28,
      1200,
    );
    const ring = this.scene.add.graphics().setDepth(D_FX);
    const st = { t: 0 };
    this.scene.tweens.add({
      targets: st,
      t: 1,
      duration: 600,
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(2, lava ? 0xffc060 : 0xffffff, 0.8 * (1 - st.t));
        ring.strokeEllipse(x, y, 20 + 70 * st.t, 6 + 10 * st.t);
      },
      onComplete: () => ring.destroy(),
    });
  }

  /** 번개/레이저/하늘 공격: 하늘에서 지점으로 내리꽂힘 */
  strike(x: number, y: number, style: 'lightning' | 'beam' | 'sky', color: string) {
    const c = parseInt(color.slice(1), 16);
    const top = y - 520;
    const gfx = this.scene.add.graphics().setDepth(D_FX + 2).setBlendMode(Phaser.BlendModes.ADD);
    const st = { t: 0 };
    if (style === 'lightning') {
      // 지그재그 번개 (매 프레임 갈라짐이 바뀜)
      this.scene.tweens.add({
        targets: st,
        t: 1,
        duration: 320,
        onUpdate: () => {
          gfx.clear();
          for (const [wdt, col, al] of [[5, c, 0.5], [2, 0xffffff, 1]] as const) {
            gfx.lineStyle(wdt, col, al * (1 - st.t));
            gfx.beginPath();
            let px = x,
              py = top;
            gfx.moveTo(px, py);
            while (py < y) {
              py = Math.min(y, py + 24 + Math.random() * 18);
              px = x + (py < y ? (Math.random() - 0.5) * 34 : 0);
              gfx.lineTo(px, py);
            }
            gfx.strokePath();
          }
        },
        onComplete: () => gfx.destroy(),
      });
    } else {
      const wdt = style === 'beam' ? 30 : 12;
      this.scene.tweens.add({
        targets: st,
        t: 1,
        duration: style === 'beam' ? 650 : 380,
        onUpdate: () => {
          gfx.clear();
          const k = st.t < 0.2 ? st.t / 0.2 : 1 - (st.t - 0.2) / 0.8;
          gfx.fillStyle(c, 0.35 * k).fillRect(x - wdt, top, wdt * 2, y - top);
          gfx.fillStyle(0xffffff, 0.8 * k).fillRect(x - wdt * 0.3, top, wdt * 0.6, y - top);
          gfx.fillStyle(0xffffff, 0.9 * k).fillCircle(x, y, wdt * 0.9);
        },
        onComplete: () => gfx.destroy(),
      });
    }
    this.burst(x, y, 'fx_px', { speed: { min: 60, max: 220 }, lifespan: 380, scale: { start: 1.6, end: 0 }, tint: [0xffffff, c], blendMode: 'ADD' }, 14, 600);
  }

  /** 약물 드래곤: 지면을 따라 휩쓸며 이동하는 용 머리 + 불꽃 */
  dragonSweep(x0: number, dir: 1 | -1, step: number, count: number, intervalMs: number, color: string, surface: (x: number) => number) {
    const c = parseInt(color.slice(1), 16);
    const head = this.scene.add.image(x0, surface(x0) - 26, 'fx_dragon').setDepth(D_FX + 3).setScale(dir * 2, 2);
    const fire = this.scene.add.particles(0, 0, 'fx_soft', {
      lifespan: 700,
      speed: { min: 10, max: 60 },
      scale: { start: 0.38, end: 0 },
      alpha: { start: 0.8, end: 0 },
      tint: [0xffffff, 0xe0c2ff, c, 0x5b1fc0],
      blendMode: 'ADD',
      emitting: false,
    });
    fire.setDepth(D_FX + 2);
    const st = { t: 0 };
    const total = count * intervalMs;
    this.scene.tweens.add({
      targets: st,
      t: 1,
      duration: total,
      onUpdate: () => {
        const x = x0 + dir * step * count * st.t;
        const sy = surface(x);
        const y = (sy > 0 ? sy : head.y + 26) - 26 + Math.sin(st.t * 18) * 6;
        head.setPosition(x, y).setRotation(Math.sin(st.t * 18) * 0.15 * dir);
        fire.emitParticleAt(x - dir * 14, y + 4, 3);
      },
      onComplete: () => {
        this.scene.tweens.add({ targets: head, alpha: 0, y: head.y - 40, duration: 300, onComplete: () => head.destroy() });
        this.scene.time.delayedCall(800, () => fire.destroy());
      },
    });
  }

  shadowPuff(x: number, y: number) {
    this.burst(x, y, 'fx_smoke', { speed: { min: 20, max: 90 }, lifespan: 700, scale: { start: 0.3, end: 0.6 }, alpha: { start: 0.75, end: 0 }, tint: [0x1a0a2a, 0x3a1a5a, 0x7c3aed] }, 16, 900);
    this.burst(x, y, 'fx_px', { speed: { min: 60, max: 160 }, lifespan: 400, scale: { start: 1.4, end: 0 }, tint: [0xc084fc, 0xffffff], blendMode: 'ADD' }, 12, 600);
  }

  healAura(x: number, y: number) {
    this.burst(x, y - 20, 'fx_px', { speedY: { min: -90, max: -30 }, speedX: { min: -30, max: 30 }, lifespan: 900, scale: { start: 2.2, end: 0 }, tint: [0x7dffa0, 0xffffff], blendMode: 'ADD' }, 18, 1100);
    const ring = this.scene.add.image(x, y - 24, 'fx_soft').setTint(0x5cff7a).setBlendMode(Phaser.BlendModes.ADD).setDepth(D_FX).setScale(0.3).setAlpha(0.8);
    this.scene.tweens.add({ targets: ring, scale: 1.2, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
  }

  /** 특수탄/필살기 이름 외침 */
  skillCall(x: number, y: number, name: string, color: string, ult: boolean) {
    const t = this.scene.add
      .text(x, y, ult ? `필살! ${name}` : name, { fontFamily: '"Noto Sans KR", sans-serif', fontSize: ult ? '17px' : '12px', fontStyle: '900', color: '#ffffff', stroke: color, strokeThickness: ult ? 5 : 4 })
      .setOrigin(0.5)
      .setDepth(52)
      .setResolution(4)
      .setScale(0.3);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, y: y - 24, alpha: 0, delay: 1000, duration: 500, onComplete: () => t.destroy() });
    if (ult) {
      const cam = this.scene.cameras.main;
      cam.flash(180, 255, 255, 255, false);
    }
  }

  dust(x: number, y: number) {
    this.burst(x, y, 'fx_smoke', { speed: { min: 10, max: 40 }, angle: { min: 180, max: 360 }, lifespan: 500, scale: { start: 0.12, end: 0.3 }, alpha: { start: 0.5, end: 0 }, tint: 0xc8b8a0 }, 6, 700);
  }
}
