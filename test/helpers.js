import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/db/index.js';
import { createDDragon } from '../src/ddragon.js';
import { createApp } from '../src/app.js';

// 테스트용: 롤 클라이언트(/lol-match-history/v1/games/{id})가 주는 모양 그대로 게임 데이터를 만든다.
const DEFAULT_LANES = [
  { lane: 'TOP', role: 'SOLO', champ: 266, spells: [4, 12] },
  { lane: 'JUNGLE', role: 'NONE', champ: 64, spells: [4, 11] },
  { lane: 'MIDDLE', role: 'SOLO', champ: 103, spells: [4, 14] },
  { lane: 'BOTTOM', role: 'DUO_CARRY', champ: 222, spells: [4, 7] },
  { lane: 'BOTTOM', role: 'DUO_SUPPORT', champ: 412, spells: [4, 14] },
];

export function puuidOf(name) {
  return `puuid-${Buffer.from(name).toString('hex')}`.padEnd(40, '0').slice(0, 78);
}

/**
 * @param {object} o
 * @param {number} o.gameId
 * @param {string[]} o.blue 블루팀 닉네임 5개
 * @param {string[]} o.red  레드팀 닉네임 5개
 * @param {100|200} o.winner
 */
export function makeLcuGame({
  gameId = 7000000001,
  createdAt = Date.UTC(2026, 10, 20, 12, 0),
  duration = 1800,
  blue = ['가', '나', '다', '라', '마'],
  red = ['바', '사', '아', '자', '차'],
  winner = 100,
  gameType = 'CUSTOM_GAME',
  gameMode = 'CLASSIC',
  champions = {},
  hideIdentity = [],
} = {}) {
  const participants = [];
  const participantIdentities = [];
  const roster = [...blue.map((n) => [n, 100]), ...red.map((n) => [n, 200])];
  roster.forEach(([name, teamId], i) => {
    const participantId = i + 1;
    const lane = DEFAULT_LANES[i % 5];
    const isSupport = lane.role === 'DUO_SUPPORT';
    const isJungle = lane.lane === 'JUNGLE';
    participants.push({
      participantId,
      teamId,
      championId: champions[name] ?? lane.champ + (teamId === 200 ? 1 : 0),
      spell1Id: lane.spells[0],
      spell2Id: lane.spells[1],
      stats: {
        participantId,
        win: teamId === winner,
        champLevel: 15,
        kills: 3 + (i % 4),
        deaths: 2 + (i % 3),
        assists: 5 + (i % 5),
        totalMinionsKilled: isSupport ? 30 : isJungle ? 40 : 180 + i,
        neutralMinionsKilled: isJungle ? 150 : 4,
        goldEarned: 11000 + i * 100,
        totalDamageDealtToChampions: 15000 + i * 1000,
        totalDamageTaken: 20000,
        visionScore: isSupport ? 60 : 20,
        wardsPlaced: isSupport ? 30 : 8,
        visionWardsBoughtInGame: 2,
        item0: isSupport ? 3869 : 3078,
        item1: 3047,
        item2: 6333,
        item3: 0,
        item4: 0,
        item5: 0,
        item6: 3340,
        perk0: 8010,
        perkPrimaryStyle: 8000,
        perkSubStyle: 8400,
        doubleKills: i === 3 ? 1 : 0,
        tripleKills: 0,
        quadraKills: 0,
        pentaKills: 0,
        firstBloodKill: i === 0,
      },
      timeline: { participantId, lane: lane.lane, role: lane.role },
    });
    const hidden = hideIdentity.includes(name);
    participantIdentities.push({
      participantId,
      player: {
        accountId: 1000 + i,
        currentPlatformId: 'KR',
        gameName: name,
        tagLine: 'KR1',
        platformId: 'KR',
        profileIcon: 29,
        puuid: hidden ? '' : puuidOf(name),
        summonerId: hidden ? 0 : 2000 + i,
        summonerName: '',
      },
    });
  });
  return {
    gameId,
    platformId: 'KR',
    gameCreation: createdAt,
    gameCreationDate: new Date(createdAt).toISOString(),
    gameDuration: duration,
    gameMode,
    gameType,
    gameVersion: '16.23.712.4321',
    mapId: gameMode === 'ARAM' ? 12 : 11,
    queueId: 0,
    seasonId: 0,
    teams: [
      { teamId: 100, win: winner === 100 ? 'Win' : 'Fail', bans: [{ championId: 157, pickTurn: 1 }], towerKills: 8, dragonKills: 3, baronKills: 1 },
      { teamId: 200, win: winner === 200 ? 'Win' : 'Fail', bans: [{ championId: 238, pickTurn: 2 }], towerKills: 3, dragonKills: 1, baronKills: 0 },
    ],
    participants,
    participantIdentities,
  };
}

/** 롤 클라이언트 전적 목록(/lol-match-history/v1/products/lol/current-summoner/matches) 모양 */
export function makeHistoryList(games) {
  return {
    accountId: 1000,
    platformId: 'KR',
    games: {
      gameBeginDate: '',
      gameCount: games.length,
      gameEndDate: '',
      gameIndexBegin: 0,
      gameIndexEnd: games.length - 1,
      games: games.map((g) => ({
        gameId: g.gameId,
        platformId: g.platformId,
        gameCreation: g.gameCreation,
        gameDuration: g.gameDuration,
        gameMode: g.gameMode,
        gameType: g.gameType,
        queueId: g.queueId ?? 0,
        participants: [g.participants[0]],
        participantIdentities: [g.participantIdentities[0]],
      })),
    },
  };
}

// 테스트용 사이트 서버 (메모리 DB, 인터넷 안 씀)
const quiet = { info() {}, warn() {}, error() {} };

export async function startApp(env = {}, { fetch } = {}) {
  const config = loadConfig({ SESSION_SECRET: 'test-secret', BASE_URL: 'http://tteongnip.test', ...env });
  const db = await openStore({ sqliteFile: ':memory:' });
  const ddragon = createDDragon({ fetch: async () => { throw new Error('offline'); }, log: quiet });
  ddragon._set({ champions: { 266: { id: 'Aatrox', name: '아트록스', tags: ['Fighter'] } } });
  const owHeroes = { impl: null, portrait: (name) => owHeroes.impl?.portrait(name) ?? null };
  const app = createApp({ config, db, ddragon, owHeroes, fetch, log: quiet });
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    app,
    db,
    config,
    setOwHeroes: (impl) => (owHeroes.impl = impl),
    close: async () => {
      await app.drain();
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}


// 테스트용: 우리 워크샵 스크립트가 남기는 로그 파일 내용을 만든다.
export const OW_TEAM1 = [
  ['라인장인', 1, '라인하르트'],
  ['겐지충', 2, '겐지'],
  ['트레이서', 2, '트레이서'],
  ['아나장인', 3, '아나'],
  ['루시우', 3, '루시우'],
];
export const OW_TEAM2 = [
  ['윈스턴', 1, '윈스턴'],
  ['위도우', 2, '위도우메이커'],
  ['솔저', 2, '솔저: 76'],
  ['메르시', 3, '메르시'],
  ['젠야타', 3, '젠야타'],
];

export function makeOwLog({
  team1 = OW_TEAM1,
  team2 = OW_TEAM2,
  score = [3, 2],
  t0 = 30,
  t1 = 900,
  map = '왕의 길',
  mode = '혼합',
  clockBase = 20 * 3600,
  extra = [],
  sleeps = 1,
  complete = true,
  withStart = true,
  obj = null,
} = {}) {
  const lines = [];
  const at = (t, s) => {
    const c = clockBase + t;
    const hh = String(Math.floor(c / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor(c / 60) % 60).padStart(2, '0');
    const ss = String(c % 60).padStart(2, '0');
    lines.push(`[${hh}:${mm}:${ss}] ${s}`);
  };
  const roster = [...team1.map((p) => [...p, 1]), ...team2.map((p) => [...p, 2])];
  for (const [name, role, hero, team] of roster) at(5, `TN,hero,5,${name},${team},${role},${hero}`);
  if (withStart) at(t0, `TN,start,${t0},${map},${mode}`);
  for (let i = 0; i < sleeps; i++) {
    at(100 + i * 20, `TN,ab1,${100 + i * 20},아나장인,아나`);
    at(101 + i * 20, `TN,asleep,${101 + i * 20},${i % 2 ? '위도우' : '윈스턴'}`);
  }
  at(120, 'TN,ult,120,겐지충,겐지');
  at(122, 'TN,kill,122,겐지충,겐지,위도우,위도우메이커,5');
  at(150, 'TN,kill,150,겐지충,겐지,젠야타,젠야타,6');
  at(160, 'TN,kill,160,겐지충,겐지,메르시,메르시,6');
  at(170, 'TN,ab2,170,메르시,메르시');
  at(171, 'TN,ab2,171,메르시,메르시');
  at(200, 'TN,ult,200,솔저,솔저: 76');
  at(202, 'TN,kill,202,트레이서,트레이서,솔저,솔저: 76,1');
  at(600, 'TN,hero,600,트레이서,1,2,솜브라');
  for (const [t, s] of extra) at(t, s);
  if (complete) {
    roster.forEach(([name, role, , team], i) => {
      const envKills = name === '루시우' ? 1 : 0;
      const envDeaths = name === '위도우' ? 1 : 0;
      at(t1, `TN,stat,${name},${team},${10 + i},${4 + (i % 3)},${3 + (i % 4)},${role === 2 ? 9000 + i * 100 : 4000},${role === 3 ? 8000 + i * 10 : 0},${role === 1 ? 12000 : 0},${2 + (i % 2)},${envKills},${envDeaths},1,7000,${5 + i},2`);
    });
    if (obj) at(t1, `TN,obj,${obj}`);
    at(t1 + 1, `TN,end,${t1 + 1},${score[0]},${score[1]}`);
  }
  return lines.join('\r\n') + '\r\n';
}
