const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto(process.argv[2] || 'http://127.0.0.1:5173/'); await p.waitForTimeout(3500);
await p.screenshot({ path: '/tmp/c_title.png' });
await p.click('text=AI 대전'); await p.waitForTimeout(400);
await p.click('.tile[data-id=sagong]'); await p.click('.tile[data-id=jo]'); await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/c_sel.png' });
await p.click('text=전투 시작!');
for (let i = 0; i < 60; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(500); }
// 게이지 채우고 필살기
await p.evaluate(() => { window.__pf.scene.game2.currentPlayer.gauge = 100; });
const plan = await p.evaluate(async () => { const m = await import('/src/core/ai.ts'); return m.planShot(window.__pf.scene.game2, 1); });
await p.evaluate((pl) => { const g = window.__pf.scene.game2; g.setFacing(pl.facing); g.setAngle(pl.angle); }, plan);
await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/c_aim.png' });
await p.keyboard.press('2');
await p.keyboard.down('Space'); await p.waitForTimeout(plan.power / 100 * 2000); await p.keyboard.up('Space');
await p.waitForTimeout(1200); await p.screenshot({ path: '/tmp/c_fly.png' });
for (let i = 0; i < 60; i++) { const ph = await p.evaluate(() => window.__pf.scene.game2.phase); if (ph !== 'flying') break; await p.waitForTimeout(100); }
await p.waitForTimeout(100); await p.screenshot({ path: '/tmp/c_boom.png' });
console.log(JSON.stringify(await p.evaluate(() => window.__pf.scene.game2.players.map(p => p.hp))), errs.join('\n'));
await b.close(); })();
