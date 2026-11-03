const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1683, height: 935 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
const map = process.argv[2];
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2000);
await p.click('[data-a=start]'); await p.waitForTimeout(300); await p.click('[data-a=ai]'); await p.waitForTimeout(400);
await p.click('.npanel.p1'); await p.click('.ntile[data-id=yong]'); await p.click('.ntile[data-id=jo]'); await p.click(`.nmap[data-map=${map}]`); await p.click('[data-a=start]');
const myTurn = async () => { for (let i = 0; i < 120; i++) { const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; }); if (ok) return true; await p.waitForTimeout(400); } return false; };
await myTurn();
// AI 차례에 끼어들지 않도록 상대를 사람으로
await p.evaluate(() => { window.__pf.scene.game2.players[1].controller = 'human'; });
const look = async () => { await p.evaluate(() => { const s = window.__pf.scene, me = s.game2.players[0]; s.lookAt(me.x + 110 * me.facing, me.y + 20); }); await p.waitForTimeout(900); };
await p.evaluate(() => window.__pf.scene.game2.setFacing(1));
await look(); await p.screenshot({ path: `/tmp/ui/v_${map}_0.png` });
const ms = []; let k = 0;
for (const [kind, ang, pw] of [['basic', 15, 26], ['special', 25, 30], ['ultimate', 35, 34]]) {
  await myTurn();
  await p.evaluate(([kind, ang, pw]) => { const s = window.__pf.scene, g = s.game2; g.current = 0; g.setFacing(1); g.setAngle(ang); g.currentPlayer.gauge = 100; g.currentPlayer.specialCd = 0; g.fire(kind, pw); }, [kind, ang, pw]);
  for (let i = 0; i < 60; i++) { const ph = await p.evaluate(() => window.__pf.scene.game2.phase); if (ph !== 'flying') break; await p.waitForTimeout(150); }
  ms.push(await p.evaluate(() => window.__pf.scene.terrainView.lastRedrawMs));
  // 다음 턴을 다시 내 턴으로
  for (let i = 0; i < 60; i++) { const ph = await p.evaluate(() => window.__pf.scene.game2.phase); if (ph === 'aiming' || ph === 'over') break; await p.waitForTimeout(200); }
  await p.evaluate(() => { const g = window.__pf.scene.game2; if (g.current !== 0 && g.phase === 'aiming') { g.current = 0; } });
}
await look(); await p.screenshot({ path: `/tmp/ui/v_${map}_1.png` });
const fps = await p.evaluate(() => new Promise(res => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
const alive = await p.evaluate(() => { const g = window.__pf.scene.game2; return g.players.map(x => ({ hp: x.hp, grounded: x.grounded })); });
console.log(map, 'redrawMs', ms.map(x => x.toFixed(1)).join('/'), 'fps', fps, JSON.stringify(alive), 'errs', errs.join(' | '));
await b.close(); })();
