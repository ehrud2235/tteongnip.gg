// 오버워치 화면: 랭킹, 최근 내전, 내전 상세, 개인 페이지, 영웅 통계
import { html } from '../util/html.js';
import { fmtAvg, fmtDuration, fmtNum, fmtPct } from '../util/format.js';
import { relationList } from '../stats.js';
import { FORMAT_NAMES, matchHighlights, owFormat, ROLE_NAMES } from '../overwatch.js';
import { OW_PIR_WEIGHTS, owMatchPir } from '../pir.js';
import { layout } from './pages.js';
import {
  delta,
  emptyState,
  fmtPlayTime,
  heroIcon,
  mvpBadge,
  pirCell,
  pirExplainer,
  owMatchUrl,
  owPlayerName,
  owPlayerUrl,
  ratingChart,
  resultDots,
  roleBadge,
  streakBadge,
  titleBadges,
  winRateCell,
} from './components.js';

const page = (ctx, opts) => layout(ctx, { ...opts, game: 'ow' });

const tabQuery = (ctx, extra = '') => {
  const q = [ctx.owTab !== 'all' ? `f=${ctx.owTab}` : '', extra].filter(Boolean).join('&');
  return q ? `?${q}` : '';
};

/** 전체 / 5대5 / 6대6 탭. 탭마다 그 판들로만 따로 계산한다. */
function formatTabs(ctx, basePath) {
  return html`<nav class="tabs" aria-label="인원">${['all', '5v5', '6v6'].map((key) => {
    const count = ctx.data.ow[key].matches.length;
    return html`<a href="${basePath}${key === 'all' ? '' : `?f=${key}`}" ${ctx.owTab === key ? html`aria-current="page"` : ''}>${FORMAT_NAMES[key]} <small>${count}</small></a>`;
  })}</nav>`;
}

/** 처치 / 도움 / 죽음 (여러 판이면 평균) */
function eadCell(e, a, d, games = 1) {
  const v = (x) => (games > 1 ? fmtAvg(x / games) : String(x));
  return html`<div class="kda"><span>${v(e)} / ${v(a)} / <em>${v(d)}</em></span></div>`;
}

function topHeroes(s, n = 3) {
  return [...s.heroes.values()].filter((h) => h.games > 0).sort((a, b) => b.games - a.games || b.seconds - a.seconds).slice(0, n);
}

function card(ctx, m) {
  const team = (t) => m.players.filter((p) => p.team === t);
  const label = (t) => (m.winner === t ? '승리' : m.winner === 0 ? '승패 미정' : '패배');
  return html`<a class="mcard" href="${owMatchUrl(m.id)}">
    <div class="mc-meta"><span class="fmt">${FORMAT_NAMES[owFormat(m)]}</span><b>${m.map || '맵 모름'}</b><span>${m.mode}</span><span>${ctx.dates.ago(m.createdAt)}</span><span>${fmtDuration(m.duration)}</span><span class="mc-score">${m.score[0]} : ${m.score[1]}</span></div>
    <div class="mc-teams">${[1, 2].map(
      (t) => html`<div class="mc-team ${m.winner === t ? 'won' : m.winner === 0 ? 'draw' : 'lost'}">
        <span class="mc-label">${t}팀 · ${label(t)}</span>
        <ul>${team(t).map((p) => html`<li>${roleBadge(p.role)}<span class="mc-name" title="${p.name}">${p.name}</span>${heroIcon(ctx.owh, p.hero, 20, { fallback: 'text', cls: 'mc-hero' })}</li>`)}</ul>
      </div>`,
    )}</div>
  </a>`;
}

export function owRankingPage(ctx) {
  const { stats, matches } = ctx.ow;
  if (!stats.totalMatches) {
    return page(ctx, {
      title: '오버워치 랭킹',
      active: 'ranking',
      body: html`<h1>오버워치 내전 랭킹</h1>${formatTabs(ctx, '/ow')}${emptyState(
        '아직 기록된 오버워치 내전이 없어요',
        html`방장이 커스텀 게임에 떡잎.gg 워크샵 스크립트를 넣고 <a href="/collector#overwatch">수집기</a>를 켜두면 자동으로 기록돼요.`,
      )}`,
    });
  }
  const row = (s) => html`<tr>
    <td class="rank ${s.rank && s.rank <= 3 ? `r${s.rank}` : ''}">${s.rank ?? '-'}</td>
    <td><div class="who">${owPlayerName(s, { linkedName: ctx.linkedName(s.key) })}${streakBadge(s.streak)}${titleBadges(s.titles.slice(0, 1))}</div></td>
    <td class="num rating"><b>${s.rating}</b></td>
    <td class="rec hide-sm">${s.wins}승 ${s.losses}패${s.draws ? ` ${s.draws}무` : ''}</td>
    <td>${winRateCell(s.wins, s.games)}</td>
    <td class="hide-sm">${eadCell(s.elims, s.assists, s.deaths, s.games)}</td>
    <td class="num hide-sm"><span class="pir ${s.avgPir >= 110 ? 'good' : ''}">${s.avgPir}</span><small>MVP ${s.mvp}</small></td>
    <td class="hide-md num">${fmtNum(s.per10.damage)}${s.per10.healing >= 1 ? html`<small>치유 ${fmtNum(s.per10.healing)}</small>` : ''}</td>
    <td>${roleBadge(s.mainRole)}</td>
    <td class="hide-sm"><div class="most">${topHeroes(s).map((h) => heroIcon(ctx.owh, h.hero, 26))}</div></td>
    <td class="hide-md">${resultDots(s.recent)}</td>
  </tr>`;
  const table = (rows) => html`<div class="table-wrap"><table class="rank-table">
    <thead><tr><th>#</th><th>플레이어</th><th class="num">점수</th><th class="hide-sm">전적</th><th>승률</th><th class="hide-sm">처치/도움/죽음</th><th class="num hide-sm">평균 PIR</th><th class="hide-md num">10분당 피해</th><th>역할</th><th class="hide-sm">모스트</th><th class="hide-md">최근 10판</th></tr></thead>
    <tbody>${rows.map(row)}</tbody>
  </table></div>`;
  const top = stats.ranked[0];
  return page(ctx, {
    title: '오버워치 랭킹',
    active: 'ranking',
    body: html`
<h1>오버워치 내전 랭킹</h1>
${formatTabs(ctx, '/ow')}
<div class="cards">
  <div class="card"><small>기록된 내전</small><b>${stats.totalMatches}판</b></div>
  <div class="card"><small>참가한 사람</small><b>${stats.players.size}명</b></div>
  <div class="card"><small>마지막 내전</small><b>${ctx.dates.ago(stats.lastMatchAt)}</b></div>
  <div class="card"><small>현재 1등</small><b>${top ? top.name : '-'}</b></div>
</div>
${stats.ranked.length ? table(stats.ranked) : html`<p class="muted">아직 ${stats.minRankedGames}판 이상 한 사람이 없어서 순위가 없어요.</p>`}
${stats.unranked.length ? html`<h2>배치 중 <small class="muted">${stats.minRankedGames}판부터 순위에 올라가요</small></h2>${table(stats.unranked)}` : ''}
<p class="muted small">점수는 롤과 따로 1000점에서 시작해요. 전체 · 5대5 · 6대6 탭은 각각 그 판들로만 따로 계산해요. 처치/도움/죽음은 한 판 평균, 피해·치유는 10분당 평균이에요.</p>
<h2>최근 내전 <a class="more" href="/ow/matches${tabQuery(ctx)}">전체 보기</a></h2>
<div class="mlist">${matches.slice(0, 4).map((m) => card(ctx, m))}</div>`,
  });
}

export function owMatchesPage(ctx, { matches, page: p, pages, showHidden }) {
  return page(ctx, {
    title: '오버워치 최근 내전',
    active: 'matches',
    body: html`
<h1>${showHidden ? '숨긴 오버워치 내전' : '오버워치 최근 내전'}</h1>
${formatTabs(ctx, '/ow/matches')}
${ctx.user?.isAdmin ? html`<p class="small"><a href="/ow/matches${tabQuery(ctx, showHidden ? '' : 'hidden=1')}">${showHidden ? '← 최근 내전으로' : '숨긴 내전 보기'}</a></p>` : ''}
${matches.length ? html`<div class="mlist">${matches.map((m) => card(ctx, m))}</div>` : emptyState('기록된 내전이 없어요', html`<a href="/collector#overwatch">수집기 안내</a>를 확인해 주세요.`)}
${pages > 1
  ? html`<nav class="pager" aria-label="페이지">${p > 1 ? html`<a href="${tabQuery(ctx, `page=${p - 1}${showHidden ? '&hidden=1' : ''}`)}">← 이전</a>` : html`<span></span>`}<span>${p} / ${pages}</span>${p < pages ? html`<a href="${tabQuery(ctx, `page=${p + 1}${showHidden ? '&hidden=1' : ''}`)}">다음 →</a>` : html`<span></span>`}</nav>`
  : ''}`,
  });
}

export function owMatchPage(ctx, m) {
  const d = ctx.data.ow[owFormat(m)].stats.deltas.get(m.id) || {};
  const highlights = matchHighlights(m);
  const pr = owMatchPir(m);
  const teamBox = (t) => {
    const team = m.players.filter((p) => p.team === t);
    const won = m.winner === t;
    const sum = (k) => team.reduce((a, p) => a + (p[k] || 0), 0);
    return html`<section class="team-box ${t === 1 ? 'blue' : 'red'} ${won ? 'won' : m.winner === 0 ? 'draw' : 'lost'}">
  <header>
    <h2>${won ? '승리' : m.winner === 0 ? '승패 미정' : '패배'} <small>${t}팀</small></h2>
    <div class="team-sum">처치 ${sum('elims')} · 피해 ${fmtNum(sum('damage'))} · 치유 ${fmtNum(sum('healing'))}</div>
  </header>
  <div class="table-wrap"><table class="mt">
    <thead><tr><th>플레이어</th><th>영웅</th><th>처치/도움/죽음</th><th class="num">피해</th><th class="num hide-sm">치유</th><th class="num hide-md">막은 피해</th><th class="num hide-md">궁</th><th class="num">PIR</th><th class="num">점수</th></tr></thead>
    <tbody>${team.map(
      (p) => html`<tr>
      <td><div class="who">${roleBadge(p.role)}${owPlayerName(p, { linkedName: ctx.linkedName(p.key) })}${mvpBadge(pr.get(p.key))}</div></td>
      <td><div class="hero-cell">${heroIcon(ctx.owh, p.hero, 32, { fallback: 'none' })}<div><span class="hero-main">${p.hero}</span>${p.heroes.length > 1 ? html`<span class="hero-more" title="${p.heroes.map((h) => `${h.hero} ${fmtPlayTime(h.seconds)}`).join(', ')}">${p.heroes.slice(1).map((h) => heroIcon(ctx.owh, h.hero, 16, { fallback: 'text' }))}</span>` : ''}</div></div></td>
      <td>${eadCell(p.elims, p.assists, p.deaths)}</td>
      <td class="num">${fmtNum(p.damage)}</td>
      <td class="num hide-sm">${fmtNum(p.healing)}</td>
      <td class="num hide-md">${fmtNum(p.blocked)}</td>
      <td class="num hide-md">${p.ults}</td>
      <td class="num">${pirCell(pr.get(p.key))}</td>
      <td class="num">${delta(d[p.key])}</td>
    </tr>`,
    )}</tbody>
  </table></div>
</section>`;
  };

  return page(ctx, {
    title: `오버워치 · ${m.map} ${ctx.dates.date(m.createdAt)}`,
    active: 'matches',
    body: html`
${m.meta?.hidden ? html`<p class="notice warn">숨긴 내전이에요. 랭킹과 전적에 들어가지 않아요.</p>` : ''}
<div class="match-head">
  <h1>${m.map || '맵 모름'} <small>${FORMAT_NAMES[owFormat(m)]} · ${m.mode} · ${fmtDuration(m.duration)}</small></h1>
  <p class="muted">${ctx.dates.date(m.createdAt)}${ctx.uploaderName ? ` · 올린 사람 ${ctx.uploaderName}` : ''}</p>
</div>
<div class="scoreline">
  <span class="${m.winner === 1 ? 'won' : ''}">1팀${m.winner === 1 ? ' 승리' : ''}</span><b>${m.score[0]} : ${m.score[1]}</b><span class="${m.winner === 2 ? 'won' : ''}">${m.winner === 2 ? '승리 ' : ''}2팀</span>
</div>
${m.winnerSource === 'objective' ? html`<p class="muted small center">팀 점수가 같아서 경기 끝 순간의 화물 진행도로 승패를 판정했어요.</p>` : ''}
${m.winnerSource === 'manual' ? html`<p class="muted small center">승패를 직접 정한 판이에요.</p>` : ''}
${m.winner === 0 && ctx.user ? html`<p class="notice warn">승패를 알 수 없는 판이에요. 이긴 팀을 골라주면 랭킹에 반영돼요. (아래 <b>승패 정하기</b>)</p>` : ''}
${highlights.length
  ? html`<div class="panel highlights"><h3>이 판의 명장면 · 흑역사</h3><ul>${highlights.map(
      (h) => html`<li class="${h.kind}"><span class="hl-icon" aria-hidden="true">${h.icon}</span>${heroIcon(ctx.owh, h.who.hero, 20, { fallback: 'none' })}${owPlayerName(h.who)}<span>${h.text}</span></li>`,
    )}</ul></div>`
  : ''}
${teamBox(1)}
${teamBox(2)}
${pirExplainer(OW_PIR_WEIGHTS)}
${ctx.user && (m.winnerSource !== 'score' || ctx.user.isAdmin)
  ? html`<details class="edit" ${m.winner === 0 ? html`open` : ''}>
  <summary>승패 정하기${m.winner === 0 ? '' : ' (틀렸을 때)'}</summary>
  <form method="post" action="${owMatchUrl(m.id)}/winner" class="winner-form">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button class="btn" name="winner" value="1" type="submit">1팀 승리</button>
    <button class="btn" name="winner" value="2" type="submit">2팀 승리</button>
    <button class="btn" name="winner" value="0" type="submit">무승부</button>
  </form>
</details>`
  : ''}
${ctx.user?.isAdmin
  ? html`<form method="post" action="/matches/${encodeURIComponent(m.id)}/${m.meta?.hidden ? 'unhide' : 'hide'}" class="admin-row">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <span class="muted small">관리자</span>
  <button class="btn ${m.meta?.hidden ? '' : 'danger'}" type="submit">${m.meta?.hidden ? '다시 보이기' : '이 내전 숨기기 (기록에서 빼기)'}</button>
</form>`
  : ''}`,
  });
}

// 영웅별 특수 기록
function heroSpecial(h) {
  if (h.hero === '아나' && h.games) {
    const acc = h.sleepShots ? Math.min(100, Math.round((h.sleeps / h.sleepShots) * 100)) : null;
    return `판당 ${fmtAvg(h.sleeps / h.games)}명 재움${acc != null ? ` · 수면총 명중률 ${acc}%` : ''}`;
  }
  if (h.hero === '메르시' && h.games) return `판당 부활 ${fmtAvg(h.rez / h.games)}번`;
  return '';
}

const FUN_LABELS = [
  ['sleeps', '🛌', '수면총으로 재운 횟수'],
  ['rez', '😇', '부활시킨 횟수'],
  ['ultKills', '⚡', '궁으로 처치'],
  ['meleeKills', '👊', '근접 공격 마무리'],
  ['envKills', '👋', '맵 밖으로 배웅'],
  ['slept', '😴', '잠든 횟수'],
  ['ultDeaths', '💥', '궁 쓰고 3초 안에 사망'],
  ['envDeaths', '🕳️', '낙사'],
];

export function owPlayerPage(ctx, s) {
  const { data } = ctx;
  const { stats } = ctx.ow;
  const link = data.links.get(s.key);
  const linkedName = ctx.linkedName(s.key);
  const mine = link && ctx.user && link.discordId === ctx.user.uid;
  const tenMin = Math.max(1, s.seconds / 600);
  const heroes = [...s.heroes.values()].sort((a, b) => b.games - a.games || b.seconds - a.seconds);
  const roles = ['TANK', 'DAMAGE', 'SUPPORT'].filter((r) => s.roles.has(r)).map((r) => [r, s.roles.get(r)]);
  const mates = relationList(s.mates, stats.players);
  const opps = relationList(s.opponents, stats.players);
  const fun = FUN_LABELS.filter(([k]) => s.fun[k] > 0);
  const relTable = (title, rows, empty) => html`<div class="panel">
    <h3>${title}</h3>
    ${rows.length
      ? html`<ul class="rel">${rows.map(
          (r) => html`<li>${owPlayerName(r.player || { key: r.puuid, name: '?' })}<span class="muted">${r.wins}승 ${r.games - r.wins}패</span>${winRateCell(r.wins, r.games)}</li>`,
        )}</ul>`
      : html`<p class="muted small">${empty}</p>`}
  </div>`;
  const recent = s.history.slice(-30).reverse();
  const recentRow = (h) => {
    const m = data.byId.get(h.matchId);
    const p = m?.players.find((x) => x.key === s.key);
    if (!m || !p) return '';
    return html`<a class="prow ${h.draw ? '' : h.win ? 'w' : 'l'}" href="${owMatchUrl(m.id)}">
      <div class="pr-res"><b>${h.draw ? '승패 미정' : h.win ? '승리' : '패배'}</b><small>${ctx.dates.ago(m.createdAt)}</small><small>${fmtDuration(m.duration)}</small></div>
      <div class="pr-champ">${heroIcon(ctx.owh, p.hero, 40, { fallback: 'none' })}<div><span class="hero-main">${p.hero}</span><small class="muted">${m.map}</small></div></div>
      <div class="pr-kda">${eadCell(p.elims, p.assists, p.deaths)}<small class="pr-pir">PIR ${h.pir} · ${h.pirRank}위 ${h.mvp ? html`<span class="badge mvp">MVP</span>` : h.ace ? html`<span class="badge ace">ACE</span>` : ''}</small></div>
      <div class="pr-misc hide-sm"><span>피해 ${fmtNum(p.damage)}</span><span>치유 ${fmtNum(p.healing)}</span></div>
      <div class="pr-items hide-sm muted small">${m.score[0]} : ${m.score[1]}</div>
      <div class="pr-delta">${delta(h.delta)}</div>
    </a>`;
  };

  return page(ctx, {
    title: s.name,
    active: 'ranking',
    body: html`
${formatTabs(ctx, owPlayerUrl(s.key))}
<section class="profile">
  <div class="profile-main">
    <h1>${s.name}</h1>
    ${s.titles.length ? html`<div class="titles">${titleBadges(s.titles)}</div>` : ''}
    <p class="muted">${linkedName ? html`디스코드 <b>@${linkedName}</b> · ` : ''}${s.rank ? html`<b class="accent">${s.rank}위</b>` : html`배치 중 (${s.games}/${stats.minRankedGames}판)`} · 주 역할 ${ROLE_NAMES[s.mainRole] || '-'} · 마지막 내전 ${ctx.dates.ago(s.lastPlayed)}</p>
    <div class="link-row">
      ${ctx.user && !link ? html`<form method="post" action="${owPlayerUrl(s.key)}/link"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button class="btn" type="submit">내 오버워치 계정이에요</button></form>` : ''}
      ${link && (mine || ctx.user?.isAdmin) ? html`<form method="post" action="${owPlayerUrl(s.key)}/unlink"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button class="link-btn" type="submit">디스코드 연결 끊기</button></form>` : ''}
    </div>
  </div>
  <div class="profile-score">
    <div><small>점수</small><b>${s.rating}</b><small class="muted">최고 ${s.peak}</small></div>
    <div><small>전적</small><b>${s.wins}승 ${s.losses}패${s.draws ? ` ${s.draws}무` : ''}</b>${winRateCell(s.wins, s.games)}</div>
    <div><small>최근</small>${resultDots(s.recent)}${streakBadge(s.streak)}</div>
  </div>
</section>
${s.history.length >= 2 ? html`<div class="panel"><h3>점수 변화</h3>${ratingChart(s.history)}</div>` : ''}
<div class="cards">
  <div class="card"><small>평균 처치/도움/죽음</small>${eadCell(s.elims, s.assists, s.deaths, s.games)}</div>
  <div class="card"><small>평균 PIR <span class="muted">(판 평균 100)</span></small><b>${s.avgPir}</b><small class="muted">MVP ${s.mvp} · ACE ${s.ace} · 평균 ${fmtAvg(s.avgPirRank)}위</small></div>
  <div class="card"><small>10분당 피해</small><b>${fmtNum(s.damage / tenMin)}</b></div>
  <div class="card"><small>10분당 치유</small><b>${fmtNum(s.healing / tenMin)}</b></div>
  <div class="card"><small>10분당 막은 피해</small><b>${fmtNum(s.blocked / tenMin)}</b></div>
  <div class="card"><small>총 플레이 시간</small><b>${fmtPlayTime(s.seconds)}</b></div>
</div>
${fun.length
  ? html`<div class="panel"><h3>기록실 <small class="muted">누적</small></h3><div class="fun-grid">${fun.map(
      ([k, icon, label]) => html`<div class="fun"><span aria-hidden="true">${icon}</span><b>${s.fun[k]}</b><small>${label}</small></div>`,
    )}</div></div>`
  : ''}
<div class="grid2">
  <div class="panel span2">
    <h3>영웅</h3>
    <div class="table-wrap"><table class="small-table">
      <thead><tr><th>영웅</th><th class="num">판수</th><th>승률</th><th class="num hide-sm">플레이 시간</th><th>평균 처치/도움/죽음</th><th class="hide-sm">특수 기록</th></tr></thead>
      <tbody>${heroes.slice(0, 12).map(
        (h) => html`<tr><td><div class="champ-name">${heroIcon(ctx.owh, h.hero, 24, { fallback: 'none' })}${roleBadge(h.role)}<span>${h.hero}</span></div></td><td class="num">${h.games}</td><td>${h.games ? winRateCell(h.wins, h.games) : html`<span class="muted small">잠깐 플레이</span>`}</td><td class="num hide-sm">${fmtPlayTime(h.seconds)}</td><td>${h.games ? eadCell(h.elims, h.assists, h.deaths, h.games) : ''}</td><td class="hide-sm small muted">${heroSpecial(h)}</td></tr>`,
      )}</tbody>
    </table></div>
  </div>
  <div class="panel">
    <h3>역할</h3>
    ${roles.length
      ? html`<div class="table-wrap"><table class="small-table"><thead><tr><th>역할</th><th class="num">판수</th><th>승률</th></tr></thead>
        <tbody>${roles.map(([r, v]) => html`<tr><td><div class="champ-name">${roleBadge(r)}<span>${ROLE_NAMES[r]}</span></div></td><td class="num">${v.games}</td><td>${winRateCell(v.wins, v.games)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted small">역할 기록이 없어요.</p>`}
  </div>
  ${relTable('같은 팀일 때 잘 이기는 사람', mates.slice(0, 5), '같은 팀으로 2판 이상 한 사람이 아직 없어요.')}
  ${relTable('같은 팀일 때 잘 지는 사람', mates.length > 5 ? mates.slice(-5).reverse() : [], '기록이 더 쌓이면 보여요.')}
  ${relTable('상대로 만나면 잘 이기는 사람', opps.slice(0, 5), '상대로 2판 이상 만난 사람이 아직 없어요.')}
  ${relTable('천적 (상대로 만나면 잘 지는 사람)', opps.length > 5 ? opps.slice(-5).reverse() : [], '기록이 더 쌓이면 보여요.')}
</div>
<h2>최근 내전</h2>
<div class="plist">${recent.map(recentRow)}</div>`,
  });
}

export function owHeroesPage(ctx) {
  const { stats } = ctx.ow;
  const total = Math.max(1, stats.totalMatches);
  return page(ctx, {
    title: '오버워치 영웅',
    active: 'heroes',
    body: html`
<h1>영웅 통계 <small class="muted">우리 내전 ${stats.totalMatches}판 기준 · 가장 오래 한 영웅으로 계산</small></h1>
${formatTabs(ctx, '/ow/heroes')}
${stats.heroes.length
  ? html`<div class="table-wrap"><table class="rank-table">
  <thead><tr><th>영웅</th><th class="num">판수</th><th class="num hide-sm">픽률</th><th>승률</th><th class="num hide-sm">플레이 시간</th><th class="hide-sm">제일 많이 한 사람</th></tr></thead>
  <tbody>${stats.heroes.map((h) => {
    const [bestKey, bestGames] = [...h.players.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    const best = bestKey ? stats.players.get(bestKey) : null;
    return html`<tr>
      <td><div class="champ-name">${heroIcon(ctx.owh, h.hero, 28, { fallback: 'none' })}${roleBadge(h.role)}<span>${h.hero}</span></div></td>
      <td class="num">${h.games}</td>
      <td class="num hide-sm">${fmtPct(h.games, total)}</td>
      <td>${h.games ? winRateCell(h.wins, h.games) : html`<span class="muted">-</span>`}</td>
      <td class="num hide-sm">${fmtPlayTime(h.seconds)}</td>
      <td class="hide-sm">${best ? html`${owPlayerName(best)} <small class="muted">${bestGames}판</small>` : ''}</td>
    </tr>`;
  })}</tbody>
</table></div>`
  : emptyState('아직 기록이 없어요', '내전이 기록되면 영웅별 승률이 보여요.')}`,
  });
}

/** 5대5/6대6 탭에서 한 판도 없는 사람 */
export function owPlayerEmptyPage(ctx, s) {
  return page(ctx, {
    title: s.name,
    active: 'ranking',
    body: html`${formatTabs(ctx, owPlayerUrl(s.key))}
<h1>${s.name}</h1>
${emptyState(`${FORMAT_NAMES[ctx.owTab]} 기록이 없어요`, html`<a href="${owPlayerUrl(s.key)}">전체 기록 보기</a>`)}`,
  });
}
