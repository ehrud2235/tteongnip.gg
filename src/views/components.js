import { html, raw } from '../util/html.js';
import { POSITION_NAMES, fmtAvg, fmtPct, fmtRatio, fmtSigned, kdaRatio, winRate } from '../util/format.js';
import { START_RATING } from '../stats.js';

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
export function pirCell(entry) {
  if (!entry) return '';
  const cls = entry.pir >= 130 ? 'great' : entry.pir >= 100 ? 'good' : entry.pir < 70 ? 'low' : '';
  return html`<span class="pir ${cls}" title="PIR ${entry.pir} · 이 판 ${entry.rank}위 (평균 100)">${entry.pir}</span><small>${entry.rank}위</small>`;
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
