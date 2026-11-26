import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGame, applyPositionEdits } from '../src/game.js';
import { assignPositions } from '../src/positions.js';
import { computeStats, relationList, START_RATING } from '../src/stats.js';
import { makeLcuGame, puuidOf } from './helpers.js';

test('롤 클라이언트 내전 데이터를 정리한다', () => {
  const r = normalizeGame(makeLcuGame({ gameId: 123, winner: 200 }));
  assert.equal(r.ok, true, r.reason);
  const m = r.match;
  assert.equal(m.id, 'KR_123');
  assert.equal(m.winner, 200);
  assert.equal(m.version, '16.23');
  assert.equal(m.players.length, 10);
  const p = m.players[0];
  assert.equal(p.name, '가');
  assert.equal(p.tag, 'KR1');
  assert.equal(p.puuid, puuidOf('가'));
  assert.equal(p.win, false);
  assert.equal(p.items.length, 7);
  assert.deepEqual(m.teams.map((t) => t.bans), [[157], [238]]);
  assert.deepEqual(
    m.players.slice(0, 5).map((x) => x.position),
    ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'],
  );
});

test('내전이 아닌 게임은 거른다', () => {
  assert.match(normalizeGame(makeLcuGame({ gameType: 'MATCHED_GAME' })).reason, /사용자 설정/);
  assert.match(normalizeGame(makeLcuGame({ gameMode: 'PRACTICETOOL' })).reason, /모드/);
  assert.match(normalizeGame(makeLcuGame({ duration: 120 })).reason, /짧은/);
  assert.match(normalizeGame(makeLcuGame({ hideIdentity: ['다'] })).reason, /봇/);
  assert.match(normalizeGame(makeLcuGame({ blue: ['a', 'b', 'c'], red: ['d', 'e', 'f'] })).reason, /10명/);
  assert.equal(normalizeGame(null).ok, false);
  assert.equal(normalizeGame({ foo: 1 }).ok, false);
});

test('칼바람은 설정했을 때만 기록하고 라인은 비운다', () => {
  const game = makeLcuGame({ gameMode: 'ARAM' });
  assert.equal(normalizeGame(game).ok, false);
  const r = normalizeGame(game, { allowedModes: ['CLASSIC', 'ARAM'] });
  assert.equal(r.ok, true);
  assert.ok(r.match.players.every((p) => p.position === null));
});

test('라인 단서가 없어도 강타와 서폿 아이템으로 정글/서폿을 찾는다', () => {
  const base = { cs: 200, neutralCs: 0, items: [], spells: [4, 12], hint: {} };
  const team = [
    { ...base, championId: 1 },
    { ...base, championId: 2, spells: [4, 11], neutralCs: 160, cs: 180 },
    { ...base, championId: 3 },
    { ...base, championId: 4 },
    { ...base, championId: 5, items: [3867], cs: 30 },
  ];
  const tags = (id) => ({ 3: ['Mage'], 4: ['Marksman'], 1: ['Fighter'] })[id];
  assert.deepEqual(assignPositions(team, tags), ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
});

test('라인을 직접 고치고 다시 자동으로 돌릴 수 있다', () => {
  const m = normalizeGame(makeLcuGame()).match;
  applyPositionEdits(m, { 1: 'MIDDLE', 3: 'TOP' });
  assert.equal(m.players[0].position, 'MIDDLE');
  assert.equal(m.players[0].positionManual, true);
  applyPositionEdits(m, { 1: '', 3: 'NOPE' });
  assert.equal(m.players[0].position, 'TOP');
  assert.equal(m.players[2].position, 'TOP');
});

function matchesFor(results) {
  return results.map(([blue, red, winner], i) =>
    normalizeGame(makeLcuGame({ gameId: 100 + i, createdAt: Date.UTC(2026, 10, 1 + i), blue, red, winner })).match,
  );
}

test('팀이 매번 바뀌어도 개인별로 전적과 점수를 쌓는다', () => {
  const A = ['가', '나', '다', '라', '마'];
  const B = ['바', '사', '아', '자', '차'];
  const mixed1 = ['가', '바', '다', '사', '마'];
  const mixed2 = ['나', '라', '아', '자', '차'];
  const matches = matchesFor([
    [A, B, 100],
    [A, B, 100],
    [mixed1, mixed2, 200],
    [B, A, 200],
  ]);
  const stats = computeStats(matches, { minRankedGames: 3 });
  const ga = stats.players.get(puuidOf('가'));
  assert.equal(ga.games, 4);
  assert.equal(ga.wins, 3);
  assert.equal(ga.losses, 1);
  assert.equal(ga.winRate, 75);
  assert.ok(ga.rating > START_RATING);
  const ba = stats.players.get(puuidOf('바'));
  assert.equal(ba.wins, 0);
  assert.ok(ba.rating < START_RATING);
  assert.equal(ba.streak, -4);
  // 첫 판은 동점끼리라 정확히 ±20
  assert.deepEqual([stats.deltas.get('KR_100')[puuidOf('가')], stats.deltas.get('KR_100')[puuidOf('바')]], [20, -20]);
  assert.equal(stats.ranked.length, 10);
  assert.equal(stats.ranked[0].rank, 1);
  assert.equal(stats.totalMatches, 4);
  // 같은 팀 궁합: 가-나는 3판 같은 팀(3승)
  const mates = relationList(ga.mates, stats.players);
  const withNa = mates.find((r) => r.puuid === puuidOf('나'));
  assert.deepEqual([withNa.games, withNa.wins], [3, 3]);
  const champs = stats.champions;
  assert.ok(champs.length > 0);
  assert.ok(champs.some((c) => c.bans > 0));
});

test('판수가 적으면 배치 중으로 분류한다', () => {
  const stats = computeStats(matchesFor([[['가', '나', '다', '라', '마'], ['바', '사', '아', '자', '차'], 100]]), {
    minRankedGames: 5,
  });
  assert.equal(stats.ranked.length, 0);
  assert.equal(stats.unranked.length, 10);
});
