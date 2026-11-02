const { chromium, devices } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ ...devices['iPhone 13 landscape'] }); const p = await ctx.newPage();
const errs=[]; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2500);
await p.tap('[data-a=start]'); await p.waitForTimeout(300); await p.tap('[data-a=ai]'); await p.waitForTimeout(400); await p.tap('.nmap[data-map=herb_forest]'); await p.tap('.nbtn.gold');
for (let i = 0; i < 60; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(500); }
const st = () => p.evaluate(() => { const c = window.__pf.scene.game2.currentPlayer; return [c.x.toFixed(1), c.angle.toFixed(1)]; });
const hold = async (sel, ms) => { const bb = await p.locator(sel).boundingBox(); const cx = bb.x + bb.width/2, cy = bb.y + bb.height/2;
  await p.evaluate(([cx,cy,ms]) => new Promise(res => { const el = document.elementFromPoint(cx,cy); const o={bubbles:true,pointerId:9,pointerType:'touch',clientX:cx,clientY:cy}; el.dispatchEvent(new PointerEvent('pointerdown',o)); setTimeout(()=>{el.dispatchEvent(new PointerEvent('pointerup',o)); res();}, ms); }), [cx,cy,ms]); };
const s0 = await st(); await hold('[data-t=right]', 600); const s1 = await st(); await hold('[data-t=up]', 400); const s2 = await st();
await p.screenshot({ path: '/tmp/mob.png' });
await hold('[data-t=fire]', 1200); await p.waitForTimeout(150);
const ph = await p.evaluate(() => window.__pf.scene.game2.phase);
console.log('move', s0[0], '->', s1[0], 'angle', s1[1], '->', s2[1], 'phase', ph, 'errs', errs.join(';'));
await b.close(); })();
