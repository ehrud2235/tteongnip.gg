// 경기 기록 전체에서 개인 전적, 점수, 챔피언 통계를 계산한다.
// 내전 기록은 많아야 수천 판이라 매번 처음부터 다시 계산해도 충분히 빠르다.
import { kdaRatio, winRate } from './util/format.js';
import { lolMatchPir } from './pir.js';

export const START_RATING = 1000;
const PROVISIONAL_GAMES = 10;
const K_PROVISIONAL = 40;
const K_NORMAL = 24;

function newPlayer(p) {
  return {
    puuid: p.puuid,
    name: p.name,
    tag: p.tag,
    rating: START_RATING,
    peak: START_RATING,
    games: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    damage: 0,
    gold: 0,
    vision: 0,
    seconds: 0,
    pentas: 0,
    pirRankSum: 0,
    pirSum: 0,
    mvp: 0,
    ace: 0,
    history: [], // { matchId, at, win, delta, rating, championId, position }
    champions: new Map(), // championId -> { games, wins, kills, deaths, assists }
    positions: new Map(), // position -> { games, wins }
    mates: new Map(), // puuid -> { games, wins }
    opponents: new Map(), // puuid -> { games, wins }
    lastPlayed: 0,
  };
}

function bump(map, key, win, extra) {
  let s = map.get(key);
  if (!s) {
    s = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
    map.set(key, s);
  }
  s.games++;
  if (win) s.wins++;
  if (extra) {
    s.kills += extra.kills;
    s.deaths += extra.deaths;
    s.assists += extra.assists;
  }
  return s;
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 처음 10판은 크게, 그 뒤로는 작게 움직인다. */
export const kFactor = (games) => (games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_NORMAL);

/** 우리 팀 평균 점수가 상대 팀 평균 점수일 때 예상 승률 (Elo) */
export const expectedWin = (mine, theirs) => 1 / (1 + 10 ** ((theirs - mine) / 400));

export function teamAverage(ratings) {
  return ratings.length ? avg(ratings) : START_RATING;
}

/** 현재 연승(+) / 연패(-) */
export function currentStreak(history) {
  let streak = 0;
  const last = history[history.length - 1];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.draw || last.draw || h.win !== last.win) break;
    streak += h.win ? 1 : -1;
  }
  return streak;
}

export function computeStats(matches, { minRankedGames = 5 } = {}) {
  const sorted = [...matches].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const players = new Map();
  const deltas = new Map(); // matchId -> { puuid: delta }
  const pir = new Map(); // matchId -> Map(puuid -> { pir, rank, mvp, ace })
  const champions = new Map(); // championId -> { games, wins, kills, deaths, assists, bans, players: Map }
  const get = (p) => {
    let s = players.get(p.puuid);
    if (!s) players.set(p.puuid, (s = newPlayer(p)));
    return s;
  };
  const champ = (id) => {
    let c = champions.get(id);
    if (!c) {
      c = { championId: id, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, bans: 0, players: new Map(), matches: new Set() };
      champions.set(id, c);
    }
    return c;
  };

  for (const m of sorted) {
    // 팀 평균 점수로 예상 승률을 구하고, 예상보다 잘했으면 많이 오르고 못했으면 많이 내린다 (Elo 방식).
    const teamRating = (teamId) => avg(m.players.filter((p) => p.teamId === teamId).map((p) => get(p).rating));
    const blue = teamRating(100);
    const red = teamRating(200);
    const expectedBlue = expectedWin(blue, red);
    const d = {};
    for (const p of m.players) {
      const s = get(p);
      const expected = p.teamId === 100 ? expectedBlue : 1 - expectedBlue;
      d[p.puuid] = Math.round(kFactor(s.games) * ((p.win ? 1 : 0) - expected));
    }
    deltas.set(m.id, d);
    const pr = lolMatchPir(m);
    pir.set(m.id, pr);

    for (const p of m.players) {
      const s = get(p);
      const mine = pr.get(p.puuid);
      s.pirRankSum += mine.rank;
      s.pirSum += mine.pir;
      if (mine.mvp) s.mvp++;
      if (mine.ace) s.ace++;
      s.rating += d[p.puuid];
      s.peak = Math.max(s.peak, s.rating);
      if (p.name) {
        s.name = p.name;
        s.tag = p.tag;
      }
      s.games++;
      if (p.win) s.wins++;
      else s.losses++;
      s.kills += p.kills;
      s.deaths += p.deaths;
      s.assists += p.assists;
      s.cs += p.cs;
      s.damage += p.damage;
      s.gold += p.gold;
      s.vision += p.vision;
      s.seconds += m.duration;
      s.pentas += p.multikills?.[3] || 0;
      s.lastPlayed = m.createdAt;
      s.history.push({
        matchId: m.id,
        at: m.createdAt,
        win: p.win,
        delta: d[p.puuid],
        rating: s.rating,
        championId: p.championId,
        position: p.position,
        pirRank: mine.rank,
        pir: mine.pir,
        mvp: mine.mvp,
        ace: mine.ace,
      });
      bump(s.champions, p.championId, p.win, p);
      if (p.position) bump(s.positions, p.position, p.win);
      for (const q of m.players) {
        if (q.puuid === p.puuid) continue;
        bump(q.teamId === p.teamId ? s.mates : s.opponents, q.puuid, p.win);
      }
      const c = champ(p.championId);
      c.games++;
      if (p.win) c.wins++;
      c.kills += p.kills;
      c.deaths += p.deaths;
      c.assists += p.assists;
      c.players.set(p.puuid, (c.players.get(p.puuid) || 0) + 1);
      c.matches.add(m.id);
    }
    for (const t of m.teams || []) for (const id of t.bans || []) champ(id).bans++;
  }

  const list = [...players.values()].map((s) => {
    const streak = currentStreak(s.history);
    const minutes = s.seconds / 60 || 1;
    return Object.assign(s, {
      winRate: winRate(s.wins, s.games),
      kda: kdaRatio(s.kills, s.deaths, s.assists),
      csPerMin: s.cs / minutes,
      damagePerMin: s.damage / minutes,
      streak,
      avgPirRank: s.games ? s.pirRankSum / s.games : 0,
      avgPir: s.games ? Math.round(s.pirSum / s.games) : 0,
      recent: s.history.slice(-10).map((h) => h.win),
      ranked: s.games >= minRankedGames,
      rank: null,
    });
  });

  const ranked = list
    .filter((s) => s.ranked)
    .sort((a, b) => b.rating - a.rating || b.winRate - a.winRate || b.games - a.games);
  ranked.forEach((s, i) => (s.rank = i + 1));
  const unranked = list.filter((s) => !s.ranked).sort((a, b) => b.games - a.games || b.rating - a.rating);

  const championList = [...champions.values()]
    .map((c) => Object.assign(c, { winRate: winRate(c.wins, c.games), kda: kdaRatio(c.kills, c.deaths, c.assists) }))
    .sort((a, b) => b.games - a.games || b.bans - a.bans);

  return {
    players,
    ranked,
    unranked,
    deltas,
    pir,
    champions: championList,
    totalMatches: sorted.length,
    lastMatchAt: sorted.length ? sorted[sorted.length - 1].createdAt : 0,
    minRankedGames,
  };
}

/** 같은 팀/상대 팀 기록을 판수 기준으로 걸러서 승률 순으로 정렬한다. */
export function relationList(map, players, minGames = 2) {
  return [...map.entries()]
    .filter(([, r]) => r.games >= minGames)
    .map(([puuid, r]) => ({ puuid, player: players.get(puuid), ...r, winRate: winRate(r.wins, r.games) }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}
