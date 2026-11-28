// PIR (Player Impact Rating, 기여도)
// 오버워치 리그의 PIR처럼 "그 판 평균 = 100"으로 맞춘 기여도. 100보다 높으면 평균보다 잘한 것이다.
// 리그의 실제 계산식은 공개되지 않아서, 잘한 것은 더하고 못한 것은 빼는 가중치 합을 그 판 평균으로 나눠 쓴다.
// 같은 판 안에서는 모두 게임 시간이 같으므로 평균으로 나누면 게임 길이와 상관없이 여러 판을 비교할 수 있다.
// 오버워치는 한타 상황으로 보정한 PIR 2.0(ow-pir.js)을 쓴다.
import { computePir2, PIR_OPTIONS } from './ow-pir.js';

export const LOL_PIR_WEIGHTS = [
  ['킬', 3],
  ['어시스트', 2],
  ['데스', -3],
  ['CS 10개', 0.5],
  ['챔피언 피해 1000', 1],
  ['받은 피해 1000', 0.4],
  ['시야 점수', 0.3],
  ['더블/트리플/쿼드라/펜타킬', '1/2/4/8'],
];

export const OW_PIR_WEIGHTS = [
  ['처치', 1],
  ['결정타', 1.5],
  ['도움', 0.5],
  ['죽음', -2.5],
  ['영웅 피해 1000', 1],
  ['치유 1000', 1.1],
  ['막은 피해 1000', 0.4],
  ['솔로킬', 1],
];

export function lolPirRaw(p) {
  const multi = p.multikills || [];
  return (
    3 * p.kills +
    2 * p.assists -
    3 * p.deaths +
    0.5 * (p.cs / 10) +
    p.damage / 1000 +
    0.4 * ((p.damageTaken || 0) / 1000) +
    0.3 * (p.vision || 0) +
    (multi[0] || 0) * 1 +
    (multi[1] || 0) * 2 +
    (multi[2] || 0) * 4 +
    (multi[3] || 0) * 8
  );
}

export function owPirRaw(p) {
  const bonus = p.role === 'TANK' ? PIR_OPTIONS.tankBonus : 1;
  return bonus * (
    p.elims +
    1.5 * (p.finalBlows || 0) +
    0.5 * (p.assists || 0) -
    2.5 * p.deaths +
    p.damage / 1000 +
    1.1 * (p.healing / 1000) +
    0.4 * ((p.blocked || 0) / 1000) +
    (p.solo || 0)
  );
}

/**
 * 한 판의 PIR과 순위, MVP(이긴 팀 1등)·ACE(진 팀 1등)를 계산한다.
 * @param players 그 판의 플레이어들
 * @param idOf 플레이어 → 고유 키
 * @param teamOf 플레이어 → 팀
 * @param winner 이긴 팀 (없으면 null/0)
 */
export function matchPir(players, { idOf, teamOf, winner, raw }) {
  const rows = players.map((p) => ({ id: idOf(p), team: teamOf(p), raw: raw(p) }));
  const positive = rows.map((r) => Math.max(0, r.raw));
  const avg = positive.reduce((a, b) => a + b, 0) / Math.max(1, positive.length);
  rows.forEach((r, i) => (r.pir = avg > 0 ? Math.round((100 * positive[i]) / avg) : 100));
  rows.sort((a, b) => b.raw - a.raw);
  const out = new Map();
  rows.forEach((r, i) => out.set(r.id, { pir: r.pir, raw: Math.round(r.raw * 10) / 10, rank: i + 1, mvp: false, ace: false }));
  if (winner) {
    const mvp = rows.find((r) => r.team === winner);
    const ace = rows.find((r) => r.team !== winner);
    if (mvp) out.get(mvp.id).mvp = true;
    if (ace) out.get(ace.id).ace = true;
  }
  return out;
}

export const lolMatchPir = (m) =>
  matchPir(m.players, { idOf: (p) => p.puuid, teamOf: (p) => p.teamId, winner: m.winner, raw: lolPirRaw });

/** 오버워치: PIR 2.0 재료가 있으면 그걸로(한타 상황 보정), 없으면(예전 기록) 단순 가중치 합으로 */
export function owMatchPir(m) {
  if (!m.players.every((p) => p.pir2)) {
    return matchPir(m.players, { idOf: (p) => p.key, teamOf: (p) => p.team, winner: m.winner || null, raw: owPirRaw });
  }
  const scores = computePir2(m.players);
  const rows = m.players.map((p) => ({ id: p.key, team: p.team, ...scores.get(p.key) })).sort((a, b) => b.pir - a.pir);
  const out = new Map();
  rows.forEach((r, i) => out.set(r.id, { pir: r.pir, parts: r.parts, rank: i + 1, mvp: false, ace: false, v2: true }));
  if (m.winner) {
    const mvp = rows.find((r) => r.team === m.winner);
    const ace = rows.find((r) => r.team !== m.winner);
    if (mvp) out.get(mvp.id).mvp = true;
    if (ace) out.get(ace.id).ace = true;
  }
  return out;
}
