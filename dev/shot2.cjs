const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1683, height: 935 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
const map = process.argv[2] || 'herb_forest', tag = process.argv[3] || map;
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2000);
await p.click('[data-a=start]'); await p.waitForTimeout(300); await p.click('[data-a=ai]'); await p.waitForTimeout(400);
await p.click('.npanel.p1'); await p.click('.ntile[data-id=paeng]'); await p.click('.ntile[data-id=jo]'); await p.click(`.nmap[data-map=${map}]`); await p.click('[data-a=start]');
for (let i = 0; i < 80; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(400); }
await p.waitForTimeout(700);
await p.screenshot({ path: `/tmp/ui/g_${tag}.png` });
if (process.argv[4] === 'fire') {
  await p.evaluate(() => { const s = window.__pf.scene, g = s.game2; g.setFacing(1); g.setAngle(12); g.fire('basic', 22); });
  await p.waitForTimeout(2600);
  await p.evaluate(() => { const g = window.__pf.scene.game2; window.__pf.scene.lookAt(g.players[0].x + 60, g.players[0].y + 10); });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `/tmp/ui/g_${tag}_hole.png` });
}
console.log('errs', errs.join(' | ')); await b.close(); })();
