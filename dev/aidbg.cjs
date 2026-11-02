const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', m => { if (m.text().startsWith('DBG')) console.log(m.text()); });
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(2500);
await p.evaluate(async () => {
  const m = await import('/src/core/ai.ts');
  const s = window.__pf.scene;
  const orig = s.hooks;
  // 타이틀 데모 게임(AI vs AI)에서 계획과 실제 결과 비교
  const g = s.game2;
  const of = g.fire.bind(g);
  g.fire = (w, pw) => { const c = g.currentPlayer; const pred = m.predictImpact(g, c, c.facing, c.angle, pw); console.log('DBG fire', c.id, 'angle', c.angle.toFixed(2), 'facing', c.facing, 'pw', pw.toFixed(2), 'wind', g.wind, 'pred', pred && pred.kind, pred && pred.x.toFixed(0), pred && pred.y.toFixed(0)); return of(w, pw); };
  const oe = g.explode.bind(g);
  g.explode = (x, y, w, o, d) => { console.log('DBG explode', x.toFixed(0), y.toFixed(0), 'direct', d, 'enemy at', g.players.map(p => p.x.toFixed(0)+','+p.y.toFixed(0)).join(' ')); return oe(x, y, w, o, d); };
});
await p.waitForTimeout(40000); await b.close(); })();
