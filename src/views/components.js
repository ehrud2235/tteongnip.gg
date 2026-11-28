import { html, raw } from '../util/html.js';
import { POSITION_NAMES, fmtAvg, fmtPct, fmtRatio, fmtSigned, kdaRatio, winRate } from '../util/format.js';
import { START_RATING } from '../stats.js';
import { PART_NAMES, PIR_OPTIONS, ROLE_WEIGHTS } from '../ow-pir.js';

export const playerUrl = (puuid) => `/players/${encodeURIComponent(puuid)}`;
export const matchUrl = (id) => `/matches/${encodeURIComponent(id)}`;

export function champIcon(dd, id, size = 32, cls = 'ci') {
  const c = dd.champion(id);
  return html`<img class="${cls}" src="${c.icon}" alt="${c.name}" title="${c.name}" width="${size}" height="${size}" loading="lazy">`;
}

export function spellIcons(dd, spells = []) {
  return html`<span class="spells">${spells.map((id) => {
    const s = dd.spell(id);
    return s ? html`<img src="${s.icon}" alt="${s.name}" title="${s.name}" width="16" height="16" loading="lazy">` : html`<i class="slot sm"></i>`;
  })}</span>`;
}

export function runeIcons(dd, keystone, subStyle) {
  const k = dd.rune(keystone);
  const s = dd.rune(subStyle);
  if (!k && !s) return '';
  return html`<span class="runes">${k ? html`<img class="key" src="${k.icon}" alt="${k.name}" title="${k.name}" width="16" height="16" loading="lazy">` : ''}${s ? html`<img src="${s.icon}" alt="${s.name}" title="${s.name}" width="16" height="16" loading="lazy">` : ''}</span>`;
}

export function itemIcons(dd, items = []) {
  return html`<span class="items">${items.map((id, i) => {
    const it = dd.item(id);
    const cls = i === 6 ? 'trinket' : '';
    return it
      ? html`<img class="${cls}" src="${it.icon}" alt="${it.name}" title="${it.name}" width="22" height="22" loading="lazy">`
      : html`<i class="slot ${cls}"></i>`;
  })}</span>`;
}

export function playerName(p, { link = true, linkedName = null } = {}) {
  const inner = html`<span class="nm">${p.name || '이름 없음'}</span>${p.tag ? html`<span class="tag">#${p.tag}</span>` : ''}`;
  return html`<span class="pn">${link ? html`<a href="${playerUrl(p.puuid)}">${inner}</a>` : inner}${linkedName ? html`<span class="dc" title="디스코드">@${linkedName}</span>` : ''}</span>`;
}

export function bar(pct, cls = '') {
  const w = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  return raw(
    `<svg class="bar ${cls}" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-bg" width="100" height="6" rx="3"/><rect class="bar-fg" width="${w}" height="6" rx="3"/></svg>`,
  );
}

export function winRateCell(wins, games) {
  const wr = winRate(wins, games);
  return html`<div class="wr ${wr >= 60 ? 'hot' : wr < 40 ? 'cold' : ''}"><b>${fmtPct(wins, games)}</b>${bar(wr)}</div>`;
}

/** 여러 판 평균 K/D/A와 KDA 비율 */
export function kdaCell(kills, deaths, assists, games = 1) {
  const ratio = kdaRatio(kills, deaths, assists);
  const n = Math.max(1, games);
  const val = (x) => (games > 1 ? fmtAvg(x / n) : String(x));
  return html`<div class="kda"><span>${val(kills)} / <em>${val(deaths)}</em> / ${val(assists)}</span><small class="${ratio >= 4 ? 'great' : ratio >= 3 ? 'good' : ''}">${fmtRatio(ratio)}${ratio === Infinity ? '' : ' KDA'}</small></div>`;
}

export function delta(n) {
  if (n == null) return '';
  return html`<span class="delta ${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${fmtSigned(n)}</span>`;
}

export function posBadge(pos, manual = false) {
  if (!pos) return '';
  return html`<span class="pos pos-${pos.toLowerCase()}${manual ? ' manual' : ''}" title="${manual ? '직접 고친 라인' : '자동으로 추정한 라인'}">${POSITION_NAMES[pos]}</span>`;
}

export function resultDots(recent = []) {
  return html`<span class="dots" title="최근 ${recent.length}경기">${recent.map((w) => html`<i class="${w === null ? 'd' : w ? 'w' : 'l'}"></i>`)}</span>`;
}

export function streakBadge(streak) {
  if (streak >= 3) return html`<span class="streak hot">${streak}연승</span>`;
  if (streak <= -3) return html`<span class="streak cold">${-streak}연패</span>`;
  return '';
}

/** 점수 변화 그래프 (inline SVG) */
export function ratingChart(history) {
  if (history.length < 2) return '';
  const values = [START_RATING, ...history.map((h) => h.rating)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(20, max - min);
  const W = 600;
  const H = 120;
  const pad = 8;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / span) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const baseY = H - pad - ((START_RATING - min) / span) * (H - pad * 2);
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="점수 변화: 최저 ${min}, 최고 ${max}">
<line class="chart-base" x1="0" x2="${W}" y1="${baseY.toFixed(1)}" y2="${baseY.toFixed(1)}"/>
<polyline class="chart-line" points="${pts.join(' ')}"/>
</svg>`);
}

export function emptyState(title, body) {
  return html`<div class="empty"><div class="empty-icon" aria-hidden="true">🌱</div><h3>${title}</h3><p>${body}</p></div>`;
}

// ---------- 오버워치 ----------
const ROLE_SHORT = { TANK: ['탱', '탱커'], DAMAGE: ['딜', '딜러'], SUPPORT: ['힐', '지원'] };

export const owPlayerUrl = (key) => `/ow/players/${encodeURIComponent(String(key).replace(/^ow:/, ''))}`;
export const owMatchUrl = (id) => `/ow/matches/${encodeURIComponent(id)}`;

export function roleBadge(role) {
  const r = ROLE_SHORT[role];
  if (!r) return html`<span class="role role-none" title="역할 모름">?</span>`;
  return html`<span class="role role-${role.toLowerCase()}" title="${r[1]}">${r[0]}</span>`;
}

export function owPlayerName(p, { link = true, linkedName = null } = {}) {
  const inner = html`<span class="nm">${p.name || '이름 없음'}</span>`;
  return html`<span class="pn">${link ? html`<a href="${owPlayerUrl(p.key)}">${inner}</a>` : inner}${linkedName ? html`<span class="dc" title="디스코드">@${linkedName}</span>` : ''}</span>`;
}

export function titleBadges(titles = []) {
  return titles.map((t) => html`<span class="title-badge" title="${t.why}">${t.name}</span>`);
}

export function heroChips(names = []) {
  return html`<span class="hero-chips">${names.map((n) => html`<span class="hero-chip">${n}</span>`)}</span>`;
}

export function fmtPlayTime(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

/** 영웅 얼굴. 이미지 주소를 모르면 이름 글자로 보여준다. */
export function heroIcon(owh, name, size = 28, { fallback = 'chip', cls = '' } = {}) {
  const src = owh?.portrait(name);
  if (src) return html`<img class="hi ${cls}" src="${src}" alt="${name}" title="${name}" width="${size}" height="${size}" loading="lazy">`;
  if (fallback === 'none') return '';
  return fallback === 'text' ? html`<small class="hero-text ${cls}" title="${name}">${name}</small>` : html`<span class="hero-chip">${name}</span>`;
}

/** PIR (기여도). 그 판 평균이 100 */
export function pirCell(entry, role = null) {
  if (!entry) return '';
  const cls = entry.pir >= 130 ? 'great' : entry.pir >= 100 ? 'good' : entry.pir < 70 ? 'low' : '';
  let title = `PIR ${entry.pir} · 이 판 ${entry.rank}위 (평균 100)`;
  if (entry.parts) {
    const w = ROLE_WEIGHTS[role] || ROLE_WEIGHTS.DAMAGE;
    title += Object.entries(PART_NAMES)
      .filter(([k]) => w[k] > 0)
      .map(([k, name]) => `\n${name} ${entry.parts[k]} (${w[k]}%)`)
      .join('');
  }
  return html`<span class="pir ${cls}" title="${title}">${entry.pir}</span><small>${entry.rank}위</small>`;
}

export function mvpBadge(entry) {
  if (!entry) return '';
  if (entry.mvp) return html`<span class="badge mvp" title="이긴 팀에서 PIR 1등">MVP</span>`;
  if (entry.ace) return html`<span class="badge ace" title="진 팀에서 PIR 1등">ACE</span>`;
  return '';
}

/** PIR 계산식 설명 */
export function pirExplainer(weights) {
  return html`<details class="pir-help"><summary>PIR(기여도)이 뭔가요?</summary>
  <p>오버워치 리그의 Player Impact Rating처럼 <b>그 판 평균을 100</b>으로 맞춘 기여도예요. 100보다 높으면 평균보다 잘한 거예요. 리그의 실제 계산식은 공개되지 않아서 아래 점수를 더하고 빼서 계산해요. MVP는 이긴 팀 1등, ACE는 진 팀 1등이에요.</p>
  <ul>${weights.map(([label, w]) => html`<li>${label} <b>${typeof w === 'number' && w > 0 ? `+${w}` : w}</b></li>`)}</ul>
</details>`;
}

/** 오버워치 PIR 2.0 설명 */
export function owPirExplainer({ precise } = {}) {
  const roleNames = { TANK: '탱커', DAMAGE: '딜러', SUPPORT: '지원' };
  return html`<details class="pir-help"><summary>PIR(기여도)이 뭔가요?</summary>
  <p>오버워치 리그의 Player Impact Rating처럼 <b>그 판 평균을 100</b>에 맞춘 기여도예요. 단순 기록이 아니라 <b>한타 상황</b>으로 보정해요. 처치 사이가 15초 넘게 비면 다른 한타로 보고, 매 순간 양 팀 생존 인원을 다시 계산해요. 일곱 가지 요소를 같은 역할끼리 평균 100으로 맞춘 뒤 역할별 비중으로 합쳐요. PIR 숫자에 마우스를 올리면 요소별 점수가 보여요. MVP는 이긴 팀 1등, ACE는 진 팀 1등이에요.</p>
  ${precise && (!precise.spawns || !precise.snaps) ? html`<p class="small">이 판은 예전 스크립트로 기록돼서 부활 시간과 피해·치유 흐름 일부를 추정했어요.</p>` : ''}
  <div class="table-wrap"><table class="small-table"><thead><tr><th>요소</th>${Object.values(roleNames).map((n) => html`<th class="num">${n}</th>`)}</tr></thead>
  <tbody>${Object.entries(PART_NAMES).map(([k, name]) => html`<tr><td>${name}</td>${Object.keys(roleNames).map((r) => html`<td class="num">${ROLE_WEIGHTS[r][k]}%</td>`)}</tr>`)}</tbody></table></div>
  <p class="small">탱커 보정: 최종 PIR ×${PIR_OPTIONS.tankBonus} (5대5에서 탱커는 한 판에 두 명뿐이라 같은 역할끼리 비교할 상대가 적어서 점수가 덜 올라가는 것을 보정)</p>
  <p class="small">결정타: 한타 시작 첫 킬 ×1.5 · 열세에서 ×1.3 · 동수 ×1.0 · 1명 우세 ×0.8 · 2명 이상 우세 ×0.5 · 사실상 끝난 한타 ×0.25 · 주변에 아무도 없는 1대1 ×1.2</p>
  <p class="small">데스: 한타 첫 데스 1.5 · 한타도 아닌데 혼자 잡힘 1.3 · 열세에서 추가 데스 1.1 · 일반 1.0 · 이긴 한타 뒤 0.5 · 진 한타 뒤 리스폰 맞추기 0.1</p>
  <p class="small">피해·치유: 동수·열세 한타 ×1.0 · 우세 ×0.75 · 결정된 한타 ×0.25 · 한타 밖 ×0.5 &nbsp;|&nbsp; 궁극기: 쓰기 전후 한타 승리 가능성 변화 50% · 궁으로 직접 처치 30% · 충전 뒤 사용 효율 20%</p>
  <p class="small muted">리그의 실제 계산식은 공개되지 않아서, 우리 내전에 맞춰 조정해 가는 기준이에요.</p>
</details>`;
}

// ---------- 표 정렬 (내림차순 ↔ 오름차순) ----------
/** 눌러서 정렬하는 표 머리글. 같은 칸을 다시 누르면 방향이 바뀐다. */
export function sortTh(ctx, key, label, { def, cls = '' } = {}) {
  const current = ctx.sorts?.[0] || { key: def, dir: 'desc' };
  const active = current.key === key;
  const dir = active ? current.dir : null;
  const q = new URLSearchParams();
  if (ctx.owTab && ctx.owTab !== 'all') q.set('f', ctx.owTab);
  q.set('sort', `${key}.${active && dir === 'desc' ? 'asc' : 'desc'}`);
  const arrow = active ? (dir === 'asc' ? '▲' : '▼') : '↕';
  return html`<th class="${cls} sortable ${active ? 'sorted' : ''}" aria-sort="${active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><a href="?${q}" title="눌러서 정렬">${label}<span class="arrow">${arrow}</span></a></th>`;
}

/** fns: { 키: 행 → 숫자 }. 기본은 def 키 내림차순. 같으면 판수 많은 순, 그래도 같으면 승률 높은 순. */
export function sortRows(rows, ctx, fns, def) {
  const chosen = ctx.sorts?.[0];
  const { key, dir } = chosen && fns[chosen.key] ? chosen : { key: def, dir: 'desc' };
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort(
    (a, b) => sign * (fns[key](a) - fns[key](b)) || (b.games || 0) - (a.games || 0) || (b.winRate || 0) - (a.winRate || 0),
  );
}

/** 내전 목록을 날짜별로 묶는다. rowFn(match) → 한 줄 */
export function groupedByDay(ctx, matches, rowFn) {
  let lastDay = null;
  return matches.map((m) => {
    const day = ctx.dates.day(m.createdAt);
    const header = day !== lastDay ? html`<h3 class="day">${day}</h3>` : '';
    lastDay = day;
    return html`${header}${rowFn(m)}`;
  });
}
