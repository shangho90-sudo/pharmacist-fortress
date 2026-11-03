const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 700 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(1500);
await p.evaluate(async () => {
  const m = await import('/src/game/mushrooms.ts');
  const c = document.createElement('canvas'); c.width = 1400; c.height = 700; c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#3a7a8a';
  document.body.appendChild(c); const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle='#4a8aa0'; ctx.fillRect(0,0,1400,700);
  let x = 20; const row = (sps, y, sc) => { x = 20; for (const sp of sps) { ctx.drawImage(sp.canvas, x, y - sp.oy*sp.canvas.height*sc, sp.canvas.width*sc, sp.canvas.height*sc); x += sp.canvas.width*sc + 10; } };
  row([0,1,2,3].map(v => m.makeMushroom('magic', 20 + v*6, 7+v*101)), 330, 1);
  row([0,1,2,3].map(v => m.makeMushroom('forest', 20 + v*6, 3+v*101)), 660, 1);
  x=0;
});
await p.screenshot({ path: '/tmp/ui/sheet.png' }); await b.close(); })();
