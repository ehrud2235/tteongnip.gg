// 가짜 내전 기록으로 사이트를 미리 본다 (진짜 DB는 건드리지 않음).
//   npm run demo   →  http://localhost:3000
import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/db/index.js';
import { createDDragon } from '../src/ddragon.js';
import { createOwHeroes } from '../src/ow-heroes.js';
import { createApp } from '../src/app.js';
import { normalizeGame } from '../src/game.js';
import { normalizeOverwatch } from '../src/overwatch.js';

const NAMES = ['쌈무', '떡볶이', '순대국밥', '정글차이', '미드는내꺼', '원딜장인', '서폿충', '탑신병자', '칼바람전사', '용사냥꾼', '바론스틸', '와드박이', '귀환중', '건들면수플렉스갈기고야차룰로한판'];
const TAGS = ['KR1', 'KR1', '0001', 'MID', 'KR1', 'ADC', 'SUP', 'KR2', 'KR1', 'DRG', 'KR1', 'WARD', 'KR1', 'KR3'];
// 라인별 챔피언 번호 (탑, 정글, 미드, 원딜, 서폿)
const POOL = [
  [266, 122, 86, 24, 875, 897],
  [64, 104, 121, 234, 200, 76],
  [103, 238, 157, 112, 61, 4],
  [222, 51, 145, 202, 81, 236],
  [412, 117, 497, 111, 89, 350],
];
const SPELLS = [[4, 12], [4, 11], [4, 14], [4, 7], [4, 14]];
const ITEMS = [
  [3078, 3047, 6333, 3053, 3065, 3075],
  [6692, 3111, 3071, 3026, 3156, 3814],
  [6655, 3020, 4645, 3089, 3157, 3135],
  [3031, 3006, 3094, 3036, 3072, 3046],
  [3869, 3158, 3190, 3109, 4005, 3222],
];

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const shuffle = (xs) => xs.map((x) => [rand(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const skill = Object.fromEntries(NAMES.map((n, i) => [n, 0.35 + (i % 5) * 0.08 + rand() * 0.1]));

function makeGame(i, now) {
  const roster = shuffle(NAMES).slice(0, 10);
  const blue = roster.slice(0, 5);
  const red = roster.slice(5);
  const power = (team) => team.reduce((a, n) => a + skill[n], 0);
  const winner = rand() < power(blue) / (power(blue) + power(red)) ? 100 : 200;
  const duration = 1300 + Math.floor(rand() * 900);
  const participants = [];
  const participantIdentities = [];
  roster.forEach((name, idx) => {
    // 어시스트는 팀 킬보다 많을 수 없다 (아래에서 팀별로 맞춘다)
    const lane = idx % 5;
    const teamId = idx < 5 ? 100 : 200;
    const won = teamId === winner;
    const k = Math.floor(rand() * (lane === 4 ? 4 : 11)) + (won ? 2 : 0);
    const d = Math.floor(rand() * 8) + (won ? 0 : 2);
    const a = Math.floor(rand() * 9) + (lane === 4 ? 5 : 1) + (won ? 3 : 0);
    const items = shuffle(ITEMS[lane]).slice(0, 3 + Math.floor(rand() * 3));
    while (items.length < 6) items.push(0);
    participants.push({
      participantId: idx + 1,
      teamId,
      championId: pick(POOL[lane]),
      spell1Id: SPELLS[lane][0],
      spell2Id: SPELLS[lane][1],
      stats: {
        win: won,
        champLevel: 12 + Math.floor(rand() * 6),
        kills: k,
        deaths: d,
        assists: a,
        totalMinionsKilled: lane === 4 ? 25 + Math.floor(rand() * 20) : lane === 1 ? 30 : 150 + Math.floor(rand() * 90),
        neutralMinionsKilled: lane === 1 ? 140 + Math.floor(rand() * 60) : Math.floor(rand() * 8),
        goldEarned: 8000 + Math.floor(rand() * 7000) + (won ? 1500 : 0),
        totalDamageDealtToChampions: (lane === 4 ? 6000 : 12000) + Math.floor(rand() * 20000),
        totalDamageTaken: 12000 + Math.floor(rand() * 20000),
        visionScore: lane === 4 ? 45 + Math.floor(rand() * 40) : 12 + Math.floor(rand() * 25),
        wardsPlaced: lane === 4 ? 25 : 8,
        visionWardsBoughtInGame: Math.floor(rand() * 5),
        ...Object.fromEntries(items.map((it, j) => [`item${j}`, it])),
        item6: lane === 4 ? 3364 : 3340,
        perk0: pick([8005, 8010, 8112, 8214, 8437, 8229]),
        perkSubStyle: pick([8000, 8100, 8200, 8300, 8400]),
        pentaKills: rand() < 0.01 ? 1 : 0,
      },
      timeline: { lane: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'BOTTOM'][lane], role: ['SOLO', 'NONE', 'SOLO', 'DUO_CARRY', 'DUO_SUPPORT'][lane] },
    });
    participantIdentities.push({
      participantId: idx + 1,
      player: { gameName: name, tagLine: TAGS[NAMES.indexOf(name)], puuid: `demo-${NAMES.indexOf(name)}-${Buffer.from(name).toString('hex')}`, platformId: 'KR' },
    });
  });
  for (const teamId of [100, 200]) {
    const team = participants.filter((p) => p.teamId === teamId);
    const kills = team.reduce((sum, p) => sum + p.stats.kills, 0);
    for (const p of team) p.stats.assists = Math.min(p.stats.assists, Math.max(0, kills - p.stats.kills));
  }
  return {
    gameId: 7300000000 + i,
    platformId: 'KR',
    gameCreation: now - (40 - i) * 26 * 3600e3 - Math.floor(rand() * 3600e3),
    gameDuration: duration,
    gameMode: 'CLASSIC',
    gameType: 'CUSTOM_GAME',
    gameVersion: '16.23.712.1',
    mapId: 11,
    teams: [100, 200].map((teamId) => ({
      teamId,
      win: teamId === winner ? 'Win' : 'Fail',
      bans: [pick(POOL[2]), pick(POOL[1]), pick(POOL[3])].map((championId) => ({ championId })),
      towerKills: teamId === winner ? 7 + Math.floor(rand() * 4) : Math.floor(rand() * 5),
      dragonKills: Math.floor(rand() * 4),
      baronKills: teamId === winner ? Math.floor(rand() * 2) : 0,
    })),
    participants,
    participantIdentities,
  };
}

const config = loadConfig({ ...process.env, SESSION_SECRET: 'demo', DISCORD_CLIENT_ID: '', DISCORD_WEBHOOK_URL: '' });
const db = await openStore({ sqliteFile: ':memory:' });
const ddragon = createDDragon();
await ddragon.start();
const now = Date.now();
for (let i = 0; i < 40; i++) {
  const raw = makeGame(i, now);
  const r = normalizeGame(raw, { championTags: (id) => ddragon.championTags(id) });
  if (r.ok) await db.insertMatch({ match: r.match, raw, uploadedBy: 'shared' });
}
// ---------- 오버워치 가짜 경기 (워크샵 로그 모양 그대로) ----------
const OW_PLAYERS = [
  ['라인장인', 1], ['방패든남자', 1], ['자리야누나', 1],
  ['겐지충', 2], ['에임봇', 2], ['트레뽀', 2], ['위도우장인', 2], ['솔져태엽', 2],
  ['아나장인', 3], ['루시우붐', 3], ['메르시빌런', 3], ['힐러구함', 3],
];
const OW_POOL = {
  1: ['라인하르트', '윈스턴', '자리야', 'D.Va', '시그마', '오리사', '로드호그', '정커퀸'],
  2: ['겐지', '트레이서', '위도우메이커', '캐서디', '솔저: 76', '애쉬', '한조', '소전', '에코', '파라'],
  3: ['아나', '메르시', '루시우', '키리코', '젠야타', '바티스트', '모이라', '브리기테'],
};
const OW_MAPS = [['왕의 길', '혼합'], ['일리오스', '쟁탈'], ['66번 국도', '호위'], ['뉴 퀸 스트리트', '밀기'], ['부산', '쟁탈'], ['지브롤터', '호위']];
const FAV = { 아나장인: '아나', 메르시빌런: '메르시', 루시우붐: '루시우', 겐지충: '겐지', 위도우장인: '위도우메이커', 라인장인: '라인하르트', 자리야누나: '자리야' };

function makeOwDemoLog(i) {
  const byRole = (r) => shuffle(OW_PLAYERS.filter((p) => p[1] === r).map((p) => p[0]));
  const tanks = byRole(1);
  const dps = byRole(2);
  const sups = byRole(3);
  const teams = [
    [[tanks[0], 1], [dps[0], 2], [dps[1], 2], [sups[0], 3], [sups[1], 3]],
    [[tanks[1], 1], [dps[2], 2], [dps[3], 2], [sups[2], 3], [sups[3], 3]],
  ];
  const [map, mode] = pick(OW_MAPS);
  const t0 = 40;
  const t1 = t0 + 600 + Math.floor(rand() * 600);
  const lines = [];
  const L = (s) => lines.push(`[21:00:00] TN,${s}`);
  const hero = {};
  teams.forEach((team, ti) =>
    team.forEach(([name, role]) => {
      hero[name] = FAV[name] && rand() < 0.7 ? FAV[name] : pick(OW_POOL[role]);
      L(`hero,5,${name},${ti + 1},${role},${hero[name]}`);
    }),
  );
  L(`start,${t0},${map},${mode}`);
  const all = teams.flatMap((team, ti) => team.map(([name, role]) => ({ name, role, team: ti + 1 })));
  const enemiesOf = (p) => all.filter((q) => q.team !== p.team);
  for (let t = t0 + 20; t < t1; t += 15 + Math.floor(rand() * 20)) {
    const a = pick(all);
    const v = pick(enemiesOf(a));
    if (hero[a.name] === '아나' && rand() < 0.5) {
      L(`ab1,${t},${a.name},아나`);
      if (rand() < 0.6) L(`asleep,${t + 1},${v.name}`);
    }
    if (hero[a.name] === '메르시' && rand() < 0.15) L(`ab2,${t},${a.name},메르시`);
    if (rand() < 0.12) {
      L(`ult,${t},${a.name},${hero[a.name]}`);
      if (rand() < 0.3) L(`kill,${t + 2},${v.name},${hero[v.name]},${a.name},${hero[a.name]},1`);
      else L(`kill,${t + 1},${a.name},${hero[a.name]},${v.name},${hero[v.name]},5`);
    } else {
      L(`kill,${t},${a.name},${hero[a.name]},${v.name},${hero[v.name]},${rand() < 0.08 ? 6 : 1}`);
    }
  }
  const team1Power = teams[0].reduce((s, [n]) => s + (skill[n] ?? 0.5), 0);
  const team2Power = teams[1].reduce((s, [n]) => s + (skill[n] ?? 0.5), 0);
  const win1 = rand() < team1Power / (team1Power + team2Power);
  const score = mode === '쟁탈' ? (win1 ? [2, Math.floor(rand() * 2)] : [Math.floor(rand() * 2), 2]) : win1 ? [3, 2] : [1, 2];
  for (const p of all) {
    const won = (p.team === 1) === win1;
    const elims = 8 + Math.floor(rand() * 18) + (won ? 4 : 0);
    const deaths = 2 + Math.floor(rand() * 9) + (won ? 0 : 2);
    const dmg = p.role === 3 ? 2500 + rand() * 4000 : p.role === 1 ? 6000 + rand() * 6000 : 7000 + rand() * 9000;
    const heal = p.role === 3 ? 7000 + rand() * 7000 : 0;
    const block = p.role === 1 ? 6000 + rand() * 12000 : 0;
    const env = p.name === '루시우붐' && rand() < 0.6 ? 1 + Math.floor(rand() * 2) : 0;
    const fall = rand() < 0.15 ? 1 : 0;
    L(`stat,${p.name},${p.team},${elims},${Math.floor(elims / 2.5)},${deaths},${Math.round(dmg)},${Math.round(heal)},${Math.round(block)},${2 + Math.floor(rand() * 4)},${env},${fall},${Math.floor(rand() * 3)},${Math.round(dmg * 0.8)},${Math.floor(elims * 0.6)},${Math.floor(rand() * 4)}`);
  }
  L(`end,${t1 + 1},${score[0]},${score[1]}`);
  return lines.join('\n');
}
for (const n of OW_PLAYERS) skill[n[0]] = 0.35 + rand() * 0.3;
for (let i = 0; i < 25; i++) {
  const log = makeOwDemoLog(i);
  const r = normalizeOverwatch(log, { playedAt: now - (25 - i) * 30 * 3600e3 });
  if (r.ok) await db.insertMatch({ match: r.match, raw: { log }, uploadedBy: 'shared' });
  else console.log('demo ow skipped:', r.reason);
}

const owHeroes = createOwHeroes();
await owHeroes.start();
const app = createApp({ config, db, ddragon, owHeroes });
http.createServer(app.handle).listen(config.port, () => console.log(`미리 보기: http://localhost:${config.port}`));
