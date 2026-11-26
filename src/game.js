// 롤 클라이언트(LCU) 전적 데이터를 사이트에서 쓰는 형태로 바꾼다.
// 수집기는 클라이언트가 준 데이터를 그대로 보내고, 해석은 전부 서버가 한다.
// (해석을 고쳐도 수집기를 다시 배포할 필요가 없고, 원본은 DB에 따로 남는다.)
import { assignPositions, POSITIONS } from './positions.js';

const ZERO_PUUID = /^[0-]*$/;

const fail = (reason) => ({ ok: false, reason });

function cleanPuuid(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return !s || ZERO_PUUID.test(s) ? '' : s;
}

function shortVersion(v) {
  const parts = String(v || '').split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : String(v || '');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** LCU /lol-match-history/v1/games/{gameId} 응답 */
function fromLcu(raw) {
  if (raw.gameId == null || !Array.isArray(raw.participants)) return null;
  const identities = new Map((raw.participantIdentities || []).map((x) => [x.participantId, x.player || {}]));
  const teamWin = new Map((raw.teams || []).map((t) => [t.teamId, t.win === 'Win' || t.win === true]));
  const players = raw.participants.map((p) => {
    const id = identities.get(p.participantId) || {};
    const s = p.stats || {};
    return {
      participantId: p.participantId,
      puuid: cleanPuuid(id.puuid),
      name: id.gameName || id.summonerName || '',
      tag: id.tagLine || '',
      teamId: num(p.teamId),
      win: typeof s.win === 'boolean' ? s.win : teamWin.get(p.teamId) === true,
      championId: num(p.championId),
      champLevel: num(s.champLevel),
      kills: num(s.kills),
      deaths: num(s.deaths),
      assists: num(s.assists),
      cs: num(s.totalMinionsKilled) + num(s.neutralMinionsKilled),
      neutralCs: num(s.neutralMinionsKilled),
      gold: num(s.goldEarned),
      damage: num(s.totalDamageDealtToChampions),
      damageTaken: num(s.totalDamageTaken),
      vision: num(s.visionScore),
      wards: num(s.wardsPlaced),
      controlWards: num(s.visionWardsBoughtInGame),
      items: [0, 1, 2, 3, 4, 5, 6].map((i) => num(s[`item${i}`])),
      spells: [num(p.spell1Id), num(p.spell2Id)],
      keystone: num(s.perk0),
      subStyle: num(s.perkSubStyle),
      multikills: [num(s.doubleKills), num(s.tripleKills), num(s.quadraKills), num(s.pentaKills)],
      firstBlood: Boolean(s.firstBloodKill),
      hint: { lane: p.timeline?.lane || '', role: p.timeline?.role || '' },
    };
  });
  const teams = (raw.teams || []).map((t) => ({
    teamId: num(t.teamId),
    bans: (t.bans || []).map((b) => num(b.championId)).filter((id) => id > 0),
    towers: num(t.towerKills),
    dragons: num(t.dragonKills),
    barons: num(t.baronKills),
  }));
  let duration = num(raw.gameDuration);
  if (duration > 20000) duration = Math.round(duration / 1000); // 밀리초로 온 경우
  return {
    gameId: num(raw.gameId),
    platformId: String(raw.platformId || 'KR'),
    gameType: raw.gameType,
    mode: raw.gameMode,
    mapId: num(raw.mapId),
    version: shortVersion(raw.gameVersion),
    createdAt: num(raw.gameCreation) || Date.parse(raw.gameCreationDate) || 0,
    duration,
    players,
    teams,
  };
}

/** 라이엇 match-v5 형식 (토너먼트 코드 경기 등) */
function fromMatchV5(raw) {
  const info = raw.info;
  if (!info || !Array.isArray(info.participants)) return null;
  const players = info.participants.map((p) => {
    const styles = p.perks?.styles || [];
    return {
      participantId: p.participantId,
      puuid: cleanPuuid(p.puuid),
      name: p.riotIdGameName || p.summonerName || '',
      tag: p.riotIdTagline || '',
      teamId: num(p.teamId),
      win: Boolean(p.win),
      championId: num(p.championId),
      champLevel: num(p.champLevel),
      kills: num(p.kills),
      deaths: num(p.deaths),
      assists: num(p.assists),
      cs: num(p.totalMinionsKilled) + num(p.neutralMinionsKilled),
      neutralCs: num(p.neutralMinionsKilled),
      gold: num(p.goldEarned),
      damage: num(p.totalDamageDealtToChampions),
      damageTaken: num(p.totalDamageTaken),
      vision: num(p.visionScore),
      wards: num(p.wardsPlaced),
      controlWards: num(p.visionWardsBoughtInGame),
      items: [0, 1, 2, 3, 4, 5, 6].map((i) => num(p[`item${i}`])),
      spells: [num(p.summoner1Id), num(p.summoner2Id)],
      keystone: num(styles[0]?.selections?.[0]?.perk),
      subStyle: num(styles[1]?.style),
      multikills: [num(p.doubleKills), num(p.tripleKills), num(p.quadraKills), num(p.pentaKills)],
      firstBlood: Boolean(p.firstBloodKill),
      hint: { position: p.teamPosition || p.individualPosition || '' },
    };
  });
  const teams = (info.teams || []).map((t) => ({
    teamId: num(t.teamId),
    bans: (t.bans || []).map((b) => num(b.championId)).filter((id) => id > 0),
    towers: num(t.objectives?.tower?.kills),
    dragons: num(t.objectives?.dragon?.kills),
    barons: num(t.objectives?.baron?.kills),
  }));
  return {
    gameId: num(info.gameId),
    platformId: String(info.platformId || 'KR'),
    gameType: info.gameType,
    mode: info.gameMode,
    mapId: num(info.mapId),
    version: shortVersion(info.gameVersion),
    createdAt: num(info.gameCreation),
    duration: num(info.gameDuration),
    players,
    teams,
  };
}

/**
 * 원본 게임 데이터를 검사하고 정리한다.
 * @returns {{ok: true, match: object} | {ok: false, reason: string}}
 */
export function normalizeGame(raw, opts = {}) {
  const { minPlayers = 10, minDuration = 300, allowedModes = ['CLASSIC'], championTags } = opts;
  if (!raw || typeof raw !== 'object') return fail('게임 데이터가 비어 있어요');
  const g = raw.info && raw.metadata ? fromMatchV5(raw) : fromLcu(raw);
  if (!g || !g.gameId) return fail('알 수 없는 게임 데이터 형식이에요');
  if (g.gameType !== 'CUSTOM_GAME') return fail('사용자 설정 게임(내전)이 아니에요');
  if (!allowedModes.includes(g.mode)) return fail(`기록하지 않는 모드예요 (${g.mode || '알 수 없음'})`);
  if (g.players.length < minPlayers) return fail(`${minPlayers}명이 안 되는 게임이에요 (${g.players.length}명)`);
  if (g.players.some((p) => !p.puuid)) return fail('봇이나 정보가 없는 플레이어가 있는 게임이에요');
  if (new Set(g.players.map((p) => p.puuid)).size !== g.players.length) return fail('같은 플레이어가 두 번 들어 있어요');
  const teamIds = new Set(g.players.map((p) => p.teamId));
  if (teamIds.size !== 2 || !teamIds.has(100) || !teamIds.has(200)) return fail('두 팀으로 나뉜 게임이 아니에요');
  if (g.duration < minDuration) return fail(`너무 짧은 게임이에요 (${Math.floor(g.duration / 60)}분)`);
  const winners = new Set(g.players.filter((p) => p.win).map((p) => p.teamId));
  if (winners.size !== 1) return fail('어느 팀이 이겼는지 알 수 없는 게임이에요');
  const winner = [...winners][0];

  for (const p of g.players) p.win = p.teamId === winner;
  if (g.mode === 'CLASSIC') {
    for (const teamId of [100, 200]) {
      const team = g.players.filter((p) => p.teamId === teamId);
      const positions = assignPositions(team, championTags);
      team.forEach((p, i) => {
        p.autoPosition = positions[i] || null;
        p.position = p.autoPosition;
      });
    }
  } else {
    for (const p of g.players) p.position = p.autoPosition = null;
  }

  return {
    ok: true,
    match: {
      id: `${g.platformId}_${g.gameId}`,
      gameId: g.gameId,
      platformId: g.platformId,
      mode: g.mode,
      mapId: g.mapId,
      version: g.version,
      createdAt: g.createdAt,
      duration: g.duration,
      winner,
      teams: g.teams,
      players: g.players,
    },
  };
}

/** 사람이 고친 라인을 적용한다. positions: { [participantId]: 'TOP' | ... | '' (자동) } */
export function applyPositionEdits(match, positions) {
  for (const p of match.players) {
    if (!(String(p.participantId) in positions)) continue;
    const value = positions[p.participantId];
    if (value === '' || value == null) {
      p.position = p.autoPosition ?? null;
      delete p.positionManual;
    } else if (POSITIONS.includes(value)) {
      p.position = value;
      p.positionManual = true;
    }
  }
  return match;
}
