// 오버워치: 우리 워크샵 스크립트(overwatch/workshop.txt)가 남긴 로그를 경기 기록으로 바꾼다.
// 로그 한 줄 = "TN,종류,값,값,..."  (앞에 [12:34:56] 같은 시간이 붙어 있어도 된다)
//   TN,start,시간,맵,모드
//   TN,hero,시간,이름,팀(1|2),역할(1 탱|2 딜|3 지원),영웅
//   TN,kill,시간,처치한사람,그영웅,죽은사람,그영웅,기술(1 주무기|2 보조|3 기술1|4 기술2|5 궁|6 근접|0 기타)
//   TN,ult|ab1|ab2,시간,이름,영웅
//   TN,asleep,시간,이름
//   TN,stat,이름,팀,처치,결정타,죽음,영웅피해,치유,막은피해,궁사용,환경처치,환경죽음,솔로킬,받은피해,공격도움,방어도움,마지막영웅,역할
//   TN,obj,공격팀(1|2|0),화물진행도(%),목표번호,남은시간,라운드   ← 경기 끝 순간의 목표 상태 (호위·혼합 승패 판정용)
//   TN,end,시간,1팀점수,2팀점수
import crypto from 'node:crypto';
import { analyzeMatch } from './ow-pir.js';

export const ROLE_KEYS = { 1: 'TANK', 2: 'DAMAGE', 3: 'SUPPORT' };
export const ROLE_NAMES = { TANK: '탱커', DAMAGE: '딜러', SUPPORT: '지원', MAIN_DPS: '메인 딜러', SUB_DPS: '서브 딜러' };

// 딜러를 메인(히트스캔) / 서브(투사체·돌진)로 나눈다. 우리 서버 기준에 맞게 고치면 된다.
const MAIN_DPS = new Set(['솔저: 76', '캐서디', '애쉬', '위도우메이커', '소전', '트레이서', '바스티온']);
const SUB_DPS = new Set(['겐지', '한조', '파라', '에코', '정크랫', '메이', '토르비욘', '시메트라', '리퍼', '솜브라', '벤처', '프레야']);

/** 포지션: TANK | MAIN_DPS | SUB_DPS | DAMAGE(분류 안 된 새 딜러) | SUPPORT */
export function owPosition(role, hero) {
  if (role !== 'DAMAGE') return role || null;
  const h = heroName(hero);
  return MAIN_DPS.has(h) ? 'MAIN_DPS' : SUB_DPS.has(h) ? 'SUB_DPS' : 'DAMAGE';
}

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
  const all = parseLines(text);
  // 보낸 로그의 마지막 경기(마지막 end)를 기록한다. 그 앞 내용은 영웅 정보를 찾는 데만 쓴다.
  let lastEnd = -1;
  all.forEach((l, i) => l.type === 'end' && (lastEnd = i));
  if (lastEnd < 0) return fail('경기가 끝까지 기록되지 않았어요');
  let prevEnd = -1;
  for (let i = lastEnd - 1; i >= 0; i--) {
    if (all[i].type === 'end') {
      prevEnd = i;
      break;
    }
  }
  const context = all.slice(0, prevEnd + 1); // 이전 경기들 (같은 로비에서 이어서 한 경우)
  const lines = all.slice(prevEnd + 1, lastEnd + 1); // 이 경기
  const endIdx = lines.length - 1;
  let startIdx = -1;
  lines.forEach((l, i) => l.type === 'start' && (startIdx = i));
  if (startIdx < 0) return fail('경기 시작 기록이 없어요 (경기 도중에 기록을 켰나요?)');

  const start = lines[startIdx];
  const end = lines[endIdx];
  const t0 = num(start.f[0]);
  const t1 = num(end.f[0]);
  const duration = Math.max(0, t1 - t0);
  const score = [num(end.f[1]), num(end.f[2])];

  // 영웅 기록. 경기 시작 전(이전 경기 포함)에 고른 영웅은 경기 시작 시각에 고른 것으로 친다.
  const heroLog = new Map(); // 이름 -> [{ t, team, role, hero }]
  const preStart = [...context, ...lines.slice(0, startIdx)];
  const addHero = (l, isPre) => {
    const [t, name, team, role, hero] = l.f;
    if (!name || !hero) return;
    if (!heroLog.has(name)) heroLog.set(name, []);
    heroLog.get(name).push({ t: isPre ? t0 : num(t), team: num(team), role: ROLE_KEYS[num(role)] || heroRole(hero), hero: heroName(hero) });
  };
  for (const l of preStart) if (l.type === 'hero') addHero(l, true);
  for (const l of lines.slice(startIdx)) if (l.type === 'hero') addHero(l, false);
  for (const list of heroLog.values()) {
    // 시작 전 기록은 마지막 것만 남긴다
    const firstPost = list.findIndex((h, i) => i > 0 && h.t > t0);
    const pre = firstPost < 0 ? list : list.slice(0, firstPost);
    if (pre.length > 1) list.splice(0, pre.length - 1);
  }
  // 영웅 기록이 없는 사람은 처치·궁극기 기록에 나온 영웅으로 대신한다
  const mentions = new Map(); // 이름 -> Map(영웅 -> 횟수)
  const mention = (name, hero) => {
    if (!name || !hero || name === '0') return;
    const m = mentions.get(name) || new Map();
    const key = heroName(hero);
    m.set(key, (m.get(key) || 0) + 1);
    mentions.set(name, m);
  };
  for (const l of lines.slice(startIdx)) {
    if (l.type === 'kill') {
      mention(l.f[1], l.f[2]);
      mention(l.f[3], l.f[4]);
    } else if (['ult', 'ab1', 'ab2'].includes(l.type)) mention(l.f[1], l.f[2]);
  }
  const heroAt = (name, t) => {
    const list = heroLog.get(name) || [];
    let cur = list[0] || null;
    for (const h of list) if (h.t <= t) cur = h;
    return cur;
  };

  const after = lines.slice(startIdx);
  const of = (type) => after.filter((l) => l.type === type);

  // 개인 기록 (이름이 양 팀에 똑같이 있을 수 있어서 이름+팀으로 구분. 예: 양 팀 AI가 둘 다 한조)
  const stats = new Map();
  for (const l of after) {
    if (l.type !== 'stat' || !l.f[0]) continue;
    const f = l.f;
    stats.set(`${f[0]}|${num(f[1])}`, {
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
      finalHero: f[15] ? heroName(f[15]) : null,
      finalRole: ROLE_KEYS[num(f[16])] || null,
    });
  }

  if (stats.size < minPlayers) return fail(`${minPlayers}명이 안 되는 경기예요 (${stats.size}명)`);
  const teams = new Set([...stats.values()].map((st) => st.team));
  if (!teams.has(1) || !teams.has(2)) return fail('두 팀으로 나뉜 경기가 아니에요');
  if (duration < minDuration) return fail(`너무 짧은 경기예요 (${Math.floor(duration / 60)}분)`);
  // 승패: 팀 점수가 다르면 점수로. 같으면(경쟁전 규칙 없는 호위·혼합은 0 : 0) 경기 끝 순간의 목표 상태로 판정.
  let winner = score[0] > score[1] ? 1 : score[1] > score[0] ? 2 : 0;
  let winnerSource = winner ? 'score' : null;
  const objLine = after.find((l) => l.type === 'obj');
  const objective = objLine
    ? { offense: num(objLine.f[0]), payload: num(objLine.f[1]), index: num(objLine.f[2]), timeLeft: num(objLine.f[3]), round: num(objLine.f[4]) }
    : null;
  const payloadMode = /호위|혼합|escort|hybrid/i.test(start.f[2] || '');
  // 밀기·플래시포인트 등은 화물 진행도로 판정할 수 없어서 점수가 같으면 "승패 미정" (관리자가 정한다)
  if (!winner && payloadMode && objective && (objective.offense === 1 || objective.offense === 2)) {
    const attackersFinished = objective.payload >= 99 || objective.index >= 3;
    if (attackersFinished) winner = objective.offense;
    else if (objective.timeLeft <= 1) winner = 3 - objective.offense; // 시간이 다 돼서 수비 승
    else return fail('경기가 끝나기 전에 종료된 판이에요 (로비로 돌아가기, 다시 시작 등)');
    winnerSource = 'objective';
  }

  // 5대5 / 6대6: 경기 시작 전에 영웅을 고른 사람(중간에 나간 사람 포함)과 끝까지 남은 사람 중 많은 쪽.
  // (AI는 영웅을 바꿀 때마다 이름이 바뀌어서, 경기 중에 나온 이름까지 세면 인원이 부풀려진다)
  const startRoster = { 1: new Set(), 2: new Set() };
  for (const l of lines.slice(0, startIdx)) if (l.type === 'hero' && startRoster[num(l.f[2])]) startRoster[num(l.f[2])].add(l.f[1]);
  const finishers = { 1: 0, 2: 0 };
  for (const st of stats.values()) if (st.team in finishers) finishers[st.team]++;
  const teamSize = Math.max(startRoster[1].size, startRoster[2].size, finishers[1], finishers[2]);

  // 이름 → 사람 키. 이름이 양 팀에 있으면 팀을 붙인다.
  const nameTeams = new Map();
  for (const st of stats.values()) {
    if (!nameTeams.has(st.name)) nameTeams.set(st.name, new Set());
    nameTeams.get(st.name).add(st.team);
  }
  const keyFor = (name, team) => (nameTeams.get(name)?.size > 1 ? `${playerKey(name)}@${team}` : playerKey(name));
  /** 기록에 나온 이름을 사람 키로. 같은 이름이 양 팀에 있으면 팀을 알아야 한다. */
  const resolve = (name, team) => {
    const ts = nameTeams.get(name);
    if (!ts) return null;
    if (ts.size === 1) return { key: keyFor(name, [...ts][0]), team: [...ts][0] };
    return team === 1 || team === 2 ? { key: keyFor(name, team), team } : null;
  };

  // 이 팀에 그 이름이 있으면 그 사람 (다른 팀 사람으로 잘못 잡지 않게)
  const onTeam = (name, team) => (nameTeams.get(name)?.has(team) ? keyFor(name, team) : null);
  const kills = of('kill').map(({ f }) => {
    // 새 스크립트: ...,기술,처치팀,죽은팀,처치한사람주변아군수,주변적수
    let aTeam = f[6] ? num(f[6]) : null;
    let vTeam = f[7] ? num(f[7]) : null;
    const self = f[1] === f[3];
    if (!aTeam && !vTeam) {
      // 예전 스크립트: 이름으로 팀을 알아낸다. 아군끼리는 처치할 수 없으니 둘은 다른 팀이다.
      const a = resolve(f[1], null);
      const v = resolve(f[3], null);
      if (self) aTeam = vTeam = v?.team ?? a?.team ?? null;
      else if (a) [aTeam, vTeam] = [a.team, 3 - a.team];
      else if (v) [aTeam, vTeam] = [3 - v.team, v.team];
    } else if (!self) {
      aTeam = aTeam || (vTeam ? 3 - vTeam : null);
      vTeam = vTeam || (aTeam ? 3 - aTeam : null);
    }
    return {
      t: num(f[0]),
      attacker: f[1],
      victim: f[3],
      aKey: aTeam ? onTeam(f[1], aTeam) : null,
      vKey: vTeam ? onTeam(f[3], vTeam) : null,
      aTeam,
      vTeam,
      vName: f[3],
      atkHero: f[2],
      vicHero: f[4],
      ability: num(f[5]),
      allies: f[8] != null && f[8] !== '' ? num(f[8]) : null,
      enemies: f[9] != null && f[9] !== '' ? num(f[9]) : null,
    };
  });
  const keyOfName = (name) => resolve(name, null)?.key || null;
  const ults = dedupeUlts(of('ult').map(({ f }) => ({ t: num(f[0]), name: f[1], key: keyOfName(f[1]), hero: heroName(f[2]) })));
  const abs = [
    ...of('ab1').map(({ f }) => ({ t: num(f[0]), name: f[1], key: keyOfName(f[1]), hero: heroName(f[2]), slot: 1 })),
    ...of('ab2').map(({ f }) => ({ t: num(f[0]), name: f[1], key: keyOfName(f[1]), hero: heroName(f[2]), slot: 2 })),
  ];
  const asleep = of('asleep').map(({ f }) => ({ t: num(f[0]), name: f[1], key: keyOfName(f[1]) }));
  const spawns = of('spawn').map(({ f }) => ({ t: num(f[0]), name: f[1], team: num(f[2]) }));
  const snaps = of('snap')
    .map(({ f }) => {
      const who = resolve(f[1], num(f[2]));
      return who && { t: num(f[0]), key: who.key, dmg: num(f[3]), heal: num(f[4]), blocked: num(f[5]), ult: num(f[6]) };
    })
    .filter(Boolean);

  // "그 시각에 이 영웅이었다"는 기록: 처치·궁·기술 줄에도 영웅이 들어 있어서,
  // 영웅 교체 줄이 빠져도(워크샵이 가끔 놓친다) 언제 무슨 영웅을 했는지 알아낼 수 있다.
  const seen = new Map(); // 사람 키 -> [{ t, hero }]
  const see = (key, t, hero) => {
    if (!key || !hero || t < t0 || t > t1) return;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push({ t, hero: heroName(hero) });
  };
  for (const k of kills) {
    see(k.aKey, k.t, k.atkHero);
    see(k.vKey, k.t, k.vicHero);
  }
  for (const u of ults) see(u.key, u.t, u.hero);
  for (const a of abs) see(a.key, a.t, a.hero);

  const players = [...stats.values()].map((st) => {
    const key = keyFor(st.name, st.team);
    // 영웅별 플레이 시간 (같은 이름이 양 팀에 있으면 영웅 기록도 팀이 맞는 것만)
    const list = (heroLog.get(st.name) || []).filter((h) => nameTeams.get(st.name).size === 1 || h.team === st.team);
    const roleOfHero = new Map(list.map((h) => [h.hero, h.role]));
    const obs = [
      ...list.map((h) => ({ t: Math.max(t0, h.t), hero: h.hero, exact: true })),
      ...(seen.get(key) || []).map((o) => ({ ...o, exact: false })),
    ].sort((a, b) => a.t - b.t || b.exact - a.exact);
    // 같은 영웅이 이어지면 한 구간. 교체 시각: 영웅 선택 줄이 있으면 그 시각, 없으면 앞 영웅 마지막 기록과 새 영웅 첫 기록의 중간.
    const segs = [];
    for (const o of obs) {
      const last = segs.at(-1);
      if (last && last.hero === o.hero) {
        last.lastSeen = o.t;
        continue;
      }
      const from = !last ? t0 : o.exact ? o.t : (last.lastSeen + o.t) / 2;
      segs.push({ hero: o.hero, from, lastSeen: o.t });
    }
    const seconds = new Map();
    segs.forEach((g, i) => {
      const to = i + 1 < segs.length ? segs[i + 1].from : t1;
      const cur = seconds.get(g.hero) || { hero: g.hero, role: roleOfHero.get(g.hero) || (g.hero === st.finalHero && st.finalRole) || heroRole(g.hero), seconds: 0 };
      cur.seconds += Math.max(0, Math.round(to - g.from));
      seconds.set(g.hero, cur);
    });
    let heroes = [...seconds.values()].filter((h) => h.hero && h.seconds > 0).sort((a, b) => b.seconds - a.seconds);
    if (!heroes.length && list.length && list.at(-1).hero) heroes = [{ hero: list.at(-1).hero, role: list.at(-1).role, seconds: 0 }];
    if (!heroes.length && st.finalHero) heroes = [{ hero: st.finalHero, role: st.finalRole || heroRole(st.finalHero), seconds: duration }];
    if (!heroes.length && mentions.has(st.name)) {
      const counts = [...mentions.get(st.name).entries()].sort((a, b) => b[1] - a[1]);
      const total = counts.reduce((acc, [, c]) => acc + c, 0);
      heroes = counts.map(([hero, c]) => ({ hero, role: heroRole(hero), seconds: Math.round((duration * c) / total) }));
    }
    const main = heroes[0] || { hero: '알 수 없음', role: null };

    const myUlts = ults.filter((u) => u.key === key);
    const myDeaths = kills.filter((k) => k.vKey === key);
    const ultDeaths = myUlts.filter((u) => myDeaths.some((k) => k.t >= u.t && k.t <= u.t + 3)).length;
    const myKills = kills.filter((k) => k.aKey === key && k.vKey !== key);
    const sleeps = asleep.filter((sl) => {
      const victimTeam = resolve(sl.name, null)?.team;
      if (!victimTeam || victimTeam === st.team) return false;
      if (heroAt(st.name, sl.t)?.hero !== '아나') return false;
      // 상대 팀에 아나가 여럿이면 이름순 첫 번째에게 준다
      const anas = [...stats.values()].filter((o) => o.team === st.team && heroAt(o.name, sl.t)?.hero === '아나').map((o) => o.name).sort();
      return anas[0] === st.name;
    }).length;

    return {
      key,
      name: st.name,
      team: st.team,
      win: winner !== 0 && st.team === winner,
      draw: winner === 0,
      hero: main.hero,
      role: main.role,
      heroes,
      elims: st.elims,
      finalBlows: st.finalBlows,
      deaths: st.deaths,
      assists: st.assists,
      defAssists: st.defAssists,
      damage: st.damage,
      healing: st.healing,
      blocked: st.blocked,
      taken: st.taken,
      ults: st.ults || myUlts.length,
      solo: st.solo,
      fun: {
        sleeps,
        sleepShots: abs.filter((a) => a.key === key && a.slot === 1 && a.hero === '아나').length,
        slept: asleep.filter((a) => a.key === key).length,
        rez: abs.filter((a) => a.key === key && a.slot === 2 && a.hero === '메르시').length,
        ultDeaths,
        ultKills: myKills.filter((k) => k.ability === 5).length,
        meleeKills: myKills.filter((k) => k.ability === 6).length,
        envKills: st.envKills,
        envDeaths: st.envDeaths,
      },
    };
  });
  players.sort((a, b) => a.team - b.team || roleOrder(a.role) - roleOrder(b.role) || b.damage - a.damage);

  // PIR 2.0 재료: 한타 상황으로 보정한 결정타·데스·피해·치유·궁 효율
  const sizeOf = { 1: Math.max(startRoster[1].size, finishers[1]), 2: Math.max(startRoster[2].size, finishers[2]) };
  const analysis = analyzeMatch(players, { t0, t1, teamSize: sizeOf, kills, spawns, ults: ults.filter((u) => u.key), snaps, abs: abs.filter((a) => a.key) });
  for (const pl of players) pl.pir2 = roundInputs(analysis.inputs.get(pl.key));

  return {
    ok: true,
    match: {
      id: matchIdOf(lines),
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
      fights: analysis.fights,
      precise: { spawns: spawns.length > 0, snaps: snaps.length > 0 },
      players,
    },
  };
}

/**
 * 궁 기록 정리: 키리코 여우길처럼 오래 가는 궁은 쓰는 동안 "궁 사용 중" 상태가 깜빡여서 한 번 쓴 궁이 여러 줄로 찍힌다.
 * 같은 사람의 궁 기록이 12초 안에 이어지면 한 번으로 친다. (궁을 12초 만에 다시 채우는 영웅은 없다)
 */
export function dedupeUlts(list) {
  const out = [];
  const last = new Map();
  for (const u of [...list].sort((a, b) => a.t - b.t)) {
    const who = u.key || u.name;
    const prev = last.get(who);
    last.set(who, u.t);
    if (prev != null && u.t - prev <= 12) continue;
    out.push(u);
  }
  return out;
}

function roundInputs(i) {
  return Object.fromEntries(Object.entries(i).map(([k, v]) => [k, Math.round(v * 100) / 100]));
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
  // PIR 2.0 기록이 있으면 한타 장면도
  if (ps.every((p) => p.pir2)) {
    const opener = top((p) => p.pir2.firstKills, 2);
    if (opener) out.push({ kind: 'good', icon: '⚔️', who: opener, text: `한타 첫 킬 ${opener.pir2.firstKills}번` });
    const clutch = top((p) => p.pir2.clutchKills, 2);
    if (clutch) out.push({ kind: 'good', icon: '🔄', who: clutch, text: `열세에서 킬 ${clutch.pir2.clutchKills}번` });
    const sweeper = top((p) => p.pir2.decidedKills, 4);
    if (sweeper) out.push({ kind: 'bad', icon: '🧹', who: sweeper, text: `이미 끝난 한타에서 킬 줍기 ${sweeper.pir2.decidedKills}번` });
    const picked = top((p) => p.pir2.picks, 2);
    if (picked) out.push({ kind: 'bad', icon: '🎯', who: picked, text: `한타도 아닌데 혼자 잡힘 ${picked.pir2.picks}번` });
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

function zonedToUtc(y, mo, d, h, mi, se, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, se);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, Number(p.value)]),
  );
  const asZoned = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return guess - (asZoned - guess);
}

/**
 * 경기 시작 시각. 워크샵 로그 파일 이름(Log-2026-11-26-21-55-34.txt)은 파일을 만든 시각이고,
 * 줄 앞의 [00:01:07]은 시계가 아니라 파일을 만든 뒤 지난 시간이다.
 */
export function owPlayedAt(fileName, text, timeZone = 'Asia/Seoul') {
  const m = /(\d{4})-(\d{2})-(\d{2})[-_ T](\d{2})-(\d{2})-(\d{2})/.exec(String(fileName || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const fileStart = zonedToUtc(y, mo, d, h, mi, se, timeZone);
  const lines = String(text || '').split(/\r?\n/);
  let lastEnd = -1;
  lines.forEach((l, i) => l.includes('TN,end,') && (lastEnd = i));
  let startLine = null;
  for (let i = (lastEnd < 0 ? lines.length : lastEnd) - 1; i >= 0; i--) {
    if (lines[i].includes('TN,start,')) {
      startLine = lines[i];
      break;
    }
  }
  const c = /\[(\d{1,2}):(\d{2}):(\d{2})\]/.exec(startLine || '');
  return fileStart + (c ? (Number(c[1]) * 3600 + Number(c[2]) * 60 + Number(c[3])) * 1000 : 0);
}
