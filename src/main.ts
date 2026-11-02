import Phaser from 'phaser';
import { BattleScene, VIEW_H, VIEW_W, ZOOM } from './game/BattleScene';
import { UI } from './ui/ui';

const scene = new BattleScene();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW_W * ZOOM,
  height: VIEW_H * ZOOM,
  backgroundColor: '#2a6f8c',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 3 },
  audio: { noAudio: true },
  banner: false,
  scene: [scene],
});

scene.onReady = () => {
  const ui = new UI(scene);
  ui.showTitle();
  (window as any).__pf = { game, scene, ui };
};
