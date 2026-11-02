const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage();
p.on('console', m => console.log(m.type(), m.text())); p.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack));
await p.goto(process.argv[2]||'http://127.0.0.1:5173/'); await p.waitForTimeout(4000); await b.close(); })();
