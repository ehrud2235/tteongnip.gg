import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroName, matchHighlights, normalizeOverwatch, parseLines } from '../src/overwatch.js';
import { computeOwStats } from '../src/ow-stats.js';
import { makeOwLog } from './helpers.js';

test('워크샵 로그를 경기 기록으로 바꾼다', () => {
  const r = normalizeOverwatch(makeOwLog(), { playedAt: 1_700_000_000_000 });
  assert.equal(r.ok, true, r.reason);
  const m = r.match;
  assert.match(m.id, /^OW_[0-9a-f]{16}$/);
  assert.equal(m.game, 'ow');
  assert.equal(m.map, '왕의 길');
  assert.equal(m.mode, '혼합');
  assert.deepEqual(m.score, [3, 2]);
  assert.equal(m.winner, 1);
  assert.equal(m.duration, 871);
  assert.equal(m.createdAt, 1_700_000_000_000);
  assert.equal(m.players.length, 10);
  const by = Object.fromEntries(m.players.map((p) => [p.name, p]));
  assert.equal(by['라인장인'].role, 'TANK');
  assert.equal(by['라인장인'].win, true);
  assert.equal(by['윈스턴'].win, false);
  // 트레이서 570초, 솜브라 301초
  assert.equal(by['트레이서'].hero, '트레이서');
  assert.deepEqual(by['트레이서'].heroes.map((h) => [h.hero, h.seconds]), [['트레이서', 570], ['솜브라', 301]]);
  assert.equal(by['아나장인'].fun.sleeps, 1);
  assert.equal(by['아나장인'].fun.sleepShots, 1);
  assert.equal(by['윈스턴'].fun.slept, 1);
  assert.equal(by['겐지충'].fun.ultKills, 1);
  assert.equal(by['겐지충'].fun.meleeKills, 2);
  assert.equal(by['솔저'].fun.ultDeaths, 1);
  assert.equal(by['메르시'].fun.rez, 2);
  assert.equal(by['루시우'].fun.envKills, 1);
  assert.equal(by['위도우'].fun.envDeaths, 1);
  assert.equal(by['라인장인'].blocked, 12000);
  assert.equal(by['라인장인'].key, 'ow:라인장인');
  // 팀 1 먼저, 탱-딜-지원 순서
  assert.deepEqual(m.players.slice(0, 5).map((p) => p.role), ['TANK', 'DAMAGE', 'DAMAGE', 'SUPPORT', 'SUPPORT']);
});

test('영어로 된 영웅 이름도 한국어로 모은다', () => {
  assert.equal(heroName('Ana'), '아나');
  assert.equal(heroName('soldier: 76'), '솔저: 76');
  assert.equal(heroName('Lúcio'), '루시우');
  assert.equal(heroName('새영웅'), '새영웅');
  const log = makeOwLog().replace(/,아나(?=\r?$)/gm, ',Ana').replace(/,라인하르트(?=\r?$)/gm, ',Reinhardt');
  const m = normalizeOverwatch(log).match;
  assert.equal(m.players.find((p) => p.name === '아나장인').hero, '아나');
  assert.equal(m.players.find((p) => p.name === '아나장인').fun.sleeps, 1);
});

test('같은 경기는 시계가 달라도 번호가 같다', () => {
  const a = normalizeOverwatch(makeOwLog({ clockBase: 0 })).match.id;
  const b = normalizeOverwatch(makeOwLog({ clockBase: 5000 })).match.id;
  const c = normalizeOverwatch(makeOwLog({ score: [1, 3] })).match.id;
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(parseLines('[10:00:00] hello\n[10:00:01] TN,end,1,2,3').length, 1);
});

test('덜 끝난 경기, 짧은 경기, 인원 부족은 거른다', () => {
  assert.match(normalizeOverwatch(makeOwLog({ complete: false })).reason, /끝까지/);
  assert.match(normalizeOverwatch(makeOwLog({ withStart: false })).reason, /시작/);
  assert.match(normalizeOverwatch(makeOwLog({ t1: 100 })).reason, /짧은/);
  assert.match(normalizeOverwatch(makeOwLog({ team1: [['혼자', 2, '겐지']], team2: [['둘', 2, '한조']] })).reason, /명이 안 되는/);
  const draw = normalizeOverwatch(makeOwLog({ score: [2, 2] })).match;
  assert.equal(draw.winner, 0);
  assert.ok(draw.players.every((p) => p.draw && !p.win));
});

test('명장면과 흑역사는 숫자가 있을 때만 몇 줄 보여준다', () => {
  const m = normalizeOverwatch(makeOwLog({ sleeps: 3 })).match;
  const h = matchHighlights(m);
  assert.ok(h.length <= 5);
  const texts = h.map((x) => `${x.who.name} ${x.text}`);
  assert.ok(texts.some((t) => t.includes('아나장인 수면총으로 3명 재움')), texts.join('\n'));
  assert.ok(texts.some((t) => t.includes('솔저 궁 쓰고 3초 안에 사망 1번')), texts.join('\n'));
  assert.ok(h.findIndex((x) => x.kind === 'bad') > h.findIndex((x) => x.kind === 'good'));
});

test('오버워치 전적과 점수는 개인별로 쌓이고 칭호가 붙는다', () => {
  const matches = [0, 1, 2, 3, 4].map((i) =>
    normalizeOverwatch(makeOwLog({ sleeps: 4, score: i === 3 ? [0, 1] : [2, 1], t0: 30 + i }), { playedAt: 1e12 + i * 1e6 }).match,
  );
  const s = computeOwStats(matches, { minRankedGames: 3 });
  assert.equal(s.totalMatches, 5);
  const ana = s.players.get('ow:아나장인');
  assert.deepEqual([ana.games, ana.wins, ana.losses], [5, 4, 1]);
  assert.ok(ana.rating > 1000);
  assert.equal(ana.heroes.get('아나').sleeps, 20);
  assert.deepEqual(ana.titles.map((t) => t.name), ['수면 마취과 전문의', '승리 요정']);
  assert.equal(ana.mainRole, 'SUPPORT');
  const tracer = s.players.get('ow:트레이서');
  assert.equal(tracer.heroes.get('트레이서').games, 5);
  assert.equal(tracer.heroes.get('솜브라').games, 0);
  assert.ok(tracer.heroes.get('솜브라').seconds > 0);
  assert.equal(s.ranked.length, 10);
  assert.equal(s.heroes[0].games, 5);
  assert.equal(s.deltas.get(matches[0].id)['ow:아나장인'], 20);
});
