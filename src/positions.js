// 내전 기록에는 라인 정보가 정확히 남지 않아서, 남아 있는 단서로 라인을 추정한다.
// 단서: 롤이 추정한 라인(timeline), 강타, 서폿 아이템, 정글 몬스터 CS, 미니언 CS, 챔피언 역할군.
export const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

const SMITE = 11;
// 서폿 퀘스트 아이템 (시즌마다 번호가 바뀌어서 예전 번호도 함께 둔다)
const SUPPORT_ITEMS = new Set([
  3850, 3851, 3853, 3854, 3855, 3857, 3858, 3859, 3860, 3862, 3863, 3864,
  3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877,
]);

const TAG_HINTS = {
  Marksman: { BOTTOM: 2 },
  Support: { UTILITY: 1.5 },
  Mage: { MIDDLE: 1 },
  Assassin: { MIDDLE: 1 },
  Fighter: { TOP: 1 },
  Tank: { TOP: 0.5, UTILITY: 0.5 },
};

export function positionScores(player, team, championTags) {
  const s = { TOP: 0, JUNGLE: 0, MIDDLE: 0, BOTTOM: 0, UTILITY: 0 };
  const hint = player.hint || {};
  const pos = String(hint.position || '').toUpperCase();
  const lane = String(hint.lane || '').toUpperCase();
  const role = String(hint.role || '').toUpperCase();

  if (POSITIONS.includes(pos)) s[pos] += 6;
  if (lane === 'TOP') s.TOP += 3;
  else if (lane === 'JUNGLE') s.JUNGLE += 3;
  else if (lane === 'MIDDLE' || lane === 'MID') s.MIDDLE += 3;
  else if (lane === 'BOTTOM' || lane === 'BOT') {
    if (role === 'DUO_SUPPORT' || role === 'SUPPORT') s.UTILITY += 3;
    else if (role === 'DUO_CARRY' || role === 'CARRY') s.BOTTOM += 3;
    else {
      s.BOTTOM += 1.5;
      s.UTILITY += 1.5;
    }
  }

  if ((player.spells || []).includes(SMITE)) s.JUNGLE += 10;
  if ((player.items || []).some((id) => SUPPORT_ITEMS.has(id))) s.UTILITY += 10;
  s.JUNGLE += Math.min(3, (player.neutralCs || 0) / 40);

  const laneCs = (p) => Math.max(0, (p.cs || 0) - (p.neutralCs || 0));
  const maxLaneCs = Math.max(1, ...team.map(laneCs));
  s.UTILITY += 2 * (1 - laneCs(player) / maxLaneCs);

  const tags = championTags ? championTags(player.championId) || [] : [];
  for (const tag of tags) {
    for (const [p, v] of Object.entries(TAG_HINTS[tag] || {})) s[p] += v;
  }
  return s;
}

function* permutations(items) {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) yield [items[i], ...perm];
  }
}

/** 한 팀의 라인을 추정한다. 5명이면 다섯 라인을 한 명씩 나눠 가장 그럴듯한 조합을 고른다. */
export function assignPositions(team, championTags) {
  const scores = team.map((p) => positionScores(p, team, championTags));
  if (team.length !== POSITIONS.length) {
    return scores.map((s) => {
      const best = POSITIONS.reduce((a, b) => (s[b] > s[a] ? b : a));
      return s[best] >= 3 ? best : null;
    });
  }
  let best = null;
  let bestTotal = -Infinity;
  for (const perm of permutations(POSITIONS)) {
    let total = 0;
    for (let i = 0; i < perm.length; i++) total += scores[i][perm[i]];
    if (total > bestTotal) {
      bestTotal = total;
      best = perm;
    }
  }
  return best;
}
