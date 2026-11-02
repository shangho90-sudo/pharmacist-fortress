const { chromium, devices } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] });
for (const [name, opt] of [['pc', { viewport: { width: 1600, height: 900 } }], ['mobile', devices['iPhone 13 landscape']]]) {
const ctx = await b.newContext(opt); const p = await ctx.newPage();
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2500);
await p.click('text=AI 대전'); await p.waitForTimeout(300); await p.click('.mapb[data-v=moon_base]'); await p.waitForTimeout(300);
await p.screenshot({ path: `/tmp/sel_${name}.png` });
await p.click('text=전투 시작!'); await p.waitForTimeout(2500);
await p.screenshot({ path: `/tmp/start_${name}.png` });
const mid = await p.evaluate(() => window.__pf.scene.game2.mapId); console.log(name, mid);
await ctx.close(); }
await b.close(); })();
