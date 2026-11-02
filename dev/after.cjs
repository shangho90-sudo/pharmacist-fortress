const { chromium, devices } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } }); const p = await ctx.newPage();
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2500);
await p.click('text=AI 대전'); await p.waitForTimeout(300);
await p.click('.tile[data-id=paeng]'); await p.click('.tile[data-id=jo]');
await p.click('.mapb[data-v=' + (process.argv[2]||'moon_base') + ']'); await p.click('text=전투 시작!');
for (let i = 0; i < 60; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(500); }
await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/after_' + (process.argv[2]||'moon_base') + '.png' });
console.log('errs', errs.join('\n')); await b.close(); })();
