const { chromium } = require('playwright');
(async()=>{
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:900}});const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5174/');await page.waitForFunction(()=>window.__pf);
await page.mouse.click(20, 20);
const ids=['paeng','gu','bang','cheol','dong','seok','du','jo','sagong','yong'];const reports=[];
for(const id of ids){
 await page.evaluate(id=>{
  const {scene,ui}=window.__pf;ui.setup.p1=id;ui.setup.p2=id;ui.setup.mode='local';ui.setup.map='herb_forest';ui.startMatch();
 },id);
 await page.waitForFunction(()=>window.__pf.scene.game2.canControl);
 await page.evaluate(()=>{const s=window.__pf.scene,g=s.game2;g.setFacing(1);g.setAngle(80);g.fire('basic',95);});
 await page.waitForFunction(()=>window.__pf.scene.projSprites.size>0);
 await page.waitForTimeout(60);
 reports.push(await page.evaluate(id=>{
 const s=window.__pf.scene;return {id,projectiles:s.projSprites.size,textures:[...s.projSprites.values()].map(v=>v.img.texture.key)};
 },id));
 if(id==='gu'||id==='jo'||id==='sagong')await page.screenshot({path:`docs/compare/projectile-${id}-battle.png`});
}
// Actual teleport projectile.
await page.evaluate(()=>{const {ui}=window.__pf;ui.setup.p1='paeng';ui.startMatch();});
await page.waitForFunction(()=>window.__pf.scene.game2.canControl);
await page.evaluate(()=>{const g=window.__pf.scene.game2;g.setFacing(1);g.setAngle(70);g.fire('move',85);});
await page.waitForTimeout(280);
reports.push(await page.evaluate(()=>({id:'move',textures:[...window.__pf.scene.projSprites.values()].map(v=>v.img.texture.key)})));
await page.screenshot({path:'docs/compare/projectile-rocket-battle.png'});
await page.waitForTimeout(3500);
// Trigger all ultimate visuals and then leave battle, exercising disposal.
for (const id of ids) {
 await page.evaluate(id=>{const {ui}=window.__pf;ui.setup.p1=id;ui.setup.p2=id;ui.startMatch();},id);
 await page.waitForFunction(()=>window.__pf.scene.game2.canControl);
 await page.evaluate(()=>{const g=window.__pf.scene.game2;g.currentPlayer.gauge=100;g.setFacing(1);g.setAngle(20);g.fire('ultimate',25);});
 await page.waitForTimeout(1800);
}
await page.evaluate(()=>window.__pf.ui.showTitle());await page.waitForTimeout(1200);
console.log(JSON.stringify({reports,errors},null,2));
if(errors.length||reports.some(r=>!r.textures.length))process.exitCode=1;
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

