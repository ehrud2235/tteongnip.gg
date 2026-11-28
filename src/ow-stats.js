// 오버워치 경기 기록에서 개인 전적, 점수, 영웅·역할 통계, 누적 기록을 계산한다. 점수는 롤과 따로 쌓인다.
import { START_RATING, currentStreak, expectedWin, kFactor, teamAverage } from './stats.js';
import { playerTitles } from './overwatch.js';
import { winRate } from './util/format.js';
import { owMatchPir } from './pir.js';

const FUN_KEYS = ['sleeps', 'sleepShots', 'slept', 'rez', 'ultDeaths', 'ultKills', 'meleeKills', 'envKills', 'envDeaths'];

function newPlayer(p) {
  return {
    key: p.key,
    name: p.name,
    rating: START_RATING,
    peak: START_RATING,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    elims: 0,
    assists: 0,
    deaths: 0,
    damage: 0,
    healing: 0,
    blocked: 0,
    taken: 0,
    ults: 0,
    solo: 0,
    seconds: 0,
    pirRankSum: 0,
    pirSum: 0,
    mvp: 0,
    ace: 0,
    fun: Object.fromEntries(FUN_KEYS.map((k) => [k, 0])),
    heroes: new Map(),
    roles: new Map(),
    mates: new Map(),
    opponents: new Map(),
    history: [],
    lastPlayed: 0,
  };
}

function bumpRel(map, key, win) {
  const r = map.get(key) || { games: 0, wins: 0 };
  r.games++;
  if (win) r.wins++;
  map.set(key, r);
}

export function computeOwStats(matches, { minRankedGames = 5 } = {}) {
  const sorted = [...matches].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const players = new Map();
  const deltas = new Map();
  const pir = new Map(); // matchId -> Map(key -> { pir, rank, mvp, ace })
  const heroes = new Map(); // 영웅 -> { hero, role, games, wins, seconds, players: Map }
  const get = (p) => {
    let s = players.get(p.key);
    if (!s) players.set(p.key, (s = newPlayer(p)));
    return s;
  };

  for (const m of sorted) {
    const avgOf = (team) => teamAverage(m.players.filter((p) => p.team === team).map((p) => get(p).rating));
    const exp1 = expectedWin(avgOf(1), avgOf(2));
    const d = {};
    for (const p of m.players) {
      const s = get(p);
      const expected = p.team === 1 ? exp1 : 1 - exp1;
      d[p.key] = m.winner ? Math.round(kFactor(s.games) * ((p.win ? 1 : 0) - expected)) : 0;
    }
    deltas.set(m.id, d);
    const pr = owMatchPir(m);
    pir.set(m.id, pr);

    for (const p of m.players) {
      const s = get(p);
      const mine = pr.get(p.key);
      s.pirRankSum += mine.rank;
      s.pirSum += mine.pir;
      if (mine.mvp) s.mvp++;
      if (mine.ace) s.ace++;
      s.rating += d[p.key];
      s.peak = Math.max(s.peak, s.rating);
      s.name = p.name;
      s.games++;
      if (p.draw) s.draws++;
      else if (p.win) s.wins++;
      else s.losses++;
      for (const k of ['elims', 'assists', 'deaths', 'damage', 'healing', 'blocked', 'taken', 'ults', 'solo']) s[k] += p[k] || 0;
      for (const k of FUN_KEYS) s.fun[k] += p.fun?.[k] || 0;
      s.seconds += m.duration;
      s.lastPlayed = m.createdAt;
      s.history.push({ matchId: m.id, at: m.createdAt, win: p.win, draw: p.draw, delta: d[p.key], rating: s.rating, hero: p.hero, role: p.role, pirRank: mine.rank, pir: mine.pir, mvp: mine.mvp, ace: mine.ace });

      // 영웅: 판수와 승패는 가장 오래 한 영웅에, 플레이 시간은 한 영웅 모두에
      for (const h of p.heroes || []) {
        const hs = s.heroes.get(h.hero) || { hero: h.hero, role: h.role, games: 0, wins: 0, seconds: 0, elims: 0, deaths: 0, assists: 0, damage: 0, healing: 0, blocked: 0, sleeps: 0, sleepShots: 0, rez: 0 };
        hs.seconds += h.seconds;
        if (h.hero === p.hero) {
          hs.games++;
          if (p.win) hs.wins++;
          for (const k of ['elims', 'deaths', 'assists', 'damage', 'healing', 'blocked']) hs[k] += p[k] || 0;
          hs.sleeps += p.fun?.sleeps || 0;
          hs.sleepShots += p.fun?.sleepShots || 0;
          hs.rez += p.fun?.rez || 0;
        }
        s.heroes.set(h.hero, hs);

        const g = heroes.get(h.hero) || { hero: h.hero, role: h.role, games: 0, wins: 0, seconds: 0, players: new Map(), matches: new Set() };
        g.seconds += h.seconds;
        if (h.hero === p.hero) {
          g.games++;
          if (p.win) g.wins++;
          g.players.set(p.key, (g.players.get(p.key) || 0) + 1);
          g.matches.add(m.id);
        }
        heroes.set(h.hero, g);
      }
      if (p.role) bumpRel(s.roles, p.role, p.win);
      for (const q of m.players) {
        if (q.key === p.key) continue;
        bumpRel(q.team === p.team ? s.mates : s.opponents, q.key, p.win);
      }
    }
  }

  const list = [...players.values()].map((s) => {
    const tenMin = Math.max(1, s.seconds / 600);
    Object.assign(s, {
      winRate: winRate(s.wins, s.games),
      per10: { elims: s.elims / tenMin, deaths: s.deaths / tenMin, damage: s.damage / tenMin, healing: s.healing / tenMin, blocked: s.blocked / tenMin },
      mainRole: [...s.roles.entries()].sort((a, b) => b[1].games - a[1].games)[0]?.[0] || null,
      streak: currentStreak(s.history),
      avgPirRank: s.games ? s.pirRankSum / s.games : 0,
      avgPir: s.games ? Math.round(s.pirSum / s.games) : 0,
      recent: s.history.slice(-10).map((h) => (h.draw ? null : h.win)),
      ranked: s.games >= minRankedGames,
      rank: null,
    });
    s.titles = playerTitles(s);
    return s;
  });
  const ranked = list.filter((s) => s.ranked).sort((a, b) => b.rating - a.rating || b.winRate - a.winRate || b.games - a.games);
  ranked.forEach((s, i) => (s.rank = i + 1));
  const unranked = list.filter((s) => !s.ranked).sort((a, b) => b.games - a.games || b.rating - a.rating);
  const heroList = [...heroes.values()]
    .map((h) => Object.assign(h, { winRate: winRate(h.wins, h.games) }))
    .sort((a, b) => b.games - a.games || b.seconds - a.seconds);

  return {
    players,
    ranked,
    unranked,
    deltas,
    pir,
    heroes: heroList,
    totalMatches: sorted.length,
    lastMatchAt: sorted.length ? sorted[sorted.length - 1].createdAt : 0,
    minRankedGames,
  };
}
