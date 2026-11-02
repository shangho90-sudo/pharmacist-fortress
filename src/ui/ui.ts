import { OnlineLobby } from '../online/lobby';
import type { StartMatch } from '../online/protocol';
import { CHAR_LIST, CHAR_TYPES, type CharTypeId } from '../core/characters';
import { MAX_GAUGE, MOVE_PER_TURN, TICK_RATE } from '../core/constants';
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
const portrait = (id: CharTypeId) => `chars2/${id}_idle.png`;
const battlePic = (id: CharTypeId) => `chars2/${id}_battle.png`;

type Mode = 'ai' | 'online';

/** 원화 좌표 → 컨테이너 % 위치 */
function box(W: number, H: number, x0: number, y0: number, x1: number, y1: number) {
  const f = (v: number) => v.toFixed(3);
  return `left:${f((x0 / W) * 100)}%;top:${f((y0 / H) * 100)}%;width:${f(((x1 - x0) / W) * 100)}%;height:${f(((y1 - y0) / H) * 100)}%`;
}



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
  private online: OnlineLobby | null = null;
  private onlineMatch: StartMatch | null = null;

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

  // ───────────── 시작 화면 (원화 + START/EXIT) ─────────────
  showTitle() {
    this.online?.close(); this.online = null; this.onlineMatch = null;
    this.removeHud();
    this.stopSelectTimer();
    this.scene.stopBattle();
    audio.playBgm('title');
    // 원화 좌표(2250×1486) 기준 % 위치에 버튼 히트 영역을 정확히 겹친다
    const el = h(`
      <div class="art-screen" data-kind="title">
        <div class="art-blur" style="background-image:url(ui/title.jpg)"></div>
        <div class="art" style="aspect-ratio:2250/1486;background-image:url(ui/title.jpg)">
          <button class="hot start" style="${box(2250, 1486, 806, 980, 1452, 1170)}" data-a="start" aria-label="START"></button>
          <button class="hot exit" style="${box(2250, 1486, 866, 1194, 1385, 1345)}" data-a="exit" aria-label="EXIT"></button>
          <div class="ver">v0.5 · 약사대전</div>
        </div>
      </div>`);
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      audio.unlock();
      audio.click();
      if (a === 'start') this.showModeMenu();
      if (a === 'exit') this.showExit();
    });
    this.setScreen(el);
  }

  /** START → 모드 선택 */
  private showModeMenu() {
    const el = h(`
      <div class="modal arcade"><div class="abox">
        <div class="atitle">GAME MODE</div>
        <button class="abtn gold" data-a="ai">🤖 AI 대전</button>
        <button class="abtn blue" data-a="online">🌐 온라인 대전 <small>로그인 없이 공개 대기실 참여</small></button>
        <div class="arow"><button class="abtn blue sm" data-a="help">조작법</button><button class="abtn blue sm" data-a="settings">설정</button></div>
        <button class="aclose" data-a="close">✕</button>
      </div></div>`);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (t === el || a === 'close') return el.remove();
      if (!a) return;
      audio.click();
      if (a === 'ai') {
        el.remove();
        this.setup.mode = a;
        this.selSlot = 'p1';
        this.showSelect();
      }
      if (a === 'online') { el.remove(); this.showOnline(); }
      if (a === 'help') {
        el.remove();
        this.showHelp();
      }
      if (a === 'settings') {
        el.remove();
        this.toggleSettings(false);
      }
    });
    this.root.appendChild(el);
  }

  private showExit() {
    const el = h(`
      <div class="modal arcade"><div class="abox">
        <div class="atitle">EXIT</div>
        <p class="amsg">게임을 종료할까요?</p>
        <div class="arow"><button class="abtn gold sm" data-a="yes">종료</button><button class="abtn blue sm" data-a="no">취소</button></div>
      </div></div>`);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (t === el || a === 'no') return el.remove();
      if (a === 'yes') {
        audio.playBgm(null);
        try {
          window.close();
        } catch {
          /* 스크립트로 열지 않은 탭은 닫을 수 없음 */
        }
        el.querySelector('.abox')!.innerHTML = `<div class="atitle">GAME OVER</div><p class="amsg">플레이해 주셔서 감사합니다!<br>브라우저 탭을 닫으면 종료됩니다.</p><button class="abtn gold sm" data-a="back">처음으로</button>`;
        el.querySelector('[data-a="back"]')!.addEventListener('click', () => {
          el.remove();
          this.showTitle();
        });
      }
    });
    this.root.appendChild(el);
  }

  // ───────────── 캐릭터 선택 (원화 배경 + 네온 패널) ─────────────
  private selSlot: 'p1' | 'p2' = 'p1';
  private selKey: ((e: KeyboardEvent) => void) | null = null;

  private stopSelectTimer() {
    if (this.selKey) window.removeEventListener('keydown', this.selKey);
    this.selKey = null;
  }

  private showSelect() {
    this.stopSelectTimer();
    this.scene.stopBattle();
    const s = this.setup;
    const W = 1672,
      H = 941;
    const ai = s.mode === 'ai';
    const tiles = CHAR_LIST.map((id, i) => {
      const r = Math.floor(i / 5),
        c = i % 5;
      const x0 = 500 + c * 137,
        y0 = 166 + r * 171;
      return `<button class="ntile" data-id="${id}" style="${box(W, H, x0, y0, x0 + 125, y0 + 155)};--g:${CHAR_TYPES[id].palette.glow}">
        <span class="bgc"></span><img src="${portrait(id)}" alt=""><b>${CHAR_TYPES[id].name}</b><i class="b1">1P</i><i class="b2">${ai ? 'AI' : '2P'}</i></button>`;
    }).join('');
    const maps = [
      ...MAP_LIST.slice(0, 4).map((id, k) => [id, 492 + k * 174, 583, 492 + k * 174 + 164, 662] as const),
      ...MAP_LIST.slice(4).map((id, k) => [id, 496 + k * 236, 670, 496 + k * 236 + 218, 748] as const),
      ['random', 968, 670, 1186, 748] as const,
    ]
      .map(([id, x0, y0, x1, y1]) => {
        const m = id === 'random' ? { icon: '🎲', name: '랜덤 맵', tags: ['무작위 전장'] } : MAP_INFO[id as MapId];
        return `<button class="nmap" data-map="${id}" style="${box(W, H, x0, y0, x1, y1)}"><b><span>${m.icon}</span>${m.name}</b><small>${m.tags.join(' · ')}</small></button>`;
      })
      .join('');
    const panel = (slot: 'p1' | 'p2', x0: number) =>
      `<div class="npanel ${slot}" data-slot="${slot}" style="${box(W, H, x0, 112, x0 + 428, 775)}">
        <div class="ntag">${slot === 'p1' ? (ai ? '나' : '1P') : ai ? '상대 (AI)' : '2P'}</div>
        <div class="hero"><span class="swirl"></span><img alt=""></div>
        <div class="pn"></div><div class="pr"></div><div class="pt"></div><div class="sep"><i></i></div>
        <div class="psk"></div>
      </div>`;
    const el = h(`
      <div class="art-screen" data-kind="select">
        <div class="art-blur" style="background-image:url(ui/select2_bg.jpg)"></div>
        <div class="art sel2" style="aspect-ratio:1672/941;background-image:url(ui/select2_bg.jpg)">
          <div class="ntitle" style="${box(W, H, 580, 8, 1096, 72)}">${ai ? 'AI 대전' : '2인 대전'} — 캐릭터 선택</div>
          <div class="nsub" style="${box(W, H, 600, 80, 1072, 120)}"></div>
          <button class="hot nlogo" data-a="back" style="${box(W, H, 40, 6, 320, 82)}" title="메인으로"></button>
          ${panel('p1', 40)}${panel('p2', 1204)}
          <div class="ngrid" style="${box(W, H, 486, 146, 1188, 500)}"></div>
          ${tiles}
          ${ai ? `<div class="nseg" style="${box(W, H, 622, 515, 1055, 565)}">${(['easy', 'normal', 'hard'] as AiLevel[]).map((l) => `<button data-lv="${l}">${LEVEL_NAME[l]}</button>`).join('<i></i>')}</div>` : ''}
          ${maps}
          <button class="nbtn blue" data-a="back" style="${box(W, H, 418, 806, 618, 876)}"><span>←</span>뒤로</button>
          <button class="nbtn blue" data-a="random" style="${box(W, H, 638, 806, 858, 876)}"><span>🎲</span>랜덤</button>
          <button class="nbtn gold" data-a="start" style="${box(W, H, 877, 803, 1252, 878)}"><span>⚔</span>전투 시작!</button>
        </div>
      </div>`);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tile = t.closest('.ntile') as HTMLElement | null;
      if (tile) {
        s[this.selSlot] = tile.dataset.id as CharTypeId;
        if (this.selSlot === 'p1') this.selSlot = 'p2';
        audio.click();
        return this.refreshSelect();
      }
      const pnl = t.closest('.npanel') as HTMLElement | null;
      if (pnl) {
        this.selSlot = pnl.dataset.slot as 'p1' | 'p2';
        audio.click();
        return this.refreshSelect();
      }
      const lv = t.closest('[data-lv]') as HTMLElement | null;
      if (lv) {
        s.level = lv.dataset.lv as AiLevel;
        audio.click();
        return this.refreshSelect();
      }
      const mp = t.closest('[data-map]') as HTMLElement | null;
      if (mp) {
        s.map = mp.dataset.map as MapId | 'random';
        audio.click();
        return this.refreshSelect();
      }
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (a === 'back') {
        audio.click();
        this.showTitle();
      }
      if (a === 'random') {
        s.p1 = CHAR_LIST[Math.floor(Math.random() * CHAR_LIST.length)];
        do s.p2 = CHAR_LIST[Math.floor(Math.random() * CHAR_LIST.length)];
        while (s.p2 === s.p1);
        audio.click();
        this.refreshSelect();
      }
      if (a === 'start') {
        audio.click();
        this.startMatch();
      }
    });
    this.selKey = (e: KeyboardEvent) => {
      if (this.root.querySelector('.modal')) return;
      const i = CHAR_LIST.indexOf(s[this.selSlot]);
      const mv = (d: number) => {
        s[this.selSlot] = CHAR_LIST[(i + d + CHAR_LIST.length) % CHAR_LIST.length];
        audio.click();
        this.refreshSelect();
      };
      if (e.key === 'ArrowRight') mv(1);
      else if (e.key === 'ArrowLeft') mv(-1);
      else if (e.key === 'ArrowDown') mv(5);
      else if (e.key === 'ArrowUp') mv(-5);
      else if (e.key === 'Tab') {
        e.preventDefault();
        this.selSlot = this.selSlot === 'p1' ? 'p2' : 'p1';
        this.refreshSelect();
      } else if (e.key === 'Enter') this.startMatch();
      else if (e.key === 'Escape') this.showTitle();
    };
    window.addEventListener('keydown', this.selKey);
    this.setScreen(el);
    this.refreshSelect();
  }

  private refreshSelect() {
    const el = this.screen;
    if (!el || el.dataset.kind !== 'select') return;
    const s = this.setup;
    const ai = s.mode === 'ai';
    el.querySelector('.nsub')!.textContent = this.selSlot === 'p1' ? (ai ? '나의 캐릭터를 고르세요' : '1P의 캐릭터를 고르세요') : ai ? '상대(AI)의 캐릭터를 고르세요' : '2P의 캐릭터를 고르세요';
    el.querySelectorAll<HTMLElement>('.ntile').forEach((t) => {
      const id = t.dataset.id as CharTypeId;
      t.classList.toggle('p1', s.p1 === id);
      t.classList.toggle('p2', s.p2 === id);
    });
    for (const slot of ['p1', 'p2'] as const) {
      const p = el.querySelector(`.npanel.${slot}`) as HTMLElement;
      const d = CHAR_TYPES[s[slot]];
      p.classList.toggle('editing', this.selSlot === slot);
      p.style.setProperty('--g', d.palette.glow);
      (p.querySelector('.hero img') as HTMLImageElement).src = battlePic(d.id);
      p.querySelector('.pn')!.textContent = d.name;
      p.querySelector('.pr')!.textContent = `${d.roman}  ·  ${d.role}`;
      p.querySelector('.pt')!.textContent = `“${d.title}” · ${d.weaponName}`;
      const ic = { basic: '⚡', special: '💥', ultimate: '✚' };
      p.querySelector('.psk')!.innerHTML = (
        [
          ['기본', 'basic', d.basic],
          ['특수', 'special', d.special],
          ['필살', 'ultimate', d.ultimate],
        ] as const
      )
        .map(([lb, k, sk]) => `<div class="sk ${k}"><i>${lb}</i><em>${ic[k]}</em><div><b>${sk.name}</b><small>${sk.desc}</small></div></div>`)
        .join('');
    }
    el.querySelectorAll<HTMLElement>('[data-lv]').forEach((b) => b.classList.toggle('on', b.dataset.lv === s.level));
    el.querySelectorAll<HTMLElement>('[data-map]').forEach((b) => b.classList.toggle('on', b.dataset.map === s.map));
  }

  private startMatch() {
    this.stopSelectTimer();
    const s = this.setup;
    const n1 = CHAR_TYPES[s.p1].name,
      n2 = CHAR_TYPES[s.p2].name;
    const players: PlayerSetup[] = [
      { name: '나 · ' + n1, charType: s.p1, team: 0, controller: 'human' },
      { name: 'AI · ' + n2, charType: s.p2, team: 1, controller: 'ai', aiLevel: s.level },
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

  private showOnline() {
    this.setup.mode = 'online';
    this.removeHud(); this.stopSelectTimer(); this.scene.stopBattle();
    if (!this.online) {
      const lobby = this.online = new OnlineLobby();
      lobby.onExit = () => this.showTitle();
      lobby.onShow = () => {
        this.removeHud(); this.scene.stopBattle(); this.setScreen(lobby.element); audio.playBgm('title');
      };
      lobby.onStart = m => this.startOnline(m);
      lobby.onFrame = m => {
        if (!this.onlineMatch || this.onlineMatch.match !== m.match || !this.scene.game2) return;
        if (!this.scene.applyNetworkFrame(m)) {
          lobby.close(); lobby.status = '게임 연결이 어긋났습니다. 다시 연결해 주세요.';
          lobby.room = null; lobby.onShow(); lobby.show();
        }
      };
      void lobby.connect();
    }
    this.online.show(); this.setScreen(this.online.element); audio.playBgm('title');
  }

  private startOnline(m: StartMatch) {
    const lobby = this.online!;
    this.onlineMatch = m; this.setup.mode = 'online';
    this.stopSelectTimer(); this.setScreen(null); this.stats = m.options.players.map(() => 0);
    this.lastTurn = -1; this.buildHud();
    this.scene.startBattle({ ...m.options, online: { player: m.seats.indexOf(lobby.client.id), send: (action, turn) => lobby.client.send({ type: 'command', action, turn }) } },
      { onEvent: (e, g) => this.onEvent(e, g), onGameOver: g => this.showResult(g) });
    audio.playBgm('battle');
  }

  private onEvent(e: GameEvent, g: Game) {
    if (e.type === 'damage') {
      const att = g.players[e.from];
      if (att && att.team !== g.players[e.player].team) this.stats[e.from] += e.amount;
    }
    if (e.type === 'turnStart') {
      const p = g.players[e.player];
      const local = this.scene.isLocalTurn();
      const sub = e.round === 1 && g.turnNumber === 1 ? `${g.map.icon} ${g.map.name}` : `ROUND ${e.round}`;
      this.showBanner(local && this.setup.mode === 'ai' ? '나의 턴!' : `${p.name.split(' · ').pop()}의 턴`, sub);
    }
  }

  private showBanner(text: string, sub: string) {
    const b = h(`<div class="banner"><small>${sub}</small>${text}</div>`);
    this.root.appendChild(b);
    setTimeout(() => b.remove(), 1500);
  }

  // ───────────── HUD (이미지1 스타일: 네이비 패널 + 하단 조작 바) ─────────────
  private minimapBase: ImageData | null = null;
  private minimapVersion = -1;
  private lastMinimapPaint = 0;

  private buildHud() {
    this.removeHud();
    const el = h(`
      <div id="hud">
        <div class="h-tl">
          <div class="np wind"><span class="ic">💨</span><span class="lb">바람</span><b class="wv">0</b></div>
          <div class="np mapn"><span class="ic">🗺</span><b class="mn">-</b></div>
          <div class="pcards"></div>
        </div>
        <div class="np h-turn"><div class="who">-</div><div class="sub"><span class="tn">TURN 1</span><i></i><span class="ts">30초</span></div></div>
        <div class="h-tr">
          <div class="np mini"><canvas width="240" height="104"></canvas></div>
          <div class="ibtns"><button class="np ibtn" data-a="full" title="전체화면">⛶</button><button class="np ibtn" data-a="settings" title="설정 (Esc)">⚙</button></div>
        </div>
        <div class="h-bottom">
          <div class="np dialp">
            <button class="tb aup" data-t="up" title="각도 올리기 (↑/W)">▲</button>
            <svg class="dial" viewBox="0 0 120 70">
              <path d="M10 62 A52 52 0 0 1 112 62" class="arc"/>
              ${Array.from({ length: 10 }, (_, i) => {
                const a = (i / 9) * Math.PI;
                const x1 = 61 - Math.cos(a) * 52, y1 = 62 - Math.sin(a) * 52, x2 = 61 - Math.cos(a) * 45, y2 = 62 - Math.sin(a) * 45;
                return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="tick"/>`;
              }).join('')}
              <line x1="61" y1="62" x2="105" y2="62" class="needle"/>
              <circle cx="61" cy="62" r="5" class="hub"/>
            </svg>
            <button class="tb adn" data-t="down" title="각도 내리기 (↓/S)">▼</button>
            <div class="dlabel">각도 <b class="av">45°</b></div>
            <div class="moves"><button class="tb" data-t="left" title="왼쪽 이동 (←/A)">◀</button><span>이동</span><button class="tb" data-t="right" title="오른쪽 이동 (→/D)">▶</button></div>
          </div>
          <div class="midp">
            <div class="row1">
              <div class="np slots">
                <button class="slot1 on" data-w="basic"><kbd>1</kbd><span class="ic">💊</span><span class="nm b1n">기본탄</span><small>∞</small></button>
                <button class="slot1" data-w="special"><kbd>2</kbd><span class="ic">💥</span><span class="nm sp2n">특수탄</span><small class="sp2g">READY</small></button>
                <button class="slot1" data-w="ultimate"><kbd>3</kbd><span class="ic">✨</span><span class="nm spn">필살기</span><small class="spg">0%</small><i class="charge"></i></button>
                <button class="slot1 mv" data-w="move"><kbd>4</kbd><span class="ic">🌀</span><span class="nm">이동탄</span><small class="mvg">READY</small></button>
              </div>
              <div class="np timep"><span>TIME</span><b class="tm">30</b></div>
            </div>
            <div class="np bars">
              <div class="br hp"><span class="ic">💚</span><span class="lb">체력</span><div class="trk"><i class="ghost"></i><i class="fill"></i></div><b class="num">100 / 100</b></div>
              <div class="br pw"><span class="ic">🔥</span><span class="lb">파워</span><div class="trk"><i class="fill"></i><i class="last"></i></div><b class="num">0 %</b></div>
              <div class="br mv"><span class="ic">👟</span><span class="lb">이동</span><div class="trk"><i class="fill"></i></div><b class="num">140 / 140</b></div>
            </div>
          </div>
          <div class="rightp">
            <div class="row1">
              <button class="np sbtn" data-a="skip">턴 넘기기</button>
              <button class="np sbtn" data-a="settings">설정</button>
              <button class="np sbtn" data-a="quit">나가기</button>
            </div>
            <button class="firebtn" data-t="fire"><span class="burst">✸</span><span class="t"><b>무기발사</b><small>FIRE · 길게 눌렀다 떼기</small></span></button>
          </div>
        </div>
      </div>`);
    const meter = el.querySelector('.wind')!;
    void meter;
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const w = t.closest('[data-w]')?.getAttribute('data-w') as 'basic' | 'special' | 'ultimate' | 'move' | undefined;
      if (w) this.scene.selectWeapon(w);
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (a === 'skip') this.scene.skipTurn();
      if (a === 'settings') this.toggleSettings(true);
      if (a === 'full') this.toggleFullscreen();
      if (a === 'quit') {
        audio.click();
        this.showTitle();
      }
    });
    // 미니맵 클릭 → 그 지점 보기
    const mc = el.querySelector('.mini canvas') as HTMLCanvasElement;
    mc.addEventListener('pointerdown', (ev) => {
      const r = mc.getBoundingClientRect();
      const g = this.scene.game2;
      this.scene.lookAt(((ev.clientX - r.left) / r.width) * g.worldW, ((ev.clientY - r.top) / r.height) * g.worldH);
    });
    // 누르고 있는 동안 동작하는 버튼 (마우스/터치 공통)
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
        if (!b.classList.contains('press')) return;
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
    this.minimapVersion = -1;
    this.lastMinimapPaint = 0;
    let lastHud = -Infinity;
    const loop = (now: number) => {
      if (now - lastHud >= 1000 / 30) { this.updateHud(); lastHud = now; }
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

  private drawMinimap(canvas: HTMLCanvasElement, g: Game) {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width,
      H = canvas.height;
    if (this.minimapVersion !== g.terrain.version || !this.minimapBase) {
      // 지형 축소본 (변경 시에만 재계산)
      const img = ctx.createImageData(W, H);
      const d = img.data;
      const sx = g.worldW / W,
        sy = g.worldH / H;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let solid = 0;
          for (let k = 0; k < 3; k++) if (g.terrain.solidAt(Math.floor((x + 0.25 + k * 0.25) * sx), Math.floor((y + 0.5) * sy))) solid++;
          const i = (y * W + x) * 4;
          const liquid = g.map.liquidY !== null && (y + 0.5) * sy > g.map.liquidY;
          if (solid >= 2) {
            const top = !g.terrain.solidAt(Math.floor((x + 0.5) * sx), Math.floor((y - 1) * sy));
            d[i] = top ? 190 : 120;
            d[i + 1] = top ? 200 : 128;
            d[i + 2] = top ? 220 : 150;
            d[i + 3] = 255;
          } else if (liquid) {
            const lava = g.map.liquid === 'lava';
            d[i] = lava ? 220 : 40;
            d[i + 1] = lava ? 90 : 120;
            d[i + 2] = lava ? 30 : 200;
            d[i + 3] = 255;
          } else {
            d[i] = 10;
            d[i + 1] = 22;
            d[i + 2] = 52;
            d[i + 3] = 255;
          }
        }
      this.minimapBase = img;
      this.minimapVersion = g.terrain.version;
    }
    ctx.putImageData(this.minimapBase, 0, 0);
    const sx = W / g.worldW,
      sy = H / g.worldH;
    // 카메라 시야
    const cc = this.scene.cameraCenter;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round((cc.x - 480) * sx) + 0.5, Math.round((cc.y - 270) * sy) + 0.5, Math.round(960 * sx), Math.round(540 * sy));
    // 포탄
    ctx.fillStyle = '#fff6a0';
    for (const pr of g.projectiles) ctx.fillRect(Math.round(pr.x * sx) - 1, Math.round(pr.y * sy) - 1, 3, 3);
    // 플레이어
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    g.players.forEach((p, i) => {
      if (!p.alive) return;
      const x = Math.round(p.x * sx),
        y = Math.round(p.y * sy);
      ctx.fillStyle = p.team === 0 ? '#4ea1ff' : '#ff5a6a';
      ctx.fillRect(x - 3, y - 7, 6, 7);
      if (i === g.current && blink) {
        ctx.strokeStyle = '#ffd23f';
        ctx.strokeRect(x - 4.5, y - 8.5, 9, 10);
      }
    });
  }

  private updateHud() {
    const g = this.scene.game2;
    const el = this.hud;
    if (!g || !el) return;
    const cp = g.currentPlayer;
    const local = this.scene.isLocalTurn();
    // 좌상단: 바람/맵/플레이어
    const wv = el.querySelector('.wv') as HTMLElement;
    setText(wv, g.wind === 0 ? (g.map.windScale === 0 ? '0 (무풍)' : '0') : `${g.wind > 0 ? '' : '← '}${Math.abs(g.wind)}${g.wind > 0 ? ' →' : ''}`);
    wv.classList.toggle('strong', Math.abs(g.wind) >= 7);
    setText(el.querySelector('.mn'), `${g.map.icon} ${g.map.name}`);
    const pc = el.querySelector('.pcards')!;
    if (pc.childElementCount !== g.players.length) {
      pc.innerHTML = g.players
        .map(
          (p) => `<div class="pcard np"><div class="face" style="background-image:url(${portrait(p.charType)});--tc:${p.team === 0 ? '#4ea1ff' : '#ff5a6a'}"></div>
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
      setText(c.querySelector('.hpn'), String(p.hp));
      const sp = c.querySelector('.bar.sp') as HTMLElement;
      sp.classList.toggle('full', p.gauge >= MAX_GAUGE);
      setW(sp.querySelector('.fill'), p.gauge);
    });
    // 상단 중앙: 턴
    const sec = Math.max(0, Math.ceil(g.turnTicksLeft / TICK_RATE));
    const who = g.phase === 'over' ? '경기 종료' : `${cp.name.split(' · ').pop()}의 턴`;
    setText(el.querySelector('.h-turn .who'), who);
    setText(el.querySelector('.h-turn .tn'), `TURN ${g.turnNumber}`);
    const ts = el.querySelector('.h-turn .ts') as HTMLElement;
    const timing = g.phase === 'aiming' || g.phase === 'turnStart';
    setText(ts, timing ? `${sec}초` : '—');
    ts.classList.toggle('warn', g.phase === 'aiming' && sec <= 5);
    // 미니맵
    const now = performance.now();
    if (now - this.lastMinimapPaint >= 100 || this.minimapVersion !== g.terrain.version) {
      this.drawMinimap(el.querySelector('.mini canvas') as HTMLCanvasElement, g);
      this.lastMinimapPaint = now;
    }
    // 하단: 각도 다이얼
    const ang = Math.round(cp.angle);
    setText(el.querySelector('.av'), `${ang}°`);
    const needle = el.querySelector('.needle') as SVGLineElement;
    const rad = (ang * Math.PI) / 180;
    // 바늘은 실제 발사 방향 (오른쪽을 보면 0°=오른쪽, 왼쪽을 보면 0°=왼쪽)
    const da = cp.facing === 1 ? rad : Math.PI - rad;
    needle.setAttribute('x2', (61 + Math.cos(da) * 44).toFixed(1));
    needle.setAttribute('y2', (62 - Math.sin(da) * 44).toFixed(1));
    // 무기 슬롯: 기본탄 / 특수탄(재사용 대기) / 필살기(게이지)
    const def = CHAR_TYPES[cp.charType];
    const wb = el.querySelector('[data-w="basic"]') as HTMLElement;
    const w2 = el.querySelector('[data-w="special"]') as HTMLElement;
    const ws = el.querySelector('[data-w="ultimate"]') as HTMLElement;
    wb.classList.toggle('on', this.scene.selected === 'basic');
    w2.classList.toggle('on', this.scene.selected === 'special');
    ws.classList.toggle('on', this.scene.selected === 'ultimate');
    setText(wb.querySelector('.b1n'), def.basic.name);
    wb.title = `기본탄 · ${def.basic.name}: ${def.basic.desc}`;
    setText(w2.querySelector('.sp2n'), def.special.name);
    setText(w2.querySelector('.sp2g'), cp.specialCd > 0 ? `${cp.specialCd}턴` : 'READY');
    w2.classList.toggle('locked', cp.specialCd > 0);
    w2.title = `특수탄 · ${def.special.name}: ${def.special.desc} (사용 후 3턴 대기)`;
    ws.classList.toggle('locked', cp.gauge < MAX_GAUGE);
    ws.classList.toggle('ready', cp.gauge >= MAX_GAUGE && this.scene.selected !== 'ultimate' && local);
    setW(ws.querySelector('.charge'), cp.gauge);
    setText(ws.querySelector('.spn'), def.ultimate.name);
    setText(ws.querySelector('.spg'), cp.gauge >= MAX_GAUGE ? 'READY' : `${cp.gauge}%`);
    ws.title = `필살기 · ${def.ultimate.name}: ${def.ultimate.desc}`;
    const wm = el.querySelector('[data-w="move"]') as HTMLElement;
    wm.classList.toggle('on', this.scene.selected === 'move');
    wm.classList.toggle('locked', cp.moveShotCd > 0);
    setText(wm.querySelector('.mvg'), cp.moveShotCd > 0 ? `${cp.moveShotCd}턴` : 'READY');
    wm.title = '이동탄: 탄이 떨어진 위치로 캐릭터가 이동합니다 (피해 없음, 사용 후 3턴 대기)';
    // TIME
    const tm = el.querySelector('.timep .tm') as HTMLElement;
    setText(tm, timing ? String(sec) : '—');
    tm.classList.toggle('warn', g.phase === 'aiming' && sec <= 5);
    // 상태 바: 체력(현재 플레이어)·파워·이동
    const hpb = el.querySelector('.br.hp') as HTMLElement;
    setW(hpb.querySelector('.fill'), cp.hp);
    setW(hpb.querySelector('.ghost'), cp.hp);
    setText(hpb.querySelector('.num'), `${cp.hp} / 100`);
    const pw = this.scene.charge;
    const pwb = el.querySelector('.br.pw') as HTMLElement;
    setW(pwb.querySelector('.fill'), pw);
    setText(pwb.querySelector('.num'), `${Math.round(pw)} %`);
    const last = pwb.querySelector('.last') as HTMLElement;
    if (cp.lastPower !== null) {
      last.style.display = 'block';
      last.style.left = `calc(${cp.lastPower}% - 1px)`;
    } else last.style.display = 'none';
    const mvb = el.querySelector('.br.mv') as HTMLElement;
    setW(mvb.querySelector('.fill'), (cp.moveLeft / MOVE_PER_TURN) * 100);
    setText(mvb.querySelector('.num'), `${Math.round(cp.moveLeft)} / ${MOVE_PER_TURN}`);
    // 조작 가능 여부
    const bottom = el.querySelector('.h-bottom') as HTMLElement;
    bottom.classList.toggle('idle', !(local && g.canControl));
    (el.querySelector('.firebtn') as HTMLElement).classList.toggle('charging', this.scene.charging);
    if (g.current !== this.lastTurn) this.lastTurn = g.current;
  }

  // ───────────── 결과 ─────────────
  private showResult(g: Game) {
    const s = this.setup;
    const winner = g.players.find((p) => p.team === g.winnerTeam);
    let title = '무승부',
      cls = 'lose';
    if (winner) {
      if (s.mode === 'online') {
        const mine = g.players[this.scene.cfg.online!.player];
        const won = mine.team === g.winnerTeam;
        title = this.onlineMatch?.mode === 'teams' ? (g.winnerTeam === 0 ? 'BLUE 팀 승리!' : 'RED 팀 승리!') : winner.name + ' 승리!';
        cls = won ? 'win' : 'lose';
      } else if (s.mode === 'ai') {
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
${s.mode === 'online' ? '<button class="btn primary" data-a="lobby">대기실로</button>' : '<button class="btn" data-a="select">캐릭터 다시 선택</button><button class="btn primary" data-a="again">재대결</button>'}
        </div>
      </div>`);
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      audio.click();
      if (a === 'lobby') this.showOnline();
      if (a === 'again') this.startMatch();
      if (a === 'select') {
        this.removeHud();
        this.selSlot = 'p1';
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
          <tr><td>1 / 2 / 3 / 4</td><td>기본탄 / 특수탄(3턴 대기) / 필살기(게이지 100) / 이동탄(착탄 지점으로 이동, 3턴 대기)</td></tr>
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
  const width = `${Math.round(Math.max(0, Math.min(100, pct)) * 100) / 100}%`;
  if (el && (el as HTMLElement).style.width !== width) (el as HTMLElement).style.width = width;
}

function setText(el: Element | null, text: string) {
  if (el && el.textContent !== text) el.textContent = text;
}
