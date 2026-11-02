const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2500);
await p.click('text=AI 대전'); await p.waitForTimeout(300); await p.click('.tile[data-id=paeng]'); await p.click('.tile[data-id=jo]');
await p.click('.mapb[data-v=moon_base]'); await p.click('text=전투 시작!');
for (let i = 0; i < 60; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(500); }
// 실제 발사로 근처 지형에 크레이터 3개 만들기 (낮은 각도, 다양한 파워)
for (const [ang, pw] of [[10, 18], [20, 22], [5, 26]]) {
  for (let i = 0; i < 80; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(400); }
  await p.evaluate(([a, pw]) => { const s = window.__pf.scene, g = s.game2; g.setFacing(1); g.setAngle(a); g.fire('basic', pw); }, [ang, pw]);
  await p.waitForTimeout(2500);
}
await p.evaluate(() => { const s = window.__pf.scene; const pl = s.game2.players[0]; s.lookAt(pl.x + 80, pl.y + 20); });
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/crater.png' });
console.log(await p.evaluate(() => window.__pf.scene.game2.terrain.version));
await b.close(); })();
