import { html } from '../util/html.js';
import {
  POSITION_NAMES,
  fmtAvg,
  fmtDuration,
  fmtNum,
  fmtPct,
  kdaRatio,
  modeName,
} from '../util/format.js';
import { relationList } from '../stats.js';
import { POSITIONS } from '../positions.js';
import {
  bar,
  champIcon,
  delta,
  emptyState,
  itemIcons,
  kdaCell,
  matchUrl,
  owPlayerName,
  playerName,
  playerUrl,
  posBadge,
  ratingChart,
  resultDots,
  runeIcons,
  spellIcons,
  streakBadge,
  winRateCell,
} from './components.js';

const RIOT_NOTICE =
  "isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

const NAV = {
  lol: [
    ['/', '랭킹', 'ranking'],
    ['/matches', '최근 내전', 'matches'],
    ['/champions', '챔피언', 'champions'],
  ],
  ow: [
    ['/ow', '랭킹', 'ranking'],
    ['/ow/matches', '최근 내전', 'matches'],
    ['/ow/heroes', '영웅', 'heroes'],
  ],
};

export function layout(ctx, { title, active = '', body, bare = false, game = 'lol' }) {
  const { config, user } = ctx;
  const nav = [...(NAV[game] || NAV.lol), ['/collector', '수집기', 'collector']];
  const me = user
    ? user.dev
      ? html`<span class="me-dev" title="디스코드 로그인 설정 전이라 모두가 관리자예요">개발 모드</span>`
      : html`<span class="me-name">${user.avatar ? html`<img src="${user.avatar}" alt="" width="24" height="24">` : ''}${user.name}</span>
          <form method="post" action="/logout"><button class="link-btn" type="submit">로그아웃</button></form>`
    : '';
  return html`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>${title ? `${title} · ${config.siteName}` : config.siteName}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/style.css?v=${ctx.assetVersion}">
</head>
<body>
<header class="top">
  <div class="wrap top-in">
    <a class="logo" href="/"><img src="/static/favicon.svg" alt="" width="24" height="24"><span>${config.siteName}</span></a>
    ${bare
      ? ''
      : html`<nav class="games" aria-label="게임">
      <a href="/" class="game-lol" ${game === 'lol' ? html`aria-current="true"` : ''}>리그 오브 레전드</a>
      <a href="/ow" class="game-ow" ${game === 'ow' ? html`aria-current="true"` : ''}>오버워치</a>
    </nav>
    <nav class="nav" aria-label="메뉴">${nav.map(
          ([href, label, key]) => html`<a href="${href}" ${active === key ? html`aria-current="page"` : ''}>${label}</a>`,
        )}</nav>
    <form class="search" action="/search" role="search"><input type="search" name="q" placeholder="플레이어 검색" aria-label="플레이어 검색" value="${ctx.query || ''}"></form>`}
    <div class="me">${me}</div>
  </div>
</header>
${!config.authEnabled && !bare
  ? html`<div class="wrap"><p class="notice warn">디스코드 로그인이 아직 설정되지 않아서 주소를 아는 누구나 볼 수 있어요. README의 <b>디스코드 연결</b>을 따라 설정해 주세요.</p></div>`
  : ''}
<main class="wrap">
${body}
</main>
<footer class="wrap foot">
  <p>우리 디스코드 서버 전용 내전 기록 · 챔피언·아이템 이미지: Riot Games Data Dragon</p>
  <p class="legal">${config.siteName} ${RIOT_NOTICE}</p>
</footer>
</body>
</html>`;
}

function topChampions(s, n = 3) {
  return [...s.champions.entries()].sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins).slice(0, n);
}

function matchCard(ctx, m) {
  const team = (teamId) => m.players.filter((p) => p.teamId === teamId);
  return html`<a class="mcard" href="${matchUrl(m.id)}">
    <div class="mc-meta"><b>${modeName(m.mode)}</b><span>${ctx.dates.ago(m.createdAt)}</span><span>${fmtDuration(m.duration)}</span></div>
    <div class="mc-teams">${[100, 200].map(
      (t) => html`<div class="mc-team ${t === 100 ? 'blue' : 'red'} ${m.winner === t ? 'won' : 'lost'}">
        <span class="mc-label">${t === 100 ? '블루' : '레드'} · ${m.winner === t ? '승리' : '패배'}</span>
        <ul>${team(t).map((p) => html`<li>${champIcon(ctx.dd, p.championId, 20)}<span title="${p.name}${p.tag ? `#${p.tag}` : ''}">${p.name}</span></li>`)}</ul>
      </div>`,
    )}</div>
  </a>`;
}

export function rankingPage(ctx) {
  const { stats, matches } = ctx.data;
  if (!stats.totalMatches) {
    return layout(ctx, {
      title: '랭킹',
      active: 'ranking',
      body: html`<h1>내전 랭킹</h1>${emptyState(
        '아직 기록된 내전이 없어요',
        html`내전에 참가하는 사람 중 한 명이 <a href="/collector">수집기</a>를 켜두면 게임이 끝날 때마다 자동으로 기록돼요.`,
      )}`,
    });
  }
  const top = stats.ranked[0];
  const row = (s) => html`<tr>
    <td class="rank ${s.rank && s.rank <= 3 ? `r${s.rank}` : ''}">${s.rank ?? '-'}</td>
    <td><div class="who">${playerName(s, { linkedName: ctx.linkedName(s.puuid) })}${streakBadge(s.streak)}</div></td>
    <td class="num rating"><b>${s.rating}</b></td>
    <td class="rec hide-sm">${s.wins}승 ${s.losses}패</td>
    <td>${winRateCell(s.wins, s.games)}</td>
    <td class="hide-sm">${kdaCell(s.kills, s.deaths, s.assists, s.games)}</td>
    <td class="hide-sm"><div class="most">${topChampions(s).map(([id]) => champIcon(ctx.dd, id, 26))}</div></td>
    <td class="hide-md">${resultDots(s.recent)}</td>
  </tr>`;
  const table = (rows) => html`<div class="table-wrap"><table class="rank-table">
    <thead><tr><th>#</th><th>플레이어</th><th class="num">점수</th><th class="hide-sm">전적</th><th>승률</th><th class="hide-sm">KDA</th><th class="hide-sm">모스트</th><th class="hide-md">최근 10판</th></tr></thead>
    <tbody>${rows.map(row)}</tbody>
  </table></div>`;

  return layout(ctx, {
    title: '랭킹',
    active: 'ranking',
    body: html`
<h1>내전 랭킹</h1>
<div class="cards">
  <div class="card"><small>기록된 내전</small><b>${stats.totalMatches}판</b></div>
  <div class="card"><small>참가한 사람</small><b>${stats.players.size}명</b></div>
  <div class="card"><small>마지막 내전</small><b>${ctx.dates.ago(stats.lastMatchAt)}</b></div>
  <div class="card"><small>현재 1등</small><b>${top ? top.name : '-'}</b></div>
</div>
${stats.ranked.length
  ? table(stats.ranked)
  : html`<p class="muted">아직 ${stats.minRankedGames}판 이상 한 사람이 없어서 순위가 없어요.</p>`}
${stats.unranked.length
  ? html`<h2>배치 중 <small class="muted">${stats.minRankedGames}판부터 순위에 올라가요</small></h2>${table(stats.unranked)}`
  : ''}
<p class="muted small">점수는 1000점에서 시작해요. 우리 팀 평균 점수가 상대보다 낮은데 이기면 많이 오르고, 높은데 지면 많이 내려가요. 팀이 매번 바뀌어도 개인 점수로 쌓여요.</p>
<h2>최근 내전 <a class="more" href="/matches">전체 보기</a></h2>
<div class="mlist">${matches.slice(0, 4).map((m) => matchCard(ctx, m))}</div>`,
  });
}

export function matchesPage(ctx, { matches, page, pages, showHidden }) {
  return layout(ctx, {
    title: '최근 내전',
    active: 'matches',
    body: html`
<h1>${showHidden ? '숨긴 내전' : '최근 내전'}</h1>
${ctx.user?.isAdmin
  ? html`<p class="small"><a href="${showHidden ? '/matches' : '/matches?hidden=1'}">${showHidden ? '← 최근 내전으로' : '숨긴 내전 보기'}</a></p>`
  : ''}
${matches.length
  ? html`<div class="mlist">${matches.map((m) => matchCard(ctx, m))}</div>`
  : emptyState(showHidden ? '숨긴 내전이 없어요' : '아직 기록된 내전이 없어요', html`<a href="/collector">수집기</a>를 켜두면 자동으로 기록돼요.`)}
${pages > 1
  ? html`<nav class="pager" aria-label="페이지">${page > 1 ? html`<a href="?page=${page - 1}${showHidden ? '&hidden=1' : ''}">← 이전</a>` : html`<span></span>`}<span>${page} / ${pages}</span>${page < pages ? html`<a href="?page=${page + 1}${showHidden ? '&hidden=1' : ''}">다음 →</a>` : html`<span></span>`}</nav>`
  : ''}`,
  });
}

/** 간단한 활약 점수로 이긴 팀 MVP, 진 팀 에이스를 고른다. */
function pickMvp(m) {
  const score = {};
  for (const teamId of [100, 200]) {
    const team = m.players.filter((p) => p.teamId === teamId);
    const kills = Math.max(1, team.reduce((a, p) => a + p.kills, 0));
    const dmg = Math.max(1, team.reduce((a, p) => a + p.damage, 0));
    for (const p of team) {
      const kda = Math.min(10, kdaRatio(p.kills, p.deaths, p.assists));
      score[p.puuid] = kda + ((p.kills + p.assists) / kills) * 6 + (p.damage / dmg) * 8 + p.vision / 40;
    }
  }
  const best = (teamId) =>
    m.players.filter((p) => p.teamId === teamId).sort((a, b) => score[b.puuid] - score[a.puuid])[0]?.puuid;
  const loser = m.winner === 100 ? 200 : 100;
  return { mvp: best(m.winner), ace: best(loser) };
}

export function matchPage(ctx, m) {
  const { dd } = ctx;
  const d = ctx.data.stats.deltas.get(m.id) || {};
  const maxDmg = Math.max(1, ...m.players.map((p) => p.damage));
  const minutes = Math.max(1, m.duration / 60);
  const { mvp, ace } = pickMvp(m);
  const teamBox = (teamId) => {
    const team = m.players.filter((p) => p.teamId === teamId);
    const won = m.winner === teamId;
    const info = (m.teams || []).find((t) => t.teamId === teamId) || {};
    const kills = team.reduce((a, p) => a + p.kills, 0);
    const gold = team.reduce((a, p) => a + p.gold, 0);
    return html`<section class="team-box ${teamId === 100 ? 'blue' : 'red'} ${won ? 'won' : 'lost'}">
  <header>
    <h2>${won ? '승리' : '패배'} <small>${teamId === 100 ? '블루팀' : '레드팀'}</small></h2>
    <div class="team-sum">${kills}킬 · ${fmtNum(gold)}골드${info.towers != null ? ` · 포탑 ${info.towers} · 용 ${info.dragons} · 바론 ${info.barons}` : ''}</div>
    ${info.bans?.length ? html`<div class="bans"><small>밴</small>${info.bans.map((id) => champIcon(dd, id, 20))}</div>` : ''}
  </header>
  <div class="table-wrap"><table class="mt">
    <thead><tr><th>챔피언</th><th>플레이어</th><th>KDA</th><th class="hide-sm">피해량</th><th class="num">CS</th><th class="num hide-sm">골드</th><th class="num hide-md">시야</th><th class="hide-sm">아이템</th><th class="num">점수</th></tr></thead>
    <tbody>${team.map((p) => {
      const kp = kills ? Math.min(100, Math.round(((p.kills + p.assists) / kills) * 100)) : 0;
      return html`<tr>
      <td><div class="champ"><span class="ci-wrap">${champIcon(dd, p.championId, 36)}<span class="lvl">${p.champLevel}</span></span>${spellIcons(dd, p.spells)}${runeIcons(dd, p.keystone, p.subStyle)}</div></td>
      <td><div class="who">${posBadge(p.position, p.positionManual)}${playerName(p, { linkedName: ctx.linkedName(p.puuid) })}${p.puuid === mvp ? html`<span class="badge mvp">MVP</span>` : ''}${p.puuid === ace ? html`<span class="badge ace">ACE</span>` : ''}</div></td>
      <td>${kdaCell(p.kills, p.deaths, p.assists)}<small class="kp">킬관여 ${kp}%</small></td>
      <td class="hide-sm dmg"><span>${fmtNum(p.damage)}</span>${bar((p.damage / maxDmg) * 100)}</td>
      <td class="num">${p.cs}<small>${(p.cs / minutes).toFixed(1)}/분</small></td>
      <td class="num hide-sm">${fmtNum(p.gold)}</td>
      <td class="num hide-md">${p.vision}</td>
      <td class="hide-sm">${itemIcons(dd, p.items)}</td>
      <td class="num">${delta(d[p.puuid])}</td>
    </tr>`;
    })}</tbody>
  </table></div>
</section>`;
  };

  const posOptions = (p) =>
    html`<option value="" ${!p.positionManual ? html`selected` : ''}>자동${p.autoPosition ? ` (${POSITION_NAMES[p.autoPosition]})` : ''}</option>${POSITIONS.map(
      (pos) => html`<option value="${pos}" ${p.positionManual && p.position === pos ? html`selected` : ''}>${POSITION_NAMES[pos]}</option>`,
    )}`;

  return layout(ctx, {
    title: `내전 ${ctx.dates.date(m.createdAt)}`,
    active: 'matches',
    body: html`
${m.meta?.hidden ? html`<p class="notice warn">숨긴 내전이에요. 랭킹과 전적에 들어가지 않아요.</p>` : ''}
<div class="match-head">
  <h1>${modeName(m.mode)} <small>${fmtDuration(m.duration)}</small></h1>
  <p class="muted">${ctx.dates.date(m.createdAt)} · 패치 ${m.version || '?'}${ctx.uploaderName ? ` · 올린 사람 ${ctx.uploaderName}` : ''}</p>
</div>
${teamBox(100)}
${teamBox(200)}
${m.mode === 'CLASSIC' && ctx.user
  ? html`<details class="edit">
  <summary>라인이 틀렸나요? 직접 고치기</summary>
  <form method="post" action="${matchUrl(m.id)}/positions" class="pos-form">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    ${m.players.map(
      (p) => html`<label class="${p.teamId === 100 ? 'blue' : 'red'}">${champIcon(dd, p.championId, 20)}<span>${p.name}</span>
        <select name="pos_${p.participantId}">${posOptions(p)}</select></label>`,
    )}
    <button class="btn" type="submit">저장</button>
  </form>
</details>`
  : ''}
${ctx.user?.isAdmin
  ? html`<form method="post" action="${matchUrl(m.id)}/${m.meta?.hidden ? 'unhide' : 'hide'}" class="admin-row">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <span class="muted small">관리자</span>
  <button class="btn ${m.meta?.hidden ? '' : 'danger'}" type="submit">${m.meta?.hidden ? '다시 보이기' : '이 내전 숨기기 (기록에서 빼기)'}</button>
</form>`
  : ''}`,
  });
}

export function playerPage(ctx, s) {
  const { dd, data } = ctx;
  const { stats } = data;
  const link = data.links.get(s.puuid);
  const linkedName = ctx.linkedName(s.puuid);
  const mine = link && ctx.user && link.discordId === ctx.user.uid;
  const minutes = Math.max(1, s.seconds / 60);

  const champRows = [...s.champions.entries()].sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins);
  const posRows = POSITIONS.filter((p) => s.positions.has(p)).map((p) => [p, s.positions.get(p)]);
  const mates = relationList(s.mates, stats.players);
  const opps = relationList(s.opponents, stats.players);
  const relTable = (title, rows, empty) => html`<div class="panel">
    <h3>${title}</h3>
    ${rows.length
      ? html`<ul class="rel">${rows.map(
          (r) => html`<li>${playerName(r.player || { puuid: r.puuid, name: '?' })}<span class="muted">${r.wins}승 ${r.games - r.wins}패</span>${winRateCell(r.wins, r.games)}</li>`,
        )}</ul>`
      : html`<p class="muted small">${empty}</p>`}
  </div>`;

  const recent = s.history.slice(-30).reverse();
  const recentRow = (h) => {
    const m = data.byId.get(h.matchId);
    const p = m?.players.find((x) => x.puuid === s.puuid);
    if (!m || !p) return '';
    return html`<a class="prow ${h.win ? 'w' : 'l'}" href="${matchUrl(m.id)}">
      <div class="pr-res"><b>${h.win ? '승리' : '패배'}</b><small>${ctx.dates.ago(m.createdAt)}</small><small>${fmtDuration(m.duration)}</small></div>
      <div class="pr-champ">${champIcon(dd, p.championId, 40)}<div>${spellIcons(dd, p.spells)}${posBadge(p.position, p.positionManual)}</div></div>
      <div class="pr-kda">${kdaCell(p.kills, p.deaths, p.assists)}</div>
      <div class="pr-misc hide-sm"><span>CS ${p.cs}</span><span>피해 ${fmtNum(p.damage)}</span></div>
      <div class="pr-items hide-sm">${itemIcons(dd, p.items)}</div>
      <div class="pr-delta">${delta(h.delta)}</div>
    </a>`;
  };

  return layout(ctx, {
    title: `${s.name}#${s.tag}`,
    active: 'ranking',
    body: html`
<section class="profile">
  <div class="profile-main">
    <h1>${s.name}<span class="tag">#${s.tag}</span></h1>
    <p class="muted">${linkedName ? html`디스코드 <b>@${linkedName}</b> · ` : ''}${s.rank ? html`<b class="accent">${s.rank}위</b>` : html`배치 중 (${s.games}/${stats.minRankedGames}판)`} · 마지막 내전 ${ctx.dates.ago(s.lastPlayed)}</p>
    <div class="link-row">
      ${ctx.user && !link
        ? html`<form method="post" action="${playerUrl(s.puuid)}/link"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button class="btn" type="submit">내 롤 계정이에요</button></form>`
        : ''}
      ${link && (mine || ctx.user?.isAdmin)
        ? html`<form method="post" action="${playerUrl(s.puuid)}/unlink"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button class="link-btn" type="submit">디스코드 연결 끊기</button></form>`
        : ''}
    </div>
  </div>
  <div class="profile-score">
    <div><small>점수</small><b>${s.rating}</b><small class="muted">최고 ${s.peak}</small></div>
    <div><small>전적</small><b>${s.wins}승 ${s.losses}패</b>${winRateCell(s.wins, s.games)}</div>
    <div><small>최근</small>${resultDots(s.recent)}${streakBadge(s.streak)}</div>
  </div>
</section>
${s.history.length >= 2 ? html`<div class="panel"><h3>점수 변화</h3>${ratingChart(s.history)}</div>` : ''}
<div class="cards">
  <div class="card"><small>평균 KDA</small>${kdaCell(s.kills, s.deaths, s.assists, s.games)}</div>
  <div class="card"><small>분당 CS</small><b>${fmtAvg(s.cs / minutes)}</b></div>
  <div class="card"><small>분당 피해량</small><b>${fmtNum(s.damage / minutes)}</b></div>
  <div class="card"><small>평균 시야 점수</small><b>${fmtAvg(s.vision / s.games)}</b></div>
  ${s.pentas ? html`<div class="card"><small>펜타킬</small><b>${s.pentas}번</b></div>` : ''}
</div>
<div class="grid2">
  <div class="panel span2">
    <h3>챔피언${champRows.length > 12 ? html` <small class="muted">많이 한 12개 (전체 ${champRows.length}개)</small>` : ''}</h3>
    <div class="table-wrap"><table class="small-table">
      <thead><tr><th>챔피언</th><th class="num">판수</th><th>승률</th><th>KDA</th></tr></thead>
      <tbody>${champRows.slice(0, 12).map(
        ([id, c]) => html`<tr><td><div class="champ-name">${champIcon(dd, id, 24)}<span>${dd.champion(id).name}</span></div></td><td class="num">${c.games}</td><td>${winRateCell(c.wins, c.games)}</td><td>${kdaCell(c.kills, c.deaths, c.assists, c.games)}</td></tr>`,
      )}</tbody>
    </table></div>
  </div>
  <div class="panel">
    <h3>라인</h3>
    ${posRows.length
      ? html`<div class="table-wrap"><table class="small-table">
      <thead><tr><th>라인</th><th class="num">판수</th><th>승률</th></tr></thead>
      <tbody>${posRows.map(([pos, r]) => html`<tr><td>${posBadge(pos)}</td><td class="num">${r.games}</td><td>${winRateCell(r.wins, r.games)}</td></tr>`)}</tbody>
    </table></div>`
      : html`<p class="muted small">라인 기록이 아직 없어요.</p>`}
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

export function championsPage(ctx) {
  const { stats } = ctx.data;
  const { dd } = ctx;
  const total = Math.max(1, stats.totalMatches);
  return layout(ctx, {
    title: '챔피언',
    active: 'champions',
    body: html`
<h1>챔피언 통계 <small class="muted">우리 내전 ${stats.totalMatches}판 기준</small></h1>
${stats.champions.length
  ? html`<div class="table-wrap"><table class="rank-table">
  <thead><tr><th>챔피언</th><th class="num">판수</th><th class="num hide-sm">픽률</th><th>승률</th><th class="num">밴</th><th class="hide-sm">KDA</th><th class="hide-sm">제일 많이 한 사람</th></tr></thead>
  <tbody>${stats.champions.map((c) => {
    const [bestPuuid, bestGames] = [...c.players.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    const best = bestPuuid ? stats.players.get(bestPuuid) : null;
    return html`<tr>
      <td><div class="champ-name">${champIcon(dd, c.championId, 28)}<span>${dd.champion(c.championId).name}</span></div></td>
      <td class="num">${c.games}</td>
      <td class="num hide-sm">${fmtPct(c.games, total)}</td>
      <td>${c.games ? winRateCell(c.wins, c.games) : html`<span class="muted">-</span>`}</td>
      <td class="num">${c.bans}</td>
      <td class="hide-sm">${c.games ? kdaCell(c.kills, c.deaths, c.assists, c.games) : ''}</td>
      <td class="hide-sm">${best ? html`${playerName(best)} <small class="muted">${bestGames}판</small>` : ''}</td>
    </tr>`;
  })}</tbody>
</table></div>`
  : emptyState('아직 기록이 없어요', '내전이 기록되면 챔피언별 승률이 보여요.')}`,
  });
}

export function collectorPage(ctx, { key, workshop = '' }) {
  const server = ctx.config.baseUrl;
  return layout(ctx, {
    title: '수집기',
    active: 'collector',
    body: html`
<h1>수집기</h1>
<p>롤 클라이언트에서 내전 결과를 읽어서 이 사이트로 보내주는 작은 프로그램이에요. <b>내전에 참가한 사람 중 한 명만 켜두면</b> 10명 전원의 전적이 기록돼요.</p>
<ol class="steps">
  <li><b>Node.js 설치</b> <span class="muted">(처음 한 번만)</span><br><a href="https://nodejs.org" target="_blank" rel="noopener">nodejs.org</a>에서 LTS 버전을 받아 설치하세요.</li>
  <li><b>수집기 받기</b><br>
    <a class="btn primary" href="/collector/tteongnip-collector.bat" download>수집기 다운로드 (Windows)</a>
    <br><small class="muted">내 전용 키가 들어 있는 파일이에요. 다른 사람에게 주지 마세요.</small></li>
  <li><b>더블클릭해서 실행</b><br>검은 창이 뜨면 켜둔 채로 롤을 하면 돼요. 게임이 끝나고 1~2분 안에 자동으로 올라가요.<br>
    <small class="muted">"Windows의 PC 보호" 창이 뜨면 <b>추가 정보 → 실행</b>을 누르세요.</small></li>
</ol>
<details class="panel">
  <summary>직접 실행하기 (맥 · 고급)</summary>
  <p class="small">이 주소에서 <a href="/collector/collector.mjs" download>collector.mjs</a>를 받은 다음:</p>
  <pre><code>node collector.mjs --server ${server} --key ${key}</code></pre>
</details>
<h2 id="overwatch">오버워치 내전 기록하기</h2>
<p>오버워치는 롤처럼 클라이언트에서 전적을 읽을 수 없어서, 커스텀 게임에 <b>떡잎.gg 워크샵 스크립트</b>를 넣어서 기록해요. 같은 수집기가 롤과 오버워치를 함께 올려요.</p>
<ol class="steps">
  <li><b>워크샵 로그 켜기</b> <span class="muted">(방장 PC, 처음 한 번)</span><br>오버워치 설정 → 게임플레이 → <b>워크샵 검사기 로그 파일</b>(Enable Workshop Inspector Log File)을 켜요.</li>
  <li><b>스크립트 넣기</b> <span class="muted">(처음 한 번)</span><br>아래 내용을 전부 복사 → 커스텀 게임 설정 → <b>워크샵</b> → 규칙 붙여넣기 → 커스텀 게임 설정을 프리셋으로 저장해두면 다음부터는 불러오기만 하면 돼요.
    <textarea class="code" readonly rows="8" aria-label="워크샵 스크립트">${workshop}</textarea>
    <a class="small" href="/collector/overwatch-workshop.txt" download>파일로 받기</a></li>
  <li><b>방장 PC에서 수집기 켜기</b><br>경기가 끝나면 1분 안에 자동으로 올라가요. 경기 시작부터 끝까지 기록된 판만 올라가요.</li>
</ol>
<p class="small muted">붙여넣기에서 오류가 나면 오버워치 언어를 잠깐 영어로 바꾸고 붙여넣은 뒤 다시 한국어로 돌려보세요. 그래도 안 되면 오류 메시지를 알려주세요.</p>
<h2>자주 묻는 것</h2>
<dl class="faq">
  <dt>게임할 때 안 켜놨어요.</dt><dd>나중에 켜도 최근 20판 안에 있는 내전을 찾아서 올려요.</dd>
  <dt>여러 명이 켜놓으면 두 번 기록되나요?</dt><dd>아니요. 같은 판은 한 번만 기록돼요.</dd>
  <dt>롤 계정 정보를 가져가나요?</dt><dd>아니요. 내 PC 롤 클라이언트의 전적 탭에 보이는 사용자 설정 게임 결과만 읽어요. 비밀번호나 계정 정보는 건드리지 않아요.</dd>
  <dt>솔랭이나 일반 게임도 올라가나요?</dt><dd>아니요. 롤은 10명이 하는 사용자 설정 게임, 오버워치는 워크샵 스크립트를 넣은 커스텀 게임만 올라가요.</dd>
  <dt>잘못 올라간 판이 있어요.</dt><dd>관리자가 그 내전 화면에서 숨길 수 있어요.</dd>
</dl>`,
  });
}

export function loginPage(ctx, { next = '/', error = '' } = {}) {
  return layout(ctx, {
    title: '로그인',
    bare: true,
    body: html`<div class="login">
  <div class="login-card">
    <img src="/static/favicon.svg" alt="" width="56" height="56">
    <h1>${ctx.config.siteName}</h1>
    <p>우리 디스코드 서버 멤버만 볼 수 있는 내전 전적 사이트예요.</p>
    ${error ? html`<p class="notice warn">${error}</p>` : ''}
    <a class="btn discord" href="/auth/discord?next=${encodeURIComponent(next)}">디스코드로 로그인</a>
  </div>
</div>`,
  });
}

export function messagePage(ctx, { title, message, bare = false }) {
  return layout(ctx, {
    title,
    bare,
    body: html`<div class="empty"><div class="empty-icon" aria-hidden="true">🌱</div><h3>${title}</h3><p>${message}</p><p><a href="/">처음으로</a></p></div>`,
  });
}

export function searchPage(ctx, { q, results }) {
  return layout(ctx, {
    title: `"${q}" 검색`,
    body: html`<h1>"${q}" 검색 결과</h1>
${results.length
  ? html`<ul class="search-results">${results.map(
      ({ game, s }) => html`<li><span class="game-tag ${game}">${game === 'ow' ? '오버워치' : '롤'}</span>${game === 'ow' ? owPlayerName(s, { linkedName: ctx.linkedName(s.key) }) : playerName(s, { linkedName: ctx.linkedName(s.puuid) })}<span class="muted">${s.games}판 · ${fmtPct(s.wins, s.games)} · ${s.rating}점</span></li>`,
    )}</ul>`
  : html`<p class="muted">내전 기록이 있는 사람 중에 찾지 못했어요.</p>`}`,
  });
}

