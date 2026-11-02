const { chromium } = require('playwright');
(async()=>{
const [,, url, out, w='1600', h='900'] = process.argv;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('console', m => console.log('console:', m.type(), m.text())); p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(url); await p.waitForTimeout(1500); await p.screenshot({ path: out }); await b.close(); })();
