const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1683, height: 935 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2000);
await p.click('[data-a=start]'); await p.waitForTimeout(300); await p.click('[data-a=ai]'); await p.waitForTimeout(400);
await p.click('.npanel.p1'); await p.click('.ntile[data-id=' + (process.argv[2]||'paeng') + ']'); await p.click('.ntile[data-id=jo]'); await p.click('.nmap[data-map=herb_forest]'); await p.click('[data-a=start]');
const myTurn = async () => { for (let i = 0; i < 100; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) return; await p.waitForTimeout(400); } };
await myTurn(); await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/ui/f_aim.png' });
// 걷기: 여러 프레임 캡처
await p.keyboard.down('ArrowRight');
for (let k = 0; k < 6; k++) { await p.waitForTimeout(110); const box = await p.evaluate(() => { const s = window.__pf.scene, c = s.game2.currentPlayer, cam = s.cameras.main; return { x: (c.x - cam.worldView.x) * cam.zoom, y: (c.y - cam.worldView.y) * cam.zoom, z: cam.zoom }; });
  const sc = 1683 / (960 * box.z); await p.screenshot({ path: `/tmp/ui/f_walk${k}.png`, clip: { x: Math.max(0, box.x * sc - 90), y: Math.max(0, box.y * sc - 190), width: 180, height: 200 } }); }
await p.keyboard.up('ArrowRight');
await p.waitForTimeout(300);
// 기본탄 비행
await p.evaluate(() => { const g = window.__pf.scene.game2; g.setAngle(55); g.fire('basic', 60); });
await p.waitForTimeout(700); await p.screenshot({ path: '/tmp/ui/f_fly.png' });
await myTurn(); await p.waitForTimeout(300);
const before = await p.evaluate(() => window.__pf.scene.game2.currentPlayer.x);
await p.click('[data-w=move]');
await p.evaluate(() => { const s = window.__pf.scene, g = s.game2; g.setFacing(1); g.setAngle(50); s.charging = true; s.chargeStart = performance.now() - 0.5 * 2000; s.releaseCharge(); });
await p.waitForTimeout(500); await p.screenshot({ path: '/tmp/ui/f_moveshot.png' });
await p.waitForTimeout(3000);
const after = await p.evaluate(() => { const g = window.__pf.scene.game2; return { x: g.players[0].x, cd: g.players[0].moveShotCd }; });
await p.screenshot({ path: '/tmp/ui/f_moved.png' });
console.log('move shot x', before.toFixed(0), '->', after.x.toFixed(0), 'cd', after.cd, 'errs', errs.join(' | '));
await b.close(); })();
