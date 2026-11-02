import Phaser from 'phaser';
import type { WeaponDef } from '../core/weapons';

export const PROJECTILE_ASSETS = ['paeng', 'gu', 'bang', 'cheol', 'dong', 'seok', 'du', 'jo', 'sagong', 'yong', 'rocket', 'dragon'] as const;

/** Visual dimensions only: collision, trajectory and damage stay in the simulation. */
export function projectileStyle(w: WeaponDef) {
  const character = w.id.split('_')[0];
  const asset = w.id === 'move_shot' ? 'rocket' : w.id === 'yong_ult' ? 'dragon' : character;
  const widths: Record<string, number> = { paeng: 54, gu: 42, bang: 66, cheol: 40, dong: 40, seok: 34, du: 62, jo: 52, sagong: 34, yong: 68, rocket: 64, dragon: 76 };
  const sigil = w.look === 'orb_cross' && character === 'seok';
  return {
    key: sigil ? 'projectile_heal' : `projectile_${asset}`,
    width: (sigil ? 40 : widths[asset] ?? 46) * (w.scale ?? 1),
    spinning: w.look === 'axe' || w.look === 'big_axe',
    electric: character === 'gu' || w.trail === 'electric',
    orb: ['orb', 'orb_cross', 'cross', 'dark_orb'].includes(w.look) && asset !== 'rocket' && asset !== 'dragon',
    rocket: asset === 'rocket',
  };
}

/** A bounded, distance-sampled ribbon plus a crisp painted projectile. */
export class ProjectileVisual {
  readonly img: Phaser.GameObjects.Image;
  private glow: Phaser.GameObjects.Image;
  private ribbon: Phaser.GameObjects.Graphics;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private points: { x: number; y: number; age: number }[] = [];
  private sparkClock = 0;
  private style: ReturnType<typeof projectileStyle>;
  private color: number;
  private disposed = false;

  constructor(private scene: Phaser.Scene, x: number, y: number, weapon: WeaponDef, color: string) {
    this.style = projectileStyle(weapon);
    this.color = Phaser.Display.Color.HexStringToColor(color).color;
    this.img = scene.add.image(x, y, this.style.key).setDepth(22);
    this.img.setScale(this.style.width / this.img.width);
    this.glow = scene.add.image(x, y, 'fx_soft').setDepth(20).setTint(this.color).setBlendMode(Phaser.BlendModes.ADD);
    this.glow.setDisplaySize(this.style.width * 1.6, this.style.width * 1.25).setAlpha(0.36);
    this.ribbon = scene.add.graphics().setDepth(19).setBlendMode(Phaser.BlendModes.ADD);
    this.sparks = scene.add.particles(0, 0, 'fx_dot', {
      emitting: false, maxParticles: 48, lifespan: { min: 160, max: 360 },
      speed: { min: 8, max: this.style.electric ? 65 : 30 },
      scale: { start: 0.65, end: 0 }, alpha: { start: 0.9, end: 0 },
      tint: [0xffffff, this.color], blendMode: 'ADD',
    }).setDepth(21);
  }

  update(x: number, y: number, vx: number, vy: number, facing: number, dt: number) {
    const angle = Math.atan2(vy, vx);
    this.img.setPosition(x, y);
    if (this.style.spinning) this.img.rotation += dt * 12 * facing;
    else this.img.setRotation(this.style.orb ? 0 : angle);
    this.glow.setPosition(x, y).setAlpha(0.28 + Math.sin(this.scene.time.now * 0.018) * 0.07);
    this.points.forEach(p => p.age += dt);
    this.points = this.points.filter(p => p.age < 0.22);
    const back = this.style.orb || this.style.spinning ? 0 : this.img.displayWidth * 0.28;
    const tx = x - Math.cos(angle) * back, ty = y - Math.sin(angle) * back;
    const last = this.points[this.points.length - 1];
    if (!last || Math.hypot(tx - last.x, ty - last.y) >= 5) this.points.push({ x: tx, y: ty, age: 0 });
    if (this.points.length > 18) this.points.shift();
    this.ribbon.clear();
    const points = [...this.points, { x: tx, y: ty, age: 0 }];
    const width = this.style.rocket ? 12 : this.style.orb ? 15 : 9;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], fade = Math.max(0, 1 - a.age / 0.22);
      for (const [size, color, opacity] of [[width, this.color, 0.16], [width * 0.4, this.color, 0.65], [1.5, 0xffffff, 0.9]]) {
        this.ribbon.lineStyle(Math.max(0.4, size * fade), color, opacity * fade);
        this.ribbon.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
    // Live electrical arcs, separate from the sprite so details remain visible.
    if (this.style.electric) {
      const r = this.img.displayWidth * 0.42, phase = this.scene.time.now * 0.025;
      this.ribbon.lineStyle(1.3, 0xbceeff, 0.85);
      this.ribbon.beginPath();
      for (let i = 0; i <= 16; i++) {
        const a = i / 16 * Math.PI * 2, rr = r * (1 + 0.16 * Math.sin(i * 7 + phase));
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (!i) this.ribbon.moveTo(px, py); else this.ribbon.lineTo(px, py);
      }
      this.ribbon.strokePath();
    }
    this.sparkClock += dt;
    if (this.sparkClock >= 1 / 35) {
      this.sparkClock %= 1 / 35;
      this.sparks.emitParticleAt(tx, ty, this.style.electric ? 2 : 1);
    }
  }

  destroy(immediate = false) {
    if (this.disposed) return;
    this.disposed = true;
    this.img.destroy(); this.glow.destroy();
    if (immediate) { this.ribbon.destroy(); this.sparks.destroy(); }
    else {
      const ribbon = this.ribbon, sparks = this.sparks;
      this.scene.tweens.add({ targets: ribbon, alpha: 0, duration: 180, onComplete: () => ribbon.destroy() });
      this.scene.time.delayedCall(400, () => sparks.destroy());
    }
  }
}
