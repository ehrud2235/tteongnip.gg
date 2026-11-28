import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOverwatch } from '../src/overwatch.js';
import { owMatchPir } from '../src/pir.js';

const T1 = [['A1', 1, '라인하르트'], ['A2', 2, '겐지'], ['A3', 2, '트레이서'], ['A4', 3, '아나'], ['A5', 3, '루시우']];
const T2 = [['B1', 1, '윈스턴'], ['B2', 2, '위도우메이커'], ['B3', 2, '솔저: 76'], ['B4', 3, '메르시'], ['B5', 3, '젠야타']];

/** 새 스크립트 모양: 처치 줄에 팀과 주변 인원, 부활, 5초 기록 */
function buildLog(events, { snaps = [] } = {}) {
  const lines = [];
  for (const [n, r, h] of T1) lines.push(`TN,hero,5,${n},1,${r},${h}`);
  for (const [n, r, h] of T2) lines.push(`TN,hero,5,${n},2,${r},${h}`);
  lines.push('TN,start,30,왕의 길,혼합');
  lines.push(...events, ...snaps);
  const stat = (n, team, role) =>
    `TN,stat,${n},${team},10,4,3,${role === 2 ? 9000 : 4000},${role === 3 ? 9000 : 0},${role === 1 ? 9000 : 0},3,0,0,1,7000,5,2`;
  for (const [n, r] of T1) lines.push(stat(n, 1, r));
  for (const [n, r] of T2) lines.push(stat(n, 2, r));
  lines.push('TN,end,601,3,1');
  return lines.join('\n');
}
const kill = (t, a, aHero, v, vHero, ab, aTeam, allies = 3, enemies = 3) => `TN,kill,${t},${a},${aHero},${v},${vHero},${ab},${aTeam},${3 - aTeam},${allies},${enemies}`;

test('PIR 2.0: 한타 상황에 따라 결정타와 데스를 다르게 센다', () => {
  const events = [
    kill(100, 'A1', '라인하르트', 'B1', '윈스턴', 1, 1), // 5대5 첫 킬 → 1.5 / B1 한타 첫 데스 1.5
    kill(102, 'A2', '겐지', 'B2', '위도우메이커', 1, 1), // 5대4 (1명 우세) → 0.8 / B2 열세 추가 데스 1.1
    kill(104, 'B3', '솔저: 76', 'A3', '트레이서', 1, 2), // 3대5 (열세) → 1.3 / A3 일반 1.0
    kill(106, 'A1', '라인하르트', 'B3', '솔저: 76', 1, 1), // 4대3 → 0.8 / 1.1
    kill(107, 'A4', '아나', 'B4', '메르시', 1, 1), // 4대2 → 0.5 → 4대1, 한타 결정
    kill(108, 'A5', '루시우', 'B5', '젠야타', 6, 1, 1, 1), // 결정된 한타 0.25 ×1.2(1대1) / B5 리스폰 맞추기 0.1
    'TN,spawn,112,B1,2',
    'TN,spawn,112,B2,2',
    kill(200, 'A2', '겐지', 'B2', '위도우메이커', 1, 1), // 한타 아닌 혼자 잡힘 → 데스 1.3
  ];
  const m = normalizeOverwatch(buildLog(events)).match;
  const by = Object.fromEntries(m.players.map((p) => [p.name, p.pir2]));
  assert.deepEqual(m.fights, { count: 2, won: { 1: 2, 2: 0 } });
  assert.equal(by.A1.kills, 2.3);
  assert.equal(by.A1.firstKills, 1);
  assert.equal(by.B3.kills, 1.3);
  assert.equal(by.B3.clutchKills, 1);
  assert.equal(by.A4.kills, 0.5);
  assert.equal(by.A5.kills, 0.3); // 0.25 × 1.2
  assert.equal(by.A5.duels, 1);
  assert.equal(by.A5.decidedKills, 1);
  assert.equal(by.B1.deathW, 1.5);
  assert.equal(by.B1.firstDeaths, 1);
  assert.equal(by.B5.deathW, 0.1);
  assert.equal(by.B5.syncDeaths, 1);
  assert.equal(by.B2.deathW, 2.4); // 열세 추가 데스 1.1 + 혼자 잡힘 1.3
  assert.equal(by.B2.picks, 1);
  assert.equal(by.A3.deathW, 1.0);
  assert.equal(m.precise.spawns, true);
});

test('PIR 2.0: 역할별로 평균 100에 맞추고 순위·MVP·ACE를 정한다', () => {
  const events = [
    kill(100, 'A2', '겐지', 'B1', '윈스턴', 1, 1),
    kill(101, 'A2', '겐지', 'B2', '위도우메이커', 1, 1),
    kill(103, 'A3', '트레이서', 'B3', '솔저: 76', 1, 1),
    kill(150, 'B2', '위도우메이커', 'A4', '아나', 1, 2),
    'TN,ult,99,A2,겐지',
    kill(102, 'A2', '겐지', 'B4', '메르시', 5, 1),
  ];
  const snaps = [];
  for (const t of [35, 40, 95, 105, 160]) {
    for (const [n, r] of T1) snaps.push(`TN,snap,${t},${n},1,${(t - 30) * (r === 2 ? 15 : 5)},${r === 3 ? (t - 30) * 15 : 0},0,${n === 'A2' && t === 95 ? 100 : 40}`);
    for (const [n, r] of T2) snaps.push(`TN,snap,${t},${n},2,${(t - 30) * (r === 2 ? 15 : 5)},${r === 3 ? (t - 30) * 15 : 0},0,40`);
  }
  const m = normalizeOverwatch(buildLog(events, { snaps })).match;
  assert.equal(m.precise.snaps, true);
  const pr = owMatchPir(m);
  const values = [...pr.values()];
  const avg = values.reduce((a, e) => a + e.pir, 0) / values.length;
  assert.ok(avg > 60 && avg < 140, `평균 ${avg}`);
  assert.ok(values.every((e) => e.pir > 0 && e.v2));
  const a2 = pr.get('ow:a2');
  assert.equal(a2.rank, 1);
  assert.equal(a2.mvp, true);
  assert.ok(a2.parts.ult > 100);
  assert.ok([...pr.values()].filter((e) => e.ace).length === 1);
  assert.ok(m.players.find((p) => p.name === 'A2').pir2.ult > 0.5);
});

test('양 팀에 같은 이름(AI)이 있어도 두 사람으로 따로 기록한다', () => {
  const t1 = [['Hanzo', 2, 'Hanzo'], ['Ashe', 2, 'Ashe'], ['Kiriko', 3, 'Kiriko'], ['Roadhog', 1, 'Roadhog'], ['나', 2, 'Cassidy']];
  const t2 = [['Hanzo', 2, 'Hanzo'], ['Mei', 2, 'Mei'], ['Moira', 3, 'Moira'], ['Winston', 1, 'Winston'], ['어흐', 3, 'Doctrine']];
  const lines = ['TN,start,60,Busan,Control'];
  lines.push('TN,kill,100,나,Cassidy,Hanzo,Hanzo,1');
  lines.push('TN,kill,110,Hanzo,Hanzo,Roadhog,Roadhog,1');
  for (const [n, r, h] of t1) lines.push(`TN,stat,${n},1,5,2,3,1000,0,0,1,0,0,0,500,0,0,${h},${r}`);
  for (const [n, r, h] of t2) lines.push(`TN,stat,${n},2,5,2,3,1000,0,0,1,0,0,0,500,0,0,${h},${r}`);
  lines.push('TN,end,500,2,0');
  const m = normalizeOverwatch(lines.join('\n')).match;
  assert.equal(m.players.length, 10);
  const keys = m.players.map((p) => p.key);
  assert.ok(keys.includes('ow:hanzo@1') && keys.includes('ow:hanzo@2'));
  assert.equal(new Set(keys).size, 10);
  assert.equal(m.players.find((p) => p.name === '어흐').hero, 'Doctrine'); // 모르는 새 영웅은 이름 그대로
  // 나(1팀)가 잡은 한조는 2팀 한조, 한조가 잡은 로드호그(1팀)는 2팀 한조가 잡은 것
  const hanzo2 = m.players.find((p) => p.key === 'ow:hanzo@2').pir2;
  assert.equal(hanzo2.deathW > 0, true);
  assert.ok(hanzo2.kills > 0);
});

test('탱커 보정: 같은 판에서 탱커 PIR만 ×1.08 (설정으로 바꿀 수 있다)', async () => {
  const { PIR_OPTIONS } = await import('../src/ow-pir.js');
  const events = [kill(100, 'A1', '라인하르트', 'B2', '위도우메이커', 1, 1), kill(130, 'B1', '윈스턴', 'A2', '겐지', 1, 2)];
  const m = normalizeOverwatch(buildLog(events)).match;
  const saved = PIR_OPTIONS.tankBonus;
  try {
    PIR_OPTIONS.tankBonus = 1;
    const plain = owMatchPir(m);
    PIR_OPTIONS.tankBonus = 1.08;
    const boosted = owMatchPir(m);
    for (const p of m.players) {
      const a = plain.get(p.key).pir;
      const b = boosted.get(p.key).pir;
      if (p.role === 'TANK') assert.ok(Math.abs(b - Math.round(a * 1.08)) <= 1, `${p.name} ${a} → ${b}`);
      else assert.equal(b, a);
    }
  } finally {
    PIR_OPTIONS.tankBonus = saved;
  }
});
