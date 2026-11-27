import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroName, matchHighlights, normalizeOverwatch, owFormat, parseLines, setOwWinner } from '../src/overwatch.js';
import { computeOwStats } from '../src/ow-stats.js';
import { makeOwLog, OW_TEAM1, OW_TEAM2 } from './helpers.js';

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

test('호위·혼합처럼 팀 점수가 0 : 0이면 경기 끝 목표 상태로 승패를 정한다', () => {
  // 1팀 공격, 화물 끝까지 → 1팀 승
  let m = normalizeOverwatch(makeOwLog({ score: [0, 0], obj: '1,100,2,35,1' })).match;
  assert.deepEqual([m.winner, m.winnerSource], [1, 'objective']);
  // 1팀 공격, 화물 60%에서 시간 끝 → 2팀(수비) 승
  m = normalizeOverwatch(makeOwLog({ score: [0, 0], obj: '1,60,1,0,1' })).match;
  assert.deepEqual([m.winner, m.winnerSource], [2, 'objective']);
  assert.ok(m.players.filter((p) => p.team === 2).every((p) => p.win));
  // 점수가 다르면 점수가 우선
  m = normalizeOverwatch(makeOwLog({ score: [1, 2], obj: '1,100,2,35,1' })).match;
  assert.deepEqual([m.winner, m.winnerSource], [2, 'score']);
  // 공격 팀을 모르면 승패 미정
  m = normalizeOverwatch(makeOwLog({ score: [0, 0], obj: '0,0,0,0,1' })).match;
  assert.equal(m.winner, 0);
});

test('5대5 / 6대6을 구분하고, 중간에 나간 사람도 인원에 센다', () => {
  assert.equal(normalizeOverwatch(makeOwLog()).match.format, '5v5');
  const six = normalizeOverwatch(makeOwLog({ team1: [...OW_TEAM1, ['여섯째', 1, '자리야']], team2: [...OW_TEAM2, ['육번', 1, '시그마']] })).match;
  assert.deepEqual([six.format, six.teamSize], ['6v6', 6]);
  // 6명이 영웅을 골랐지만 한 명은 끝나기 전에 나가서 개인 기록이 없음
  const leaver = makeOwLog({ team1: [...OW_TEAM1, ['여섯째', 1, '자리야']], team2: [...OW_TEAM2, ['육번', 1, '시그마']] })
    .split('\r\n')
    .filter((l) => !l.includes('TN,stat,육번,'))
    .join('\r\n');
  const m = normalizeOverwatch(leaver).match;
  assert.equal(m.players.length, 11);
  assert.equal(m.format, '6v6');
  // 예전 기록(format 없음)은 남은 사람 수로
  assert.equal(owFormat({ players: [1, 1, 1, 1, 1, 1, 2].map((team) => ({ team })) }), '6v6');
  assert.equal(owFormat({ players: [1, 1, 2, 2].map((team) => ({ team })) }), '5v5');
});

test('승패를 직접 정할 수 있다', () => {
  const m = normalizeOverwatch(makeOwLog({ score: [0, 0] })).match;
  assert.equal(m.winner, 0);
  setOwWinner(m, 1);
  assert.deepEqual([m.winner, m.winnerSource], [1, 'manual']);
  assert.ok(m.players.every((p) => p.win === (p.team === 1) && !p.draw));
  setOwWinner(m, 0);
  assert.ok(m.players.every((p) => p.draw && !p.win));
});

test('같은 로비에서 이어서 한 판: 앞 경기의 영웅 기록으로 영웅을 찾는다', () => {
  const first = makeOwLog({ score: [2, 0] });
  // 두 번째 판에서는 2팀이 영웅을 다시 고르지 않아서 영웅 기록이 없다
  const second = makeOwLog({ score: [0, 2], t0: 40 })
    .split('\r\n')
    .filter((l) => !(l.includes('TN,hero,5,') && OW_TEAM2.some(([n]) => l.includes(`,${n},2,`))))
    .join('\r\n');
  const r = normalizeOverwatch(`${first}${second}`);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.match.score, [0, 2]);
  const by = Object.fromEntries(r.match.players.map((p) => [p.name, p]));
  assert.equal(by['윈스턴'].hero, '윈스턴');
  assert.equal(by['메르시'].hero, '메르시');
  // 앞 내용이 붙어 있어도 경기 번호는 그 경기만으로 정해진다
  assert.equal(r.match.id, normalizeOverwatch(second).match.id);
});

test('영웅 기록이 아예 없으면 처치·궁극기 기록에 나온 영웅으로 채운다', () => {
  const log = makeOwLog()
    .split('\r\n')
    .filter((l) => !l.includes('TN,hero,5,겐지충,'))
    .join('\r\n');
  const p = normalizeOverwatch(log).match.players.find((x) => x.name === '겐지충');
  assert.equal(p.hero, '겐지');
  assert.equal(p.role, 'DAMAGE');
});

test('호위·혼합을 중간에 끝낸 판(시간이 남았는데 화물이 덜 감)은 기록하지 않는다', () => {
  const r = normalizeOverwatch(makeOwLog({ score: [0, 0], obj: '1,40,1,120,1' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /끝나기 전에 종료된 판/);
});

test('실제 로그: AI가 영웅을 바꿔 이름이 바뀌어도 인원은 5대5, 영웅은 기록에서 찾는다', () => {
  // 실제 워크샵 로그 모양 (AI는 이름 = 지금 영웅, 중간에 영웅을 바꾸면 이름도 바뀐다)
  const log = [
    '[00:00:00] TN,hero,0,루시우,2,3,루시우',
    '[00:00:00] TN,hero,0,솜브라,2,3,솜브라',
    '[00:00:00] TN,hero,0,시메트라,2,2,시메트라',
    '[00:00:00] TN,hero,0,메이,2,2,메이',
    '[00:00:00] TN,hero,0,시그마,2,1,시그마',
    '[00:00:00] TN,hero,0,바티스트,1,3,바티스트',
    '[00:00:00] TN,hero,0,위도우메이커,1,2,위도우메이커',
    '[00:00:00] TN,hero,0,소전,1,2,소전',
    '[00:00:00] TN,hero,0,마우가,1,1,마우가',
    '[00:00:34] TN,hero,35,나,1,2,캐서디',
    '[00:01:19] TN,start,80,66번 국도,호위',
    '[00:02:46] TN,ab1,167,자리야,자리야',
    '[00:04:37] TN,ab2,277,모이라,모이라',
    '[00:05:09] TN,kill,310,나,캐서디,메르시,메르시,1',
    '[00:05:32] TN,ab1,332,바스티온,바스티온',
    '[00:05:51] TN,ab1,351,한조,한조',
    '[00:06:29] TN,stat,자리야,2,0,0,7,1215,0,1350,0,0,0,0,5443,0,0',
    '[00:06:29] TN,stat,나,1,39,36,0,12286,243,0,2,0,0,8,667,0,0',
    '[00:06:29] TN,stat,메르시,2,0,0,9,502,379,0,0,0,0,0,2334,0,0',
    '[00:06:29] TN,stat,모이라,2,1,1,9,331,234,0,0,0,0,1,2376,0,0',
    '[00:06:29] TN,stat,바스티온,2,0,0,8,1012,0,0,0,0,0,0,2997,0,0',
    '[00:06:29] TN,stat,한조,2,0,0,6,1119,103,401,0,0,0,0,2398,0,0,한조,2',
    '[00:06:29] TN,stat,바티스트,1,5,0,1,164,1297,0,0,0,0,0,912,0,15',
    '[00:06:29] TN,stat,위도우메이커,1,7,1,0,640,0,0,1,0,0,0,589,0,0',
    '[00:06:29] TN,stat,소전,1,12,1,0,1485,0,0,1,0,0,0,687,0,0',
    '[00:06:29] TN,stat,마우가,1,13,1,0,963,83,0,0,0,0,0,1325,2,13',
    '[00:06:30] TN,end,390,0,0',
  ].join('\n');
  const m = normalizeOverwatch(log).match;
  assert.equal(m.format, '5v5');
  assert.equal(m.teamSize, 5);
  const by = Object.fromEntries(m.players.map((p) => [p.name, p]));
  assert.equal(by['자리야'].hero, '자리야');
  assert.equal(by['자리야'].role, 'TANK');
  assert.equal(by['메르시'].hero, '메르시');
  assert.equal(by['한조'].hero, '한조'); // 새 스크립트: 개인 기록 줄의 마지막 영웅
  assert.equal(by['나'].hero, '캐서디');
  assert.equal(m.winner, 0); // 예전 스크립트(목표 기록 없음) + 0 : 0 → 승패 미정
});

test('영웅 교체 줄이 빠져도 처치·기술 기록으로 바꾼 영웅과 시간을 찾는다', () => {
  // 트레이서 → 솜브라 교체 줄(TN,hero,600)을 지우고, 대신 솜브라로 기술을 쓴 기록만 남긴다
  const lines = makeOwLog().split('\r\n').filter((l) => !l.includes('TN,hero,600,'));
  const statAt = lines.findIndex((l) => l.includes('TN,stat,'));
  lines.splice(statAt, 0, '[20:01:00] TN,ab1,300,트레이서,트레이서', '[20:10:00] TN,ab1,610,트레이서,솜브라', '[20:12:00] TN,ab2,700,트레이서,솜브라');
  const log = lines.join('\r\n');
  const p = normalizeOverwatch(log).match.players.find((x) => x.name === '트레이서');
  // 교체 시각은 트레이서 마지막 기록(300)과 솜브라 첫 기록(610)의 중간(455) → 트레이서 30~455, 솜브라 455~901
  assert.deepEqual(p.heroes.map((h) => [h.hero, h.seconds]), [['솜브라', 446], ['트레이서', 425]]);
  assert.equal(p.heroes.find((h) => h.hero === '솜브라').role, 'DAMAGE');
});

test('경기 시각: 파일 이름(만든 시각, 한국 시간) + 줄 앞 경과 시간', async () => {
  const { owPlayedAt } = await import('../src/overwatch.js');
  const text = ['[00:00:00] TN,hero,1,Kiriko,2,3,Kiriko', '[00:01:07] TN,start,67,Busan,Control', '[00:09:17] TN,end,557,2,0'].join('\n');
  // 2026-11-26 21:55:34 (한국) + 1분 7초 = 21:56:41 한국 = 12:56:41 UTC
  assert.equal(owPlayedAt('Log-2026-11-26-21-55-34.txt', text, 'Asia/Seoul'), Date.UTC(2026, 10, 26, 12, 56, 41));
  // 같은 파일에 여러 판이면 마지막 판의 시작 줄
  const two = `${text}\n[00:12:00] TN,start,720,Oasis,Control\n[00:20:00] TN,end,1200,2,0`;
  assert.equal(owPlayedAt('Log-2026-11-26-21-55-34.txt', two, 'Asia/Seoul'), Date.UTC(2026, 10, 26, 13, 7, 34));
  assert.equal(owPlayedAt('이상한이름.txt', text), null);
});

test('밀기처럼 화물이 없는 모드는 점수가 같으면 승패 미정 (화물 진행도로 판정하지 않는다)', () => {
  const push = normalizeOverwatch(makeOwLog({ mode: '밀기', score: [0, 0], obj: '1,100,2,0,1' })).match;
  assert.deepEqual([push.winner, push.winnerSource], [0, null]);
  const escort = normalizeOverwatch(makeOwLog({ mode: 'Escort', score: [0, 0], obj: '1,100,2,0,1' })).match;
  assert.deepEqual([escort.winner, escort.winnerSource], [1, 'objective']);
});

test('딜러를 메인(히트스캔)과 서브(투사체·돌진)로 나눈다', async () => {
  const { owPosition } = await import('../src/overwatch.js');
  assert.equal(owPosition('DAMAGE', '캐서디'), 'MAIN_DPS');
  assert.equal(owPosition('DAMAGE', 'Widowmaker'), 'MAIN_DPS');
  assert.equal(owPosition('DAMAGE', '겐지'), 'SUB_DPS');
  assert.equal(owPosition('DAMAGE', '새딜러'), 'DAMAGE');
  assert.equal(owPosition('TANK', '라인하르트'), 'TANK');
});

test('궁 한 번이 여러 줄로 찍혀도(상태 깜빡임) 한 번으로 센다, 다른 사람 궁은 따로', async () => {
  const { dedupeUlts } = await import('../src/overwatch.js');
  const list = [
    { t: 100, key: 'ow:a' }, { t: 103, key: 'ow:a' }, { t: 109, key: 'ow:a' }, // 여우길 한 번
    { t: 101, key: 'ow:b' }, // 상대 팀 키리코 (다른 사람)
    { t: 200, key: 'ow:a' }, // 다음 궁
  ];
  assert.deepEqual(dedupeUlts(list).map((u) => `${u.key}@${u.t}`), ['ow:a@100', 'ow:b@101', 'ow:a@200']);
});

test('양 팀이 같은 영웅을 골라도 영웅 픽률은 판 기준으로 센다', async () => {
  const { computeOwStats } = await import('../src/ow-stats.js');
  // 양 팀 서포터가 둘 다 키리코
  const t1 = [['A1', 1, '라인하르트'], ['A2', 2, '겐지'], ['A3', 2, '트레이서'], ['A4', 3, '키리코'], ['A5', 3, '루시우']];
  const t2 = [['B1', 1, '윈스턴'], ['B2', 2, '위도우메이커'], ['B3', 2, '솔저: 76'], ['B4', 3, '키리코'], ['B5', 3, '젠야타']];
  const m = normalizeOverwatch(makeOwLog({ team1: t1, team2: t2 })).match;
  const kiriko = computeOwStats([m]).heroes.find((h) => h.hero === '키리코');
  assert.equal(kiriko.games, 2); // 두 사람이 했으니 판수(사람 기준)는 2
  assert.equal(kiriko.matches.size, 1); // 픽률은 이 영웅이 나온 판 수 기준 → 100%
});
