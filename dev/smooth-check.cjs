// Temporary browser integration fixture; generated only inside ignored dist/.
const fs = require('node:fs');
const harness = `
<script>
(async () => {
  const out = document.createElement('output');
  out.id = 'smooth-check'; out.style.cssText='position:fixed;right:8px;top:8px;z-index:9999;background:#071b30;color:white;padding:8px;font:12px monospace';
  document.body.append(out);
  const wait = async (check) => { const end=Date.now()+25000; while(!check()) { if(Date.now()>end) throw Error('test wait timed out'); await new Promise(r=>setTimeout(r,20)); } };
  try {
    if(location.hostname!=='127.0.0.1') throw Error('local fixture only');
    await wait(()=>window.__pf);
    const {ui,scene,game}=window.__pf;
    ui.showOnline();
    const lobby=ui.online, client=lobby.client;
    await wait(()=>client.connected);
    client.send({type:'create',name:'성능 확인',title:'화면 재생 검증'});
    await wait(()=>lobby.room);
    client.send({type:'ready',ready:true});
    const guest=new WebSocket('ws://127.0.0.1:3001/ws');
    guest.onmessage=event=>{const m=JSON.parse(event.data);
      if(m.type==='hello') guest.send(JSON.stringify({type:'join',room:lobby.room.id,name:'다른 참가자'}));
      if(m.type==='room' && m.room.members.length===2 && !m.room.members[1].ready) guest.send(JSON.stringify({type:'ready',ready:true}));
    };
    await wait(()=>lobby.room.members.length===2 && lobby.room.members.every(p=>p.ready));
    client.send({type:'start'});
    await wait(()=>scene.game2?.canControl);
    await new Promise(resolve=>setTimeout(resolve,3500));
    const send=action=>(scene.game2.current===scene.cfg.online.player?client:guest).send(scene.game2.current===scene.cfg.online.player?{type:'command',turn:scene.game2.turnNumber,action}:JSON.stringify({type:'command',turn:scene.game2.turnNumber,action}));
    const deltas=[], times=[]; let lastTick=scene.game2.tick,lastTime=performance.now(),start=lastTime;
    // Use a held local movement input or the other guest's server command.
    if(scene.game2.current===scene.cfg.online.player) scene.setTouchMove(1); else send({kind:'input',move:1,aim:0});
    await new Promise(resolve=>{
      function sample(now){deltas.push(scene.game2.tick-lastTick);times.push(now-lastTime);lastTick=scene.game2.tick;lastTime=now;
        if(now-start<1400) requestAnimationFrame(sample);else resolve();
      }requestAnimationFrame(sample);
    });
    scene.setTouchMove(0); send({kind:'input',move:0,aim:0});
    send({kind:'fire',weapon:'basic',power:35});
    await wait(()=>scene.game2.terrain.version>0 || scene.game2.turnNumber>1);
    const result={visibility:document.visibilityState,fps:Math.round(game.loop.actualFps),renderZoom:scene.renderZoom,frames:deltas.length,updatedFrames:deltas.filter(n=>n>0).length,maxTickStep:Math.max(...deltas),pendingTicks:scene.playback.pendingTicks,terrain:scene.game2.terrain.version,rays:scene.bgImages.filter(b=>b.img.texture?.key==='bg_rays').length};
    out.textContent='검증 완료 '+JSON.stringify(result);out.dataset.complete='true';out.style.opacity='0';
  } catch(error) {out.textContent='검증 실패 '+error.message;out.dataset.complete='true';}
})();
</script>`;
fs.writeFileSync('dist/smooth-check.html',fs.readFileSync('dist/index.html','utf8').replace('</body>',harness+'</body>'));
