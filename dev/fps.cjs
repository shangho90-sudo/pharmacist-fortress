const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(3000);
for (let i=0;i<3;i++){ const r = await p.evaluate(() => new Promise(res => { let n=0; const t=performance.now(); const f=()=>{n++; if(performance.now()-t<2000) requestAnimationFrame(f); else res({fps:n/2, tick: window.__pf.scene.game2.tick, phase: window.__pf.scene.game2.phase});}; requestAnimationFrame(f); })); console.log(JSON.stringify(r)); }
await b.close(); })();
