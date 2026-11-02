const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(3000);
await p.evaluate(() => document.querySelector('.screen')?.remove());
for (const id of (process.argv[2]||'ice_peaks,volcano_lab').split(',')) {
  await p.evaluate((id) => { const s = window.__pf.scene; s.startBattle({ seed: 77, mapId: id, demo: true, players: [
    { name: '팽약사', charType: 'paeng', team: 0, controller: 'ai', aiLevel: 'hard' }, { name: '조약사', charType: 'jo', team: 1, controller: 'ai', aiLevel: 'hard' }] }); s.paused = true; }, id);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `/tmp/m_${id}.png` });
  // 전체 지형 확인용 축소 화면
  await p.evaluate(() => { const c = window.__pf.scene.cameras.main; c.setZoom(0.75); c.centerOn(1280, 550); window.__pf.scene.applyCamera = () => {}; window.__pf.scene.updateCamera = () => {}; });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `/tmp/o_${id}.png` });
  await p.evaluate(() => { const s = window.__pf.scene; s.cameras.main.setZoom(2); delete s.applyCamera; delete s.updateCamera; });
}
console.log('errs', errs.join('\n')); await b.close(); })();
