const fs = require('fs'), sharp = require('sharp');
(async()=>{
const { assets } = JSON.parse(fs.readFileSync('tools/projectile-generation.json','utf8'));
fs.mkdirSync('public/projectiles',{recursive:true}); fs.mkdirSync('docs/compare',{recursive:true});
const tiles=[];
for(let i=0;i<assets.length;i++) {
 const a=assets[i]; const meta=await sharp(a.source).metadata();
 console.log(a.id,meta.width,meta.height,'alpha',meta.hasAlpha);
 await sharp(a.source).trim({threshold:8}).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).extend({top:12,bottom:12,left:12,right:12,background:{r:0,g:0,b:0,alpha:0}}).png().toFile('public/projectiles/'+a.id+'.png');
 const thumb=await sharp('public/projectiles/'+a.id+'.png').resize(260,180,{fit:'contain',background:{r:8,g:16,b:32,alpha:1}}).png().toBuffer();
 tiles.push({input:thumb,left:(i%4)*280+10,top:Math.floor(i/4)*220+32});
 const label=Buffer.from('<svg width="260" height="28"><text x="8" y="20" font-size="18" fill="white">'+a.id+'</text></svg>');
 tiles.push({input:label,left:(i%4)*280+10,top:Math.floor(i/4)*220});
}
await sharp({create:{width:1120,height:660,channels:4,background:'#081020'}}).composite(tiles).png().toFile('docs/compare/projectile-atlas.png');
})();
