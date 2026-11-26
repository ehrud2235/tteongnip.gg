// 오버워치: 우리 워크샵 스크립트(overwatch/workshop.txt)가 남긴 로그를 경기 기록으로 바꾼다.
// 로그 한 줄 = "TN,종류,값,값,..."  (앞에 [12:34:56] 같은 시간이 붙어 있어도 된다)
//   TN,start,시간,맵,모드
//   TN,hero,시간,이름,팀(1|2),역할(1 탱|2 딜|3 지원),영웅
//   TN,kill,시간,처치한사람,그영웅,죽은사람,그영웅,기술(1 주무기|2 보조|3 기술1|4 기술2|5 궁|6 근접|0 기타)
//   TN,ult|ab1|ab2,시간,이름,영웅
//   TN,asleep,시간,이름
//   TN,stat,이름,팀,처치,결정타,죽음,영웅피해,치유,막은피해,궁사용,환경처치,환경죽음,솔로킬,받은피해,공격도움,방어도움
//   TN,obj,공격팀(1|2|0),화물진행도(%),목표번호,남은시간,라운드   ← 경기 끝 순간의 목표 상태 (호위·혼합 승패 판정용)
//   TN,end,시간,1팀점수,2팀점수
import crypto from 'node:crypto';

export const ROLE_KEYS = { 1: 'TANK', 2: 'DAMAGE', 3: 'SUPPORT' };
export const ROLE_NAMES = { TANK: '탱커', DAMAGE: '딜러', SUPPORT: '지원' };

// 게임 언어가 영어여도 한국어 영웅 이름으로 모아서 보여준다. 모르는 영웅은 받은 이름 그대로 쓴다.
const HEROES = {
  TANK: {
    'D.Va': 'D.Va', Doomfist: '둠피스트', 'Junker Queen': '정커퀸', Mauga: '마우가', Orisa: '오리사', Ramattra: '라마트라',
    Reinhardt: '라인하르트', Roadhog: '로드호그', Sigma: '시그마', Winston: '윈스턴', 'Wrecking Ball': '레킹볼', Zarya: '자리야', Hazard: '해저드',
  },
  DAMAGE: {
    Ashe: '애쉬', Bastion: '바스티온', Cassidy: '캐서디', Echo: '에코', Freja: '프레야', Genji: '겐지', Hanzo: '한조', Junkrat: '정크랫',
    Mei: '메이', Pharah: '파라', Reaper: '리퍼', Sojourn: '소전', 'Soldier: 76': '솔저: 76', Sombra: '솜브라', Symmetra: '시메트라',
    'Torbjörn': '토르비욘', Tracer: '트레이서', Venture: '벤처', Widowmaker: '위도우메이커',
  },
  SUPPORT: {
    Ana: '아나', Baptiste: '바티스트', Brigitte: '브리기테', Illari: '일리아리', Juno: '주노', Kiriko: '키리코', Lifeweaver: '라이프위버',
    'Lúcio': '루시우', Lucio: '루시우', Mercy: '메르시', Moira: '모이라', Wuyang: '우양', Zenyatta: '젠야타',
  },
};
const KO_NAME = {};
const KO_ROLE = {};
const EN_NAME = {};
for (const [role, heroes] of Object.entries(HEROES)) {
  for (const [en, ko] of Object.entries(heroes)) {
    KO_NAME[en] = ko;
    KO_NAME[en.toLowerCase()] = ko;
    KO_ROLE[ko] = role;
    if (!EN_NAME[ko]) EN_NAME[ko] = en;
  }
}

/** 한국어 영웅 이름의 영어 이름 (모르면 null) */
export function heroEnglish(name) {
  return EN_NAME[heroName(name)] || null;
}

export function heroName(raw) {
  const s = String(raw || '').trim();
  return KO_NAME[s] || KO_NAME[s.toLowerCase()] || s;
}

export function heroRole(name) {
  return KO_ROLE[heroName(name)] || null;
}

export const playerKey = (name) => `ow:${String(name).trim().toLowerCase()}`;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fail = (reason) => ({ ok: false, reason });

/** 로그 텍스트에서 TN 줄만 골라낸다. */
export function parseLines(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('TN,');
    if (i < 0) continue;
    const payload = line.slice(i).trim();
    const f = payload.split(',').map((s) => s.trim());
    out.push({ type: f[1], f: f.slice(2), payload });
  }
  return out;
}

/** 같은 경기는 어느 PC에서 올려도 같은 번호가 나오도록 TN 줄 내용으로 번호를 만든다. */
export function matchIdOf(lines) {
  return `OW_${crypto.createHash('sha1').update(lines.map((l) => l.payload).join('\n')).digest('hex').slice(0, 16)}`;
}

/**
 * 끝(end)까지 기록된 경기 하나의 로그를 정리한다.
 * @returns {{ok: true, match} | {ok: false, reason}}
 */
export function normalizeOverwatch(text, opts = {}) {
  const { minPlayers = 8, minDuration = 180, playedAt = Date.now() } = opts;
  let lines = parseLines(text);
  const endIdx = lines.findIndex((l) => l.type === 'end');
  if (endIdx < 0) return fail('경기가 끝까지 기록되지 않았어요');
  lines = lines.slice(0, endIdx + 1);
  let startIdx = -1;
  lines.forEach((l, i) => l.type === 'start' && (startIdx = i));
  if (startIdx < 0) return fail('경기 시작 기록이 없어요 (경기 도중에 기록을 켰나요?)');

  const start = lines[startIdx];
  const end = lines[endIdx];
  const t0 = num(start.f[0]);
  const t1 = num(end.f[0]);
  const duration = Math.max(0, t1 - t0);
  const score = [num(end.f[1]), num(end.f[2])];

  // 영웅 기록 (경기 시작 전에 고른 영웅도 쓴다)
  const heroLog = new Map(); // 이름 -> [{ t, team, role, hero }]
  for (const l of lines) {
    if (l.type !== 'hero') continue;
    const [t, name, team, role, hero] = l.f;
    if (!name) continue;
    if (!heroLog.has(name)) heroLog.set(name, []);
    heroLog.get(name).push({ t: num(t), team: num(team), role: ROLE_KEYS[num(role)] || heroRole(hero), hero: heroName(hero) });
  }
  const heroAt = (name, t) => {
    const list = heroLog.get(name) || [];
    let cur = list[0] || null;
    for (const h of list) if (h.t <= t) cur = h;
    return cur;
  };

  const after = lines.slice(startIdx);
  const of = (type) => after.filter((l) => l.type === type);
  const kills = of('kill').map(({ f }) => ({ t: num(f[0]), attacker: f[1], victim: f[3], ability: num(f[5]) }));
  const ults = of('ult').map(({ f }) => ({ t: num(f[0]), name: f[1], hero: heroName(f[2]) }));
  const ab1 = of('ab1').map(({ f }) => ({ name: f[1], hero: heroName(f[2]) }));
  const ab2 = of('ab2').map(({ f }) => ({ name: f[1], hero: heroName(f[2]) }));
  const asleep = of('asleep').map(({ f }) => ({ t: num(f[0]), name: f[1] }));

  const stats = new Map();
  for (const l of lines.slice(startIdx)) {
    if (l.type !== 'stat' || !l.f[0]) continue;
    const f = l.f;
    stats.set(f[0], {
      name: f[0],
      team: num(f[1]),
      elims: num(f[2]),
      finalBlows: num(f[3]),
      deaths: num(f[4]),
      damage: num(f[5]),
      healing: num(f[6]),
      blocked: num(f[7]),
      ults: num(f[8]),
      envKills: num(f[9]),
      envDeaths: num(f[10]),
      solo: num(f[11]),
      taken: num(f[12]),
      assists: num(f[13]),
      defAssists: num(f[14]),
    });
  }

  if (stats.size < minPlayers) return fail(`${minPlayers}명이 안 되는 경기예요 (${stats.size}명)`);
  const teams = new Set([...stats.values()].map((s) => s.team));
  if (!teams.has(1) || !teams.has(2)) return fail('두 팀으로 나뉜 경기가 아니에요');
  if (duration < minDuration) return fail(`너무 짧은 경기예요 (${Math.floor(duration / 60)}분)`);
  // 승패: 팀 점수가 다르면 점수로. 같으면(경쟁전 규칙 없는 호위·혼합은 0 : 0) 경기 끝 순간의 목표 상태로 판정.
  let winner = score[0] > score[1] ? 1 : score[1] > score[0] ? 2 : 0;
  let winnerSource = winner ? 'score' : null;
  const objLine = after.find((l) => l.type === 'obj');
  const objective = objLine
    ? { offense: num(objLine.f[0]), payload: num(objLine.f[1]), index: num(objLine.f[2]), timeLeft: num(objLine.f[3]), round: num(objLine.f[4]) }
    : null;
  if (!winner && objective && (objective.offense === 1 || objective.offense === 2)) {
    const attackersFinished = objective.payload >= 99 || objective.index >= 3;
    winner = attackersFinished ? objective.offense : 3 - objective.offense;
    winnerSource = 'objective';
  }

  // 5대5 / 6대6: 중간에 나간 사람까지 포함해서 팀별로 영웅을 고른 사람 수
  const teamCount = { 1: new Set(), 2: new Set() };
  for (const [name, list] of heroLog) for (const h of list) if (teamCount[h.team]) teamCount[h.team].add(name);
  for (const st of stats.values()) if (teamCount[st.team]) teamCount[st.team].add(st.name);
  const teamSize = Math.max(teamCount[1].size, teamCount[2].size);

  const teamOf = new Map([...stats.values()].map((s) => [s.name, s.team]));
  const players = [...stats.values()].map((s) => {
    // 영웅별 플레이 시간
    const list = heroLog.get(s.name) || [];
    const seconds = new Map();
    for (let i = 0; i < list.length; i++) {
      const from = Math.max(t0, list[i].t);
      const to = Math.min(t1, i + 1 < list.length ? list[i + 1].t : t1);
      const key = list[i].hero;
      const cur = seconds.get(key) || { hero: key, role: list[i].role, seconds: 0 };
      cur.seconds += Math.max(0, to - from);
      seconds.set(key, cur);
    }
    let heroes = [...seconds.values()].filter((h) => h.seconds > 0).sort((a, b) => b.seconds - a.seconds);
    if (!heroes.length && list.length) heroes = [{ hero: list.at(-1).hero, role: list.at(-1).role, seconds: 0 }];
    const main = heroes[0] || { hero: '알 수 없음', role: null };

    const myUlts = ults.filter((u) => u.name === s.name);
    const myDeaths = kills.filter((k) => k.victim === s.name);
    const ultDeaths = myUlts.filter((u) => myDeaths.some((k) => k.t >= u.t && k.t <= u.t + 3)).length;
    const myKills = kills.filter((k) => k.attacker === s.name && k.victim !== s.name);
    const sleeps = asleep.filter((a) => {
      const victimTeam = teamOf.get(a.name);
      if (!victimTeam || victimTeam === s.team) return false;
      if (heroAt(s.name, a.t)?.hero !== '아나') return false;
      // 상대 팀에 아나가 여럿이면 이름순 첫 번째에게 준다
      const anas = [...stats.values()].filter((o) => o.team === s.team && heroAt(o.name, a.t)?.hero === '아나').map((o) => o.name).sort();
      return anas[0] === s.name;
    }).length;

    return {
      key: playerKey(s.name),
      name: s.name,
      team: s.team,
      win: winner !== 0 && s.team === winner,
      draw: winner === 0,
      hero: main.hero,
      role: main.role,
      heroes,
      elims: s.elims,
      finalBlows: s.finalBlows,
      deaths: s.deaths,
      assists: s.assists,
      damage: s.damage,
      healing: s.healing,
      blocked: s.blocked,
      taken: s.taken,
      ults: s.ults || myUlts.length,
      solo: s.solo,
      fun: {
        sleeps,
        sleepShots: ab1.filter((a) => a.name === s.name && a.hero === '아나').length,
        slept: asleep.filter((a) => a.name === s.name).length,
        rez: ab2.filter((a) => a.name === s.name && a.hero === '메르시').length,
        ultDeaths,
        ultKills: myKills.filter((k) => k.ability === 5).length,
        meleeKills: myKills.filter((k) => k.ability === 6).length,
        envKills: s.envKills,
        envDeaths: s.envDeaths,
      },
    };
  });
  players.sort((a, b) => a.team - b.team || roleOrder(a.role) - roleOrder(b.role) || b.damage - a.damage);

  return {
    ok: true,
    match: {
      id: matchIdOf(lines.slice(0, endIdx + 1)),
      game: 'ow',
      createdAt: Number(playedAt) || Date.now(),
      duration,
      map: start.f[1] || '',
      mode: start.f[2] || '',
      score,
      winner,
      winnerSource,
      objective,
      teamSize,
      format: teamSize >= 6 ? '6v6' : '5v5',
      players,
    },
  };
}

export function roleOrder(role) {
  return { TANK: 0, DAMAGE: 1, SUPPORT: 2 }[role] ?? 3;
}

/** 이 판의 명장면과 흑역사. 기록 사이트답게 몇 줄만, 숫자가 있을 때만 보여준다. */
export function matchHighlights(match) {
  const out = [];
  const ps = match.players;
  const top = (fn, min = 1) => {
    const best = [...ps].sort((a, b) => fn(b) - fn(a))[0];
    return best && fn(best) >= min ? best : null;
  };
  const dmg = top((p) => p.damage, 1);
  if (dmg) out.push({ kind: 'good', icon: '🔥', who: dmg, text: `피해량 1위 · ${Math.round(dmg.damage).toLocaleString('ko-KR')}` });
  const heal = top((p) => p.healing, 1);
  if (heal) out.push({ kind: 'good', icon: '💚', who: heal, text: `치유량 1위 · ${Math.round(heal.healing).toLocaleString('ko-KR')}` });
  const sleeper = top((p) => p.fun?.sleeps || 0, 2);
  if (sleeper) out.push({ kind: 'good', icon: '🛌', who: sleeper, text: `수면총으로 ${sleeper.fun.sleeps}명 재움` });
  const rez = top((p) => p.fun?.rez || 0, 2);
  if (rez) out.push({ kind: 'good', icon: '😇', who: rez, text: `부활 ${rez.fun.rez}번` });
  const boop = top((p) => p.fun?.envKills || 0, 1);
  if (boop) out.push({ kind: 'good', icon: '👋', who: boop, text: `맵 밖으로 ${boop.fun.envKills}명 배웅` });
  const melee = top((p) => p.fun?.meleeKills || 0, 2);
  if (melee) out.push({ kind: 'good', icon: '👊', who: melee, text: `근접 공격으로 ${melee.fun.meleeKills}명 마무리` });

  const ultDeath = top((p) => p.fun?.ultDeaths || 0, 1);
  if (ultDeath) out.push({ kind: 'bad', icon: '💥', who: ultDeath, text: `궁 쓰고 3초 안에 사망 ${ultDeath.fun.ultDeaths}번` });
  const fall = top((p) => p.fun?.envDeaths || 0, 1);
  if (fall) out.push({ kind: 'bad', icon: '🕳️', who: fall, text: `낙사 ${fall.fun.envDeaths}번` });
  const slept = top((p) => p.fun?.slept || 0, 3);
  if (slept) out.push({ kind: 'bad', icon: '😴', who: slept, text: `${slept.fun.slept}번 잠듦` });
  if (match.winner) {
    const winners = ps.filter((p) => p.team === match.winner);
    const avgDeaths = winners.reduce((a, p) => a + p.deaths, 0) / Math.max(1, winners.length);
    const bus = [...winners].sort((a, b) => b.deaths - a.deaths)[0];
    if (bus && bus.deaths >= 6 && bus.deaths >= avgDeaths * 1.5) {
      out.push({ kind: 'bad', icon: '🚌', who: bus, text: `이긴 팀 최다 데스 ${bus.deaths} · 버스 탑승 감사합니다` });
    }
  }
  const good = out.filter((h) => h.kind === 'good').slice(0, 3);
  const bad = out.filter((h) => h.kind === 'bad').slice(0, 2);
  return [...good, ...bad];
}

/** 누적 기록으로 붙는 칭호 (최대 2개). 조건을 넉넉하게 잡아서 아무에게나 붙지 않게 했다. */
export function playerTitles(s) {
  const titles = [];
  const per = (x) => x / Math.max(1, s.games);
  const ana = s.heroes.get('아나');
  if (ana && ana.games >= 3 && (ana.sleeps || 0) / ana.games >= 3) titles.push({ name: '수면 마취과 전문의', why: `아나로 한 판에 평균 ${((ana.sleeps || 0) / ana.games).toFixed(1)}명 재움` });
  if (s.games >= 5 && s.winRate >= 65) titles.push({ name: '승리 요정', why: `승률 ${s.winRate}%` });
  if (s.fun.rez >= 10) titles.push({ name: '수호천사', why: `부활 ${s.fun.rez}번` });
  if (s.games >= 4 && per(s.fun.envKills) >= 0.5) titles.push({ name: '배웅 전문가', why: `맵 밖으로 ${s.fun.envKills}명 배웅` });
  if (s.games >= 4 && per(s.fun.envDeaths) >= 0.5) titles.push({ name: '중력 체험단', why: `낙사 ${s.fun.envDeaths}번` });
  if (s.ults >= 8 && s.fun.ultDeaths / s.ults >= 0.25) titles.push({ name: '궁극기 기부 천사', why: `궁 ${s.ults}번 중 ${s.fun.ultDeaths}번은 쓰고 3초 안에 사망` });
  if (s.games >= 4 && per(s.fun.slept) >= 2) titles.push({ name: '꿀잠 전문', why: `한 판에 평균 ${per(s.fun.slept).toFixed(1)}번 잠듦` });
  if (s.games >= 5 && s.winRate <= 35) titles.push({ name: '패배 요정', why: `승률 ${s.winRate}%` });
  return titles.slice(0, 2);
}

export const FORMAT_NAMES = { all: '전체', '5v5': '5대5', '6v6': '6대6' };

/** 5대5 / 6대6 (예전 기록은 남은 사람 수로 판단) */
export function owFormat(m) {
  if (m.format) return m.format;
  const per = [1, 2].map((t) => m.players.filter((p) => p.team === t).length);
  return Math.max(...per) >= 6 ? '6v6' : '5v5';
}

/** 승패를 직접 정한다. winner: 1 | 2 | 0(무승부) */
export function setOwWinner(match, winner) {
  match.winner = winner;
  match.winnerSource = 'manual';
  for (const p of match.players) {
    p.draw = winner === 0;
    p.win = winner !== 0 && p.team === winner;
  }
  return match;
}
