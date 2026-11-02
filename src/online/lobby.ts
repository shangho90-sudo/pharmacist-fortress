import { CHAR_LIST, CHAR_TYPES } from '../core/characters';
import { MAP_LIST, MAP_INFO } from '../core/mapgen';
import { OnlineClient } from './client';
import type { Frame, Lobby, StartMatch } from './protocol';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export class OnlineLobby {
  readonly element = document.createElement('div');
  readonly client = new OnlineClient();
  room: Lobby | null = null;
  rooms: Lobby[] = [];
  playing = false;
  status = '서버에 연결하는 중…';
  private nickname = '';
  private noticeTimer = 0;
  onStart: (m: StartMatch) => void = () => {};
  onFrame: (m: Frame) => void = () => {};
  onShow: () => void = () => {};
  onExit: () => void = () => {};
  constructor() {
    this.element.className = 'online-screen';
    try { this.nickname = localStorage.getItem('pf_nickname') || ''; } catch {}
    this.client.onMessage = m => {
      if (m.type === 'hello') { this.status = ''; this.render(); }
      if (m.type === 'rooms') { this.rooms = m.rooms; if (!this.room && !this.playing) this.render(); }
      if (m.type === 'room') { this.room = m.room; if (!this.playing) this.render(); }
      if (m.type === 'error') this.notice(m.message);
      if (m.type === 'left') { this.room = null; this.playing = false; this.onShow(); this.render(); this.notice(m.reason); }
      if (m.type === 'start') { this.playing = true; this.onStart(m); }
      if (m.type === 'frame') this.onFrame(m);
    };
    this.client.onDisconnect = () => { this.room = null; this.playing = false; this.status = '연결이 끊겼습니다. 다시 연결하면 새 대기실에 입장할 수 있어요.'; this.onShow(); this.render(); };
    this.element.addEventListener('click', e => this.click(e));
    this.element.addEventListener('change', e => this.change(e));
    this.element.addEventListener('input', e => { const t = e.target as HTMLInputElement; if (t.name === 'nickname') { this.nickname = t.value; try { localStorage.setItem('pf_nickname', t.value); } catch {} } });
    this.render();
  }
  async connect() { this.status = '서버에 연결하는 중…'; this.render(); try { await this.client.connect(); } catch (e) { this.status = (e as Error).message; this.render(); } }
  show() { this.playing = false; this.render(); }
  close() { this.client.close(); window.clearTimeout(this.noticeTimer); }
  private notice(message: string) {
    let toast = document.getElementById('online-notice');
    if (!toast) { toast = document.createElement('div'); toast.id = 'online-notice'; document.body.appendChild(toast); }
    toast.textContent = message; toast.hidden = false; clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { toast?.remove(); }, 4500);
  }
  private click(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    const action = b.dataset.action;
    if (action === 'back') { this.close(); this.onExit(); }
    if (action === 'retry') void this.connect();
    if (action === 'refresh') this.client.send({ type: 'list' });
    if (action === 'create') {
      if (!this.nickname.trim()) return this.notice('닉네임을 입력해 주세요.');
      this.client.send({ type: 'create', name: this.nickname, title: (this.element.querySelector('[name=title]') as HTMLInputElement).value,
        mode: (this.element.querySelector('[name=create-mode]') as HTMLSelectElement).value });
    }
    if (action === 'join') { if (!this.nickname.trim()) return this.notice('닉네임을 입력해 주세요.'); this.client.send({ type: 'join', room: b.dataset.room, name: this.nickname }); }
    if (action === 'leave') this.client.send({ type: 'leave' });
    if (action === 'character') this.client.send({ type: 'select', character: b.dataset.character });
    if (action === 'team') this.client.send({ type: 'team', team: b.dataset.team });
    if (action === 'ready') this.client.send({ type: 'ready', ready: !this.room?.members.find(m => m.id === this.client.id)?.ready });
    if (action === 'start') this.client.send({ type: 'start' });
    if (action === 'kick') this.client.send({ type: 'kick', player: b.dataset.player });
  }
  private change(e: Event) {
    const t = e.target as HTMLSelectElement;
    if (t.name === 'mode' || t.name === 'map') this.client.send({ type: 'settings', [t.name]: t.value });
  }
  render() {
    // Avoid wiping a guest's draft as live room-list updates arrive.
    const draftTitle = (this.element.querySelector('[name=title]') as HTMLInputElement)?.value || '';
    const draftMode = (this.element.querySelector('[name=create-mode]') as HTMLSelectElement)?.value || 'ffa';
    const focused = this.element.contains(document.activeElement) ? (document.activeElement as HTMLInputElement).name : '';
    const cursor = focused ? (document.activeElement as HTMLInputElement).selectionStart : null;
    const r = this.room, me = r?.members.find(m => m.id === this.client.id), host = r?.host === this.client.id;
    this.element.innerHTML = `<div class="online-shell"><header><div><small>PHARMACIST FORTRESS · ONLINE</small><h1>${r ? esc(r.title) : '온라인 대전'}</h1></div><button data-action="${r ? 'leave' : 'back'}" class="btn ghost">${r ? '방 나가기' : '메인으로'}</button></header>
      ${this.status ? `<div class="online-state">${esc(this.status)}<button class="btn" data-action="retry">다시 연결</button></div>` : ''}
      ${r && me ? this.roomMarkup(r, me.id, !!host) : `<div class="online-browser"><section class="online-create"><h2>로그인 없이 바로 참여</h2><p>닉네임을 정하고 방을 만들거나 공개 대기실에 입장하세요.</p>
        <label>닉네임<input name="nickname" maxlength="16" placeholder="닉네임" value="${esc(this.nickname)}"></label>
        <label>대기실 이름<input name="title" maxlength="32" placeholder="함께 즐겨요!" value="${esc(draftTitle)}"></label>
        <label>게임 방식<select name="create-mode"><option value="ffa" ${draftMode === 'ffa' ? 'selected' : ''}>개인전</option><option value="teams" ${draftMode === 'teams' ? 'selected' : ''}>팀전 · BLUE vs RED</option></select></label>
        <button class="btn primary" data-action="create" ${!this.client.connected ? 'disabled' : ''}>＋ 공개 대기실 만들기</button><small>2–8명 · 먼저 준비한 캐릭터 선점</small></section>
        <section class="online-rooms"><div class="online-row"><h2>공개 대기실 <em>${this.rooms.length}</em></h2><button class="btn ghost" data-action="refresh">새로고침</button></div>
        <div class="room-list">${this.rooms.map(room => `<article><div><h3>${esc(room.title)}</h3><p>${room.mode === 'teams' ? 'BLUE / RED 팀전' : '개인전'} · ${room.members.length}/${room.max}명 · ${MAP_INFO[room.map].name}</p><small>★ ${esc(room.members.find(m => m.id === room.host)?.name || '')}</small></div><button class="btn primary" data-action="join" data-room="${room.id}" ${room.playing || room.members.length >= room.max ? 'disabled' : ''}>${room.playing ? '게임 중' : room.members.length >= room.max ? '가득 참' : '입장'}</button></article>`).join('') || '<div class="online-empty">열린 대기실이 없어요.<br>첫 번째 방을 만들어 보세요!</div>'}</div></section></div>`}</div>`;
    if (focused) { const input = this.element.querySelector<HTMLInputElement>(`[name="${focused}"]`); input?.focus(); if (input?.tagName === 'INPUT' && cursor !== null) input.setSelectionRange(cursor, cursor); }
  }
  private roomMarkup(r: Lobby, id: string, host: boolean) {
    const me = r.members.find(m => m.id === id)!;
    const allReady = r.members.length >= 2 && r.members.every(m => m.ready);
    const teamsValid = r.mode !== 'teams' || new Set(r.members.map(m => m.team)).size === 2;
    return `<div class="online-settings"><label>게임 방식<select name="mode" ${host ? '' : 'disabled'}><option value="ffa" ${r.mode === 'ffa' ? 'selected' : ''}>개인전</option><option value="teams" ${r.mode === 'teams' ? 'selected' : ''}>팀전</option></select></label><label>맵<select name="map" ${host ? '' : 'disabled'}>${MAP_LIST.map(map => `<option value="${map}" ${r.map === map ? 'selected' : ''}>${MAP_INFO[map].icon} ${MAP_INFO[map].name}</option>`).join('')}</select></label><span>${r.members.length} / ${r.max}명 · ★ 방장</span></div>
      <div class="online-room-grid"><section><h2>참가 플레이어</h2><div class="online-members">${r.members.map(m => `<article class="member ${r.mode === 'teams' ? m.team : ''} ${m.id === id ? 'self' : ''}">
        <div class="member-portrait">${m.character ? `<img src="chars2/${m.character}_idle.png" alt="">` : '<span>?</span>'}</div><div class="member-info"><b>${m.id === r.host ? '<span class="host-star" title="방장">★</span> ' : ''}${esc(m.name)}${m.id === id ? ' (나)' : ''}</b><small>${m.character ? CHAR_TYPES[m.character].name : '캐릭터를 선택해 주세요'}${r.mode === 'teams' ? ` · ${m.team.toUpperCase()}` : ''}</small></div><strong class="${m.ready ? 'is-ready' : ''}">${m.ready ? '준비 완료' : '선택 중'}</strong>${host && m.id !== id ? `<button class="kick" data-action="kick" data-player="${m.id}" aria-label="${esc(m.name)} 강퇴">강퇴</button>` : ''}</article>`).join('')}</div></section>
      <section><h2>캐릭터 선택</h2><p class="online-hint">준비 완료한 사람이 먼저 선점합니다. 회색 캐릭터는 선택할 수 없어요.</p><div class="online-characters">${CHAR_LIST.map(c => {
        const owner = r.members.find(m => m.id !== id && m.ready && m.character === c), selected = me.character === c;
        return `<button class="online-character ${selected ? 'selected' : ''} ${owner ? 'locked' : ''}" data-action="character" data-character="${c}" ${me.ready || owner ? 'disabled' : ''} title="${owner ? esc(owner.name) + '님이 선점' : CHAR_TYPES[c].name}"><img src="chars2/${c}_idle.png" alt=""><b>${CHAR_TYPES[c].name}</b><small>${owner ? '🔒 ' + esc(owner.name) : selected ? '선택됨' : '선택 가능'}</small></button>`;
      }).join('')}</div>${r.mode === 'teams' ? `<div class="team-choices"><button class="team-blue ${me.team === 'blue' ? 'active' : ''}" data-action="team" data-team="blue" ${me.ready ? 'disabled' : ''}>BLUE 팀</button><button class="team-red ${me.team === 'red' ? 'active' : ''}" data-action="team" data-team="red" ${me.ready ? 'disabled' : ''}>RED 팀</button></div>` : ''}</section></div>
      <footer class="online-footer"><p>${!teamsValid ? 'BLUE와 RED에 각각 1명 이상 필요합니다.' : allReady ? '모두 준비됐어요. 방장이 시작할 수 있습니다!' : '모든 참가자와 방장이 준비 완료를 눌러 주세요.'}</p><div><button class="btn ${me.ready ? 'ghost' : 'primary'}" data-action="ready" ${!me.character ? 'disabled' : ''}>${me.ready ? '준비 취소' : '준비 완료'}</button>${host ? `<button class="btn start-online" data-action="start" ${allReady && teamsValid ? '' : 'disabled'}>★ 게임 시작</button>` : ''}</div></footer>`;
  }
}
