import { CHAR_LIST, CHAR_TYPES, type CharTypeId } from '../core/characters';
import { MAX_GAUGE, MOVE_PER_TURN, TICK_RATE, WIND_MAX } from '../core/constants';
import type { AiLevel, Game, GameEvent, PlayerSetup } from '../core/game';
import { MAP_INFO, MAP_LIST, type MapId } from '../core/mapgen';
import { audio } from '../game/audio';
import type { BattleScene } from '../game/BattleScene';

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

/** 캐릭터 일러스트 (public/chars) */
const portrait = (id: CharTypeId) => `chars/${id}.png`;

type Mode = 'ai' | 'local';

interface MatchSetup {
  mode: Mode;
  p1: CharTypeId;
  p2: CharTypeId;
  level: AiLevel;
  map: MapId | 'random';
}

const LEVEL_NAME: Record<AiLevel, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

/** DOM UI 전체(타이틀/선택/HUD/결과/설정). 게임 상태는 읽기만 하고 명령은 BattleScene API로 보낸다. */
export class UI {
  private root: HTMLElement;
  private screen: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private setup: MatchSetup = { mode: 'ai', p1: 'paeng', p2: 'jo', level: 'normal', map: 'herb_forest' };
  private stats: number[] = [];
  private raf = 0;
  private lastTurn = -1;

  constructor(private scene: BattleScene) {
    this.root = document.getElementById('ui')!;
    const resize = () => {
      const st = document.getElementById('stage')!;
      document.documentElement.style.setProperty('--u', `${st.clientWidth / 100}px`);
    };
    window.addEventListener('resize', resize);
    resize();
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('is-touch');
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.hud) this.toggleSettings(true);
    });
    // 첫 사용자 제스처에 오디오 잠금 해제
    const unlock = () => {
      audio.unlock();
      if (!this.hud) audio.playBgm('title');
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
  }

  private setScreen(el: HTMLElement | null) {
    this.screen?.remove();
    this.screen = el;
    if (el) this.root.appendChild(el);
  }

  // ───────────── 타이틀 (뒤에서 AI 데모 대전이 돌아간다) ─────────────
  showTitle() {
    this.removeHud();
    this.scene.startBattle({
      seed: (Math.random() * 1e9) | 0,
      demo: true,
      mapId: MAP_LIST[Math.floor(Math.random() * MAP_LIST.length)],
      players: (() => {
        const a = CHAR_LIST[Math.floor(Math.random() * CHAR_LIST.length)];
        let b = a;
        while (b === a) b = CHAR_LIST[Math.floor(Math.random() * CHAR_LIST.length)];
        return [
          { name: CHAR_TYPES[a].name, charType: a, team: 0, controller: 'ai' as const, aiLevel: 'normal' as const },
          { name: CHAR_TYPES[b].name, charType: b, team: 1, controller: 'ai' as const, aiLevel: 'normal' as const },
        ];
      })(),
    }, { onGameOver: () => this.screen?.dataset.kind === 'title' && this.showTitle() });
    audio.playBgm('title');
    const el = h(`
      <div class="screen" data-kind="title">
        <div class="logo">
          <div class="ko"><div class="pill"></div><span class="a">약사</span><span class="b">대전</span></div>
          <div class="en">PHARMACIST FORTRESS</div>
        </div>
        <div class="menu">
          <button class="btn primary" data-a="ai">🤖 AI 대전</button>
          <button class="btn" data-a="local">👥 2인 대전 (한 기기)</button>
          <button class="btn" disabled title="4단계에서 추가 예정">🌐 온라인 대전 (준비 중)</button>
          <div style="display:flex;gap:calc(var(--u)*0.8)">
            <button class="btn ghost" style="flex:1" data-a="help">조작법</button>
            <button class="btn ghost" style="flex:1" data-a="settings">설정</button>
          </div>
        </div>
        <div class="foot">약으로 더 건강한 세상 · v0.1 (1단계 핵심 전투)</div>
      </div>`);
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      audio.click();
      if (a === 'ai' || a === 'local') {
        this.setup.mode = a;
        this.selSlot = 'p1';
        this.showSelect();
      } else if (a === 'help') this.showHelp();
      else if (a === 'settings') this.toggleSettings(false);
    });
    this.setScreen(el);
  }

  // ───────────── 캐릭터/난이도 선택 ─────────────
  private selSlot: 'p1' | 'p2' = 'p1';

  private showSelect() {
    const s = this.setup;
    const slotName = (slot: 'p1' | 'p2') => (slot === 'p1' ? (s.mode === 'ai' ? '나' : '플레이어 1') : s.mode === 'ai' ? '상대 (AI)' : '플레이어 2');
    const slotHtml = (slot: 'p1' | 'p2') => {
      const d = CHAR_TYPES[s[slot]];
      return `<div class="slot ${this.selSlot === slot ? 'on' : ''} ${slot}" data-slot="${slot}" style="--glow:${d.palette.glow}">
        <div class="tag">${slotName(slot)}</div>
        <img src="${portrait(d.id)}" alt="${d.name}">
        <div class="nm">${d.name}<span>${d.roman}</span></div>
        <div class="ti">“${d.title}”</div>
        <div class="sp"><b>필살기</b> ${d.specialName}<br><small>${d.specialDesc}</small></div>
      </div>`;
    };
    const el = h(`
      <div class="screen dark sel">
        <div class="sel-title">${s.mode === 'ai' ? 'AI 대전' : '2인 대전'} — 캐릭터 선택</div>
        <div class="sel-main">
          ${slotHtml('p1')}
          <div class="grid-wrap">
            <div class="hint">${slotName(this.selSlot)}의 캐릭터를 고르세요</div>
            <div class="grid">${CHAR_LIST.map((id) => {
              const d = CHAR_TYPES[id];
              const on1 = s.p1 === id, on2 = s.p2 === id;
              return `<button class="tile ${on1 ? 'p1on' : ''} ${on2 ? 'p2on' : ''}" data-id="${id}" style="--glow:${d.palette.glow}">
                <img src="${portrait(id)}" alt=""><span>${d.name}</span>${on1 ? '<i class="b1">1P</i>' : ''}${on2 ? `<i class="b2">${s.mode === 'ai' ? 'AI' : '2P'}</i>` : ''}</button>`;
            }).join('')}</div>
            <div class="opts">
              ${s.mode === 'ai' ? `<div class="seg" data-g="level">${(['easy', 'normal', 'hard'] as AiLevel[]).map((l) => `<button data-v="${l}" class="${s.level === l ? 'on' : ''}">${LEVEL_NAME[l]}</button>`).join('')}</div>` : ''}
            </div>
            <div class="maps" data-g="map">${MAP_LIST.map((id) => {
              const m = MAP_INFO[id];
              return `<button data-v="${id}" class="mapb ${s.map === id ? 'on' : ''}" title="${m.description}"><b>${m.icon} ${m.name}</b><small>${m.tags.join(' · ')}</small></button>`;
            }).join('')}<button data-v="random" class="mapb ${s.map === 'random' ? 'on' : ''}"><b>🎲 랜덤 맵</b><small>무작위 전장</small></button></div>
            <div class="opts">
            </div>
          </div>
          ${slotHtml('p2')}
        </div>
        <div class="sel-actions">
          <button class="btn ghost" data-a="back">뒤로</button>
          <button class="btn ghost" data-a="random">🎲 랜덤</button>
          <button class="btn primary" data-a="start">전투 시작!</button>
        </div>
      </div>`);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const slot = t.closest('.slot') as HTMLElement | null;
      if (slot) {
        this.selSlot = slot.dataset.slot as 'p1' | 'p2';
        audio.click();
        return this.showSelect();
      }
      const tile = t.closest('.tile') as HTMLElement | null;
      if (tile) {
        s[this.selSlot] = tile.dataset.id as CharTypeId;
        if (this.selSlot === 'p1') this.selSlot = 'p2';
        audio.click();
        return this.showSelect();
      }
      const segBtn = t.closest('.seg button, .maps button') as HTMLElement | null;
      if (segBtn) {
        const g = (segBtn.parentElement as HTMLElement).dataset.g!;
        if (g === 'level') s.level = segBtn.dataset.v as AiLevel;
        if (g === 'map') s.map = segBtn.dataset.v as MapId | 'random';
        audio.click();
        return this.showSelect();
      }
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (a === 'random') {
        s.p1 = CHAR_LIST[Math.floor(Math.random() * CHAR_LIST.length)];
        do s.p2 = CHAR_LIST[Math.floor(Math.random() * CHAR_LIST.length)];
        while (s.p2 === s.p1);
        audio.click();
        return this.showSelect();
      }
      if (a === 'back') {
        audio.click();
        this.showTitle();
      }
      if (a === 'start') {
        audio.click();
        this.startMatch();
      }
    });
    this.setScreen(el);
  }

  private startMatch() {
    const s = this.setup;
    const n1 = CHAR_TYPES[s.p1].name,
      n2 = CHAR_TYPES[s.p2].name;
    const players: PlayerSetup[] =
      s.mode === 'ai'
        ? [
            { name: `나 · ${n1}`, charType: s.p1, team: 0, controller: 'human' },
            { name: `AI · ${n2}`, charType: s.p2, team: 1, controller: 'ai', aiLevel: s.level },
          ]
        : [
            { name: `P1 · ${n1}`, charType: s.p1, team: 0, controller: 'human' },
            { name: `P2 · ${n2}`, charType: s.p2, team: 1, controller: 'human' },
          ];
    this.setScreen(null);
    this.stats = players.map(() => 0);
    this.lastTurn = -1;
    this.buildHud();
    const mapId: MapId = s.map === 'random' ? MAP_LIST[Math.floor(Math.random() * MAP_LIST.length)] : s.map;
    this.scene.startBattle(
      { seed: (Math.random() * 1e9) | 0, players, mapId },
      { onEvent: (e, g) => this.onEvent(e, g), onGameOver: (g) => this.showResult(g) },
    );
    audio.playBgm('battle');
  }

  private onEvent(e: GameEvent, g: Game) {
    if (e.type === 'damage') {
      const att = g.players[e.from];
      if (att && att.team !== g.players[e.player].team) this.stats[e.from] += e.amount;
    }
    if (e.type === 'turnStart') {
      const p = g.players[e.player];
      const local = this.setup.mode === 'local' || p.controller === 'human';
      const sub = e.round === 1 && g.turnNumber === 1 ? `${g.map.icon} ${g.map.name}` : `ROUND ${e.round}`;
      this.showBanner(local && this.setup.mode === 'ai' ? '나의 턴!' : `${p.name.split(' · ').pop()}의 턴`, sub);
    }
  }

  private showBanner(text: string, sub: string) {
    const b = h(`<div class="banner"><small>${sub}</small>${text}</div>`);
    this.root.appendChild(b);
    setTimeout(() => b.remove(), 1500);
  }

  // ───────────── HUD ─────────────
  private buildHud() {
    this.removeHud();
    const el = h(`
      <div id="hud">
        <div class="hud-top">
          <div class="pcards"></div>
          <div class="turnbox"><div class="rd">ROUND 1</div><div class="who">-</div><div class="tm">30</div></div>
          <div class="rightbox">
            <div class="iconbtns">
              <button class="ibtn" data-a="full" title="전체화면">⛶</button>
              <button class="ibtn" data-a="settings" title="설정 (Esc)">⚙</button>
            </div>
            <div class="wind"><div class="lb">바람</div><div class="meter"></div></div>
          </div>
        </div>
        <div class="hud-bottom">
          <div class="blk move"><div class="lb">이동</div><div class="bar"><i class="fill"></i></div></div>
          <div class="blk angle"><div class="lb">각도</div><div class="v">45°</div></div>
          <div class="blk power"><div class="lb">파워 <span style="opacity:.7">(${document.body.classList.contains('is-touch') ? '발사 버튼' : '스페이스'} 누르고 떼기)</span></div>
            <div class="pgauge"><i class="fill"></i><i class="last"></i><span class="num">0</span></div></div>
          <div class="weapons">
            <button class="wbtn on" data-w="basic"><kbd>1</kbd><span class="ic">💊</span>기본탄</button>
            <button class="wbtn" data-w="special"><kbd>2</kbd><span class="ic">✨</span><span class="spn">필살기</span><i class="charge"></i></button>
            <button class="wbtn" data-a="skip"><span class="ic">⏭</span>넘기기</button>
          </div>
        </div>
        <div class="touch l"><button class="tbtn" data-t="left">◀</button><button class="tbtn" data-t="right">▶</button></div>
        <div class="touch r"><div class="tcol"><button class="tbtn" data-t="up">▲</button><button class="tbtn" data-t="down">▼</button></div><button class="tbtn fire" data-t="fire">발사</button></div>
      </div>`);
    // 바람 미터
    const meter = el.querySelector('.wind .meter')!;
    meter.innerHTML = `${'<i></i>'.repeat(WIND_MAX)}<b>0</b>${'<i></i>'.repeat(WIND_MAX)}`;
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const w = t.closest('[data-w]')?.getAttribute('data-w') as 'basic' | 'special' | undefined;
      if (w) this.scene.selectWeapon(w);
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (a === 'skip') this.scene.skipTurn();
      if (a === 'settings') this.toggleSettings(true);
      if (a === 'full') this.toggleFullscreen();
    });
    // 터치 버튼: 누르고 있는 동안 동작
    el.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => {
      const t = b.dataset.t!;
      const down = (ev: PointerEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          b.setPointerCapture?.(ev.pointerId);
        } catch {
          /* 포인터 캡처 불가 환경 */
        }
        b.classList.add('press');
        audio.unlock();
        if (t === 'left') this.scene.setTouchMove(-1);
        if (t === 'right') this.scene.setTouchMove(1);
        if (t === 'up') this.scene.setTouchAim(1);
        if (t === 'down') this.scene.setTouchAim(-1);
        if (t === 'fire') this.scene.startCharge();
      };
      const up = (ev: PointerEvent) => {
        ev.preventDefault();
        b.classList.remove('press');
        if (t === 'left' || t === 'right') this.scene.setTouchMove(0);
        if (t === 'up' || t === 'down') this.scene.setTouchAim(0);
        if (t === 'fire') this.scene.releaseCharge();
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    });
    this.root.appendChild(el);
    this.hud = el;
    const loop = () => {
      this.updateHud();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private removeHud() {
    cancelAnimationFrame(this.raf);
    this.hud?.remove();
    this.hud = null;
    this.modal?.remove();
    this.modal = null;
    this.scene.paused = false;
  }

  private updateHud() {
    const g = this.scene.game2;
    const el = this.hud;
    if (!g || !el) return;
    // 플레이어 카드
    const pc = el.querySelector('.pcards')!;
    if (pc.childElementCount !== g.players.length) {
      pc.innerHTML = g.players
        .map(
          (p) => `<div class="pcard"><div class="face" style="background-image:url(${portrait(p.charType)});--tc:${p.team === 0 ? '#7fd4ff' : '#ff9a9a'}"></div>
          <div class="info"><div class="nm"><span>${p.name}</span><small class="hpn">100</small></div>
          <div class="bar hp"><i class="ghost"></i><i class="fill"></i></div><div class="bar sp"><i class="fill"></i></div></div></div>`,
        )
        .join('');
    }
    g.players.forEach((p, i) => {
      const c = pc.children[i] as HTMLElement;
      c.classList.toggle('active', i === g.current && g.phase !== 'over');
      c.classList.toggle('dead', !p.alive);
      const hp = c.querySelector('.bar.hp') as HTMLElement;
      hp.classList.toggle('mid', p.hp <= 50 && p.hp > 25);
      hp.classList.toggle('low', p.hp <= 25);
      setW(hp.querySelector('.fill'), p.hp);
      setW(hp.querySelector('.ghost'), p.hp);
      (c.querySelector('.hpn') as HTMLElement).textContent = String(p.hp);
      const sp = c.querySelector('.bar.sp') as HTMLElement;
      sp.classList.toggle('full', p.gauge >= MAX_GAUGE);
      setW(sp.querySelector('.fill'), p.gauge);
    });
    // 턴 정보
    const cp = g.currentPlayer;
    el.querySelector('.turnbox .rd')!.textContent = `ROUND ${g.round}`;
    el.querySelector('.turnbox .who')!.textContent = g.phase === 'over' ? '경기 종료' : cp.name;
    const sec = Math.max(0, Math.ceil(g.turnTicksLeft / TICK_RATE));
    const tm = el.querySelector('.turnbox .tm') as HTMLElement;
    tm.textContent = g.phase === 'aiming' || g.phase === 'turnStart' ? String(sec) : '—';
    tm.classList.toggle('warn', g.phase === 'aiming' && sec <= 5);
    // 바람
    const meter = el.querySelector('.wind .meter')!;
    const cells = meter.querySelectorAll('i');
    cells.forEach((c, k) => {
      const on = g.wind < 0 ? k < WIND_MAX && k >= WIND_MAX + g.wind : k >= WIND_MAX && k < WIND_MAX + g.wind;
      c.classList.toggle('on', on);
    });
    meter.querySelector('b')!.textContent = g.wind === 0 ? '0' : `${g.wind < 0 ? '◀' : ''}${Math.abs(g.wind)}${g.wind > 0 ? '▶' : ''}`;
    // 하단 바
    const local = this.scene.isLocalTurn();
    const bottom = el.querySelector('.hud-bottom') as HTMLElement;
    bottom.classList.toggle('idle', !(local && g.canControl));
    setW(el.querySelector('.move .fill'), (cp.moveLeft / MOVE_PER_TURN) * 100);
    el.querySelector('.angle .v')!.textContent = `${Math.round(cp.angle)}°`;
    const pw = this.scene.charge;
    setW(el.querySelector('.pgauge .fill'), pw);
    el.querySelector('.pgauge .num')!.textContent = String(Math.round(pw));
    const last = el.querySelector('.pgauge .last') as HTMLElement;
    if (cp.lastPower !== null) {
      last.style.display = 'block';
      last.style.left = `calc(${cp.lastPower}% - 1px)`;
    } else last.style.display = 'none';
    const wb = el.querySelector('[data-w="basic"]') as HTMLElement;
    const ws = el.querySelector('[data-w="special"]') as HTMLElement;
    wb.classList.toggle('on', this.scene.selected === 'basic');
    ws.classList.toggle('on', this.scene.selected === 'special');
    ws.classList.toggle('locked', cp.gauge < MAX_GAUGE);
    ws.classList.toggle('ready', cp.gauge >= MAX_GAUGE && this.scene.selected !== 'special' && local);
    setW(ws.querySelector('.charge'), cp.gauge);
    ws.querySelector('.spn')!.textContent = CHAR_TYPES[cp.charType].specialName.length > 6 ? '필살기' : CHAR_TYPES[cp.charType].specialName;
    ws.title = `${CHAR_TYPES[cp.charType].specialName} (게이지 ${cp.gauge}/100)`;
    if (g.current !== this.lastTurn) this.lastTurn = g.current;
  }

  // ───────────── 결과 ─────────────
  private showResult(g: Game) {
    const s = this.setup;
    const winner = g.players.find((p) => p.team === g.winnerTeam);
    let title = '무승부',
      cls = 'lose';
    if (winner) {
      if (s.mode === 'ai') {
        const won = winner.controller === 'human';
        title = won ? '승리!' : '패배...';
        cls = won ? 'win' : 'lose';
      } else {
        title = `${winner.name.split(' · ')[0]} 승리!`;
        cls = 'win';
      }
    }
    const hero = winner ? winner.charType : s.p1;
    const el = h(`
      <div class="screen dark result">
        <div class="big ${cls}">${title}</div>
        <img class="hero" src="${portrait(hero)}" alt="">
        <div class="stats">
          ${g.players.map((p, i) => `<div class="stat">${p.name}<b>${this.stats[i]}</b>입힌 피해</div>`).join('')}
          <div class="stat">진행<b>${g.round}</b>라운드</div>
        </div>
        <div class="sel-actions">
          <button class="btn ghost" data-a="menu">메인으로</button>
          <button class="btn" data-a="select">캐릭터 다시 선택</button>
          <button class="btn primary" data-a="again">재대결</button>
        </div>
      </div>`);
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      audio.click();
      if (a === 'again') this.startMatch();
      if (a === 'select') {
        this.removeHud();
        this.showSelect();
      }
      if (a === 'menu') this.showTitle();
    });
    this.removeHud();
    this.setScreen(el);
  }

  // ───────────── 모달 ─────────────
  private toggleSettings(inGame: boolean) {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
      this.scene.paused = false;
      return;
    }
    if (inGame && this.setup.mode === 'ai') this.scene.paused = true;
    const el = h(`
      <div class="modal"><div class="box">
        <h2>${inGame ? '일시정지 · 설정' : '설정'}</h2>
        <div class="row"><label>배경음악</label><input type="range" min="0" max="100" value="${Math.round(audio.musicVolume * 100)}" data-v="music"><span class="mv">${Math.round(audio.musicVolume * 100)}</span></div>
        <div class="row"><label>효과음</label><input type="range" min="0" max="100" value="${Math.round(audio.sfxVolume * 100)}" data-v="sfx"><span class="sv">${Math.round(audio.sfxVolume * 100)}</span></div>
        <div class="acts">
          ${inGame ? '<button class="btn red" data-a="quit">항복하고 나가기</button>' : ''}
          <button class="btn primary" data-a="close">${inGame ? '계속하기' : '닫기'}</button>
        </div>
      </div></div>`);
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const v = Number(t.value) / 100;
      if (t.dataset.v === 'music') {
        audio.setMusicVolume(v);
        el.querySelector('.mv')!.textContent = t.value;
      } else {
        audio.setSfxVolume(v);
        el.querySelector('.sv')!.textContent = t.value;
      }
    });
    el.addEventListener('change', (e) => {
      if ((e.target as HTMLInputElement).dataset.v === 'sfx') audio.hit();
    });
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === el) return this.toggleSettings(inGame);
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (a === 'close') this.toggleSettings(inGame);
      if (a === 'quit') {
        this.toggleSettings(inGame);
        this.showTitle();
      }
    });
    this.root.appendChild(el);
    this.modal = el;
  }

  private showHelp() {
    const el = h(`
      <div class="modal"><div class="box help">
        <h2>조작법</h2>
        <table>
          <tr><td>← → / A D</td><td>이동 (턴마다 이동 거리 제한) · 방향 전환</td></tr>
          <tr><td>↑ ↓ / W S</td><td>발사 각도 조절 (0°~90°)</td></tr>
          <tr><td>스페이스</td><td>누르고 있으면 파워 충전, 떼면 발사</td></tr>
          <tr><td>1 / 2</td><td>기본탄 / 필살기 선택 (게이지 100 필요)</td></tr>
          <tr><td>드래그</td><td>맵 둘러보기</td></tr>
          <tr><td>Esc</td><td>일시정지 · 설정</td></tr>
          <tr><td>모바일</td><td>왼쪽 ◀▶ 이동, 오른쪽 ▲▼ 각도, 발사 버튼을 누르고 떼기</td></tr>
        </table>
        <p style="color:var(--dim);font-size:calc(var(--u)*1.05)">바람은 포탄을 좌우로 밀어냅니다. 흰 표시선은 지난 발사 파워입니다.<br>폭발은 지형을 파괴하며, 발밑이 사라지면 아래로 떨어집니다. 맵 아래로 떨어지면 탈락!</p>
        <div class="acts"><button class="btn primary" data-a="close">확인</button></div>
      </div></div>`);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === el || t.closest('[data-a="close"]')) {
        el.remove();
        this.modal = null;
      }
    });
    this.root.appendChild(el);
    this.modal = el;
  }

  private toggleFullscreen() {
    const d = document as any;
    const target = document.documentElement as any;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    else {
      const p = (target.requestFullscreen || target.webkitRequestFullscreen)?.call(target);
      p?.then?.(() => (screen.orientation as any)?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  }
}

function setW(el: Element | null, pct: number) {
  if (el) (el as HTMLElement).style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
