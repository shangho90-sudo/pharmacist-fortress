const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1683, height: 935 } });
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2000);
await p.click('[data-a=start]'); await p.waitForTimeout(300); await p.click('[data-a=ai]'); await p.waitForTimeout(400);
await p.click('.ntile[data-id=paeng]'); await p.click('.ntile[data-id=jo]'); await p.click('.nmap[data-map=herb_forest]'); await p.click('[data-a=start]');
for (let i = 0; i < 100; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(400); }
for (const a of [20, 70]) { await p.evaluate((a) => window.__pf.scene.game2.setAngle(a), a); await p.waitForTimeout(500);
  const box = await p.evaluate(() => { const s = window.__pf.scene, c = s.game2.currentPlayer, cam = s.cameras.main; return { x: (c.x - cam.worldView.x) * cam.zoom, y: (c.y - cam.worldView.y) * cam.zoom, z: cam.zoom }; });
  const sc = 1683 / (960 * box.z); await p.screenshot({ path: `/tmp/ui/arrow${a}.png`, clip: { x: Math.max(0, box.x * sc - 160), y: Math.max(0, box.y * sc - 300), width: 480, height: 330 } }); }
await b.close(); })();
