const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2500);
await p.click('text=AI 대전'); await p.waitForTimeout(300);
const [me, foe, kind, map, shotAt] = process.argv.slice(2);
await p.click(`.tile[data-id=${me}]`); await p.click(`.tile[data-id=${foe}]`); await p.click(`.mapb[data-v=${map||'herb_forest'}]`);
await p.waitForTimeout(200); if (kind === 'select') { await p.screenshot({ path: `/tmp/sk_select.png` }); await b.close(); return; }
await p.click('text=전투 시작!');
for (let i = 0; i < 80; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(400); }
await p.waitForTimeout(400);
await p.screenshot({ path: `/tmp/sk_${me}_aim.png` });
const plan = await p.evaluate(async () => { const m = await import('/src/core/ai.ts'); const g = window.__pf.scene.game2; g.currentPlayer.gauge = 100; g.currentPlayer.aiLevel = 'hard'; return m.planShot(g, 3); });
await p.evaluate(([pl, kind]) => { const s = window.__pf.scene, g = s.game2; g.setFacing(pl.facing); g.setAngle(pl.angle); s.selected = kind; }, [plan, kind]);
await p.evaluate(([pl]) => { const s = window.__pf.scene; s.charging = true; s.charge = pl.power; s.chargeStart = performance.now() - pl.power / 100 * 2000; s.releaseCharge(); }, [plan]);
const t = Number(shotAt || 1500);
await p.waitForTimeout(t); await p.screenshot({ path: `/tmp/sk_${me}_${kind}_1.png` });
await p.waitForTimeout(900); await p.screenshot({ path: `/tmp/sk_${me}_${kind}_2.png` });
console.log(me, kind, JSON.stringify(plan), 'errs', errs.join(' | '));
await b.close(); })();
