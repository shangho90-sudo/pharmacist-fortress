const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(process.argv[2] || 'http://127.0.0.1:5173/');
  await p.waitForTimeout(3000);
  await p.screenshot({ path: '/tmp/s1_title.png' });
  await p.click('text=AI 대전');
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/tmp/s2_select.png' });
  await p.click('text=전투 시작!');
  // 내 턴 될 때까지 대기
  for (let i = 0; i < 60; i++) {
    const ok = await p.evaluate(() => { const s = window.__pf.scene; return s.isLocalTurn() && s.game2.canControl; });
    if (ok) break; await p.waitForTimeout(500);
  }
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/tmp/s3_myturn.png' });
  // 이동 + 각도
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(600); await p.keyboard.up('ArrowRight');
  await p.keyboard.down('ArrowUp'); await p.waitForTimeout(300); await p.keyboard.up('ArrowUp');
  await p.keyboard.down('Space'); await p.waitForTimeout(1300); await p.keyboard.up('Space');
  await p.waitForTimeout(700);
  await p.screenshot({ path: '/tmp/s4_flight.png' });
  for (let i = 0; i < 40; i++) { const ph = await p.evaluate(() => window.__pf.scene.game2.phase); if (ph !== 'flying') break; await p.waitForTimeout(100); }
  await p.waitForTimeout(150);
  await p.screenshot({ path: '/tmp/s5_explode.png' });
  const st = await p.evaluate(() => { const g = window.__pf.scene.game2; return { phase: g.phase, hp: g.players.map(p => p.hp), cur: g.current, tick: g.tick }; });
  console.log(JSON.stringify(st));
  console.log('ERRORS:', errs.slice(0, 20).join('\n'));
  await b.close();
})();
