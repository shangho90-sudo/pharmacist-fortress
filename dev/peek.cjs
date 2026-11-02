const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const urls=[]; p.on('response', r => urls.push(r.status()+' '+r.url()));
try { await p.goto(process.argv[2], { timeout: 30000 }); await p.waitForTimeout(6000); await p.screenshot({ path: '/tmp/peek.png' }); } catch(e) { console.log('ERR', e.message); }
console.log(urls.slice(0,60).join('\n')); await b.close(); })();
