// 가짜 내전 기록으로 사이트를 미리 본다 (진짜 DB는 건드리지 않음).
//   npm run demo   →  http://localhost:3000
import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/db/index.js';
import { createDDragon } from '../src/ddragon.js';
import { createApp } from '../src/app.js';
import { normalizeGame } from '../src/game.js';

const NAMES = ['쌈무', '떡볶이', '순대국밥', '정글차이', '미드는내꺼', '원딜장인', '서폿충', '탑신병자', '칼바람전사', '용사냥꾼', '바론스틸', '와드박이', '귀환중', '점멸없음'];
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
const app = createApp({ config, db, ddragon });
http.createServer(app.handle).listen(config.port, () => console.log(`미리 보기: http://localhost:${config.port}`));
