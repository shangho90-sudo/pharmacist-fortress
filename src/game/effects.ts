import Phaser from 'phaser';
import type { WeaponId } from '../core/weapons';

const D_FX = 30;

interface Palette {
  flash: number;
  fire: number[];
  smoke: number[];
  ring: number;
}

const PALETTES: Record<string, Palette> = {
  basic: { flash: 0xfff3c0, fire: [0xfff1a0, 0xffb347, 0xff6a2a, 0xe03a2a], smoke: [0x5a5058, 0x6e6470, 0x4a4048], ring: 0xfff6d0 },
  mega_capsule: { flash: 0xffe0e0, fire: [0xffffff, 0xffd0d0, 0xff5a5a, 0xe3262f, 0x9e1018], smoke: [0x5a4448, 0x6e5458, 0x3e2e32], ring: 0xffb0b0 },
  dragon_capsule: { flash: 0xf3e6ff, fire: [0xffffff, 0xe9d5ff, 0xc084fc, 0x8b3dff, 0x5b1fc0], smoke: [0x4a3a66, 0x5c4a78, 0x3a2e52], ring: 0xd8b4fe },
  dragon_shard: { flash: 0xe9d5ff, fire: [0xf3e8ff, 0xb26bff, 0x7c3aed], smoke: [0x4a4058, 0x5a5068], ring: 0xd8b4fe },
};

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

  explosion(x: number, y: number, r: number, weapon: WeaponId, debrisColors: number[]) {
    const pal = PALETTES[weapon] ?? PALETTES.basic;
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

  damageText(x: number, y: number, amount: number, color = '#ffe14d') {
    const t = this.scene.add
      .text(x, y - 8, `-${amount}`, { fontFamily: 'Galmuri11, "Noto Sans KR", sans-serif', fontSize: '12px', fontStyle: 'bold', color, stroke: '#2a0f1a', strokeThickness: 3 })
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

  dust(x: number, y: number) {
    this.burst(x, y, 'fx_smoke', { speed: { min: 10, max: 40 }, angle: { min: 180, max: 360 }, lifespan: 500, scale: { start: 0.12, end: 0.3 }, alpha: { start: 0.5, end: 0 }, tint: 0xc8b8a0 }, 6, 700);
  }
}
