const { chromium, devices } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ ...devices['iPhone 13 landscape'] }); const p = await ctx.newPage();
const errs=[]; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:4173/'); await p.waitForTimeout(2500);
await p.tap('text=AI 대전'); await p.waitForTimeout(300); await p.tap('text=전투 시작!');
for (let i = 0; i < 60; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) break; await p.waitForTimeout(500); }
// 터치 버튼 테스트: 오른쪽 이동, 각도 올리기, 발사
const x0 = await p.evaluate(() => window.__pf.scene.game2.currentPlayer.x);
const tapHold = async (sel, ms) => { const bb = await p.locator(sel).boundingBox(); const cx = bb.x + bb.width/2, cy = bb.y + bb.height/2;
  await p.evaluate(([cx,cy,ms]) => new Promise(res => { const el = document.elementFromPoint(cx,cy); const o={bubbles:true,pointerId:7,pointerType:'touch',clientX:cx,clientY:cy}; el.dispatchEvent(new PointerEvent('pointerdown',o)); setTimeout(()=>{el.dispatchEvent(new PointerEvent('pointerup',o)); res();}, ms); }), [cx,cy,ms]); };
await tapHold('[data-t=right]', 700);
const x1 = await p.evaluate(() => window.__pf.scene.game2.currentPlayer.x);
const a0 = await p.evaluate(() => window.__pf.scene.game2.currentPlayer.angle);
await tapHold('[data-t=up]', 400);
const a1 = await p.evaluate(() => window.__pf.scene.game2.currentPlayer.angle);
await p.screenshot({ path: '/tmp/m1.png' });
await tapHold('[data-t=fire]', 1400);
await p.waitForTimeout(200);
const ph = await p.evaluate(() => window.__pf.scene.game2.phase);
console.log('move', x0.toFixed(1), '->', x1.toFixed(1), 'angle', a0.toFixed(1), '->', a1.toFixed(1), 'phase after fire', ph, 'errs', errs.join(';'));
await b.close(); })();
