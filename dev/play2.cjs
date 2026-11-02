const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(process.argv[2] || 'http://127.0.0.1:5173/');
  await p.waitForTimeout(2500);
  await p.click('text=AI 대전'); await p.waitForTimeout(300);
  await p.click('.tile[data-id=cheol]'); await p.click('.tile[data-id=du]');
  await p.click('text=어려움');
  await p.click('text=전투 시작!');
  let shot = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const st = await p.evaluate(() => { const s = window.__pf.scene, g = s.game2; return { local: s.isLocalTurn() && g.canControl, over: !!document.querySelector('.result'), phase: g.phase }; });
    if (st.over) break;
    if (st.local) {
      // 사람 입력을 흉내: AI 플래너로 각도/파워 계산 후 키보드로 실제 조작
      const plan = await p.evaluate(async () => { const m = await import('/src/core/ai.ts'); const g = window.__pf.scene.game2; return m.planShot(g, 1); });
      const g0 = await p.evaluate(() => { const c = window.__pf.scene.game2.currentPlayer; return { facing: c.facing, angle: c.angle, gauge: c.gauge }; });
      if (g0.facing !== plan.facing) { const k = plan.facing > 0 ? 'ArrowRight' : 'ArrowLeft'; await p.keyboard.down(k); await p.waitForTimeout(60); await p.keyboard.up(k); }
      await p.evaluate((a) => window.__pf.scene.game2.setAngle(a), plan.angle);
      if (g0.gauge >= 100) await p.keyboard.press('3'); else await p.keyboard.press('2');
      await p.keyboard.down('Space');
      await p.waitForTimeout(plan.power / 100 * 2000);
      await p.keyboard.up('Space');
      shot++;
      if (shot === 1) { await p.waitForTimeout(900); await p.screenshot({ path: '/tmp/p_flight.png' }); }
      if (shot === 2) { await p.waitForTimeout(2600); await p.screenshot({ path: '/tmp/p_after.png' }); }
    }
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(500);
  await p.screenshot({ path: '/tmp/p_result.png' });
  const st = await p.evaluate(() => { const g = window.__pf.scene.game2; return { phase: g.phase, hp: g.players.map(p => p.hp), round: g.round, winner: g.winnerTeam }; });
  console.log('shots', shot, JSON.stringify(st));
  console.log('ERRORS:', errs.join('\n'));
  await b.close();
})();
