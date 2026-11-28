// 오버워치 PIR 2.0: 단순 기록이 아니라 "한타 상황"으로 보정한 기여도.
//
// 1) 처치/죽음/부활 기록으로 매 순간 양 팀 생존 인원을 다시 만들고, 처치 사이가 15초 넘게 비면 다른 한타로 나눈다.
// 2) 결정타·데스·피해·치유를 그 순간 상황(동수, 우세, 열세, 이미 끝난 한타)에 따라 다르게 센다.
// 3) 일곱 가지 요소를 같은 역할끼리 평균 100으로 맞춘 뒤, 역할별 가중치로 합친다. → 그 판 평균이 100 근처.
//
// 오버워치 리그의 실제 PIR 계산식은 공개되지 않았다. 여기 숫자들은 우리 내전에 맞춰 조정하는 출발점이다.

export const ROLE_WEIGHTS = {
  TANK: { kills: 15, survival: 20, initiation: 15, damage: 10, healing: 0, special: 25, ult: 15 },
  DAMAGE: { kills: 25, survival: 20, initiation: 20, damage: 15, healing: 0, special: 5, ult: 15 },
  SUPPORT: { kills: 10, survival: 25, initiation: 10, damage: 5, healing: 20, special: 15, ult: 15 },
};

/**
 * 탱커 보정: 5대5에서 탱커는 한 판에 두 명뿐이라 "같은 역할끼리 비교"할 상대가 적어서 점수가 덜 튄다
 * (딜러·지원은 넷이라 잘하면 250까지 오르지만 탱커는 200 근처에서 막힌다). 그만큼 조금 올려준다.
 * Render 환경 변수 OW_TANK_BONUS로 바꿀 수 있다.
 */
export const PIR_OPTIONS = { tankBonus: 1.08 };

export const PART_NAMES = {
  kills: '유효 결정타',
  survival: '유효 생존',
  initiation: '교전 개시',
  damage: '유효 피해',
  healing: '유효 치유',
  special: '특수 능력',
  ult: '궁극기 효율',
};

export const KILL_VALUES = [
  ['한타 시작(전원 생존)에서 첫 킬', 1.5],
  ['아군이 열세일 때 킬', 1.3],
  ['양 팀 동수일 때 킬', 1.0],
  ['아군이 1명 우세할 때 킬', 0.8],
  ['아군이 2명 이상 우세할 때 킬', 0.5],
  ['사실상 끝난 한타에서 킬', 0.25],
  ['주변에 다른 사람 없는 1대1 킬', '×1.2'],
];

export const DEATH_WEIGHTS = [
  ['한타 첫 데스', 1.5],
  ['한타도 아닌데 혼자 잡힘', 1.3],
  ['열세에서 추가 데스', 1.1],
  ['일반 데스', 1.0],
  ['이긴 한타 뒤 데스', 0.5],
  ['진 한타 뒤 리스폰 맞추기', 0.1],
];

export const FLOW_VALUES = [
  ['동수·열세 한타', 1.0],
  ['우세한 한타', 0.75],
  ['승패가 사실상 결정된 한타', 0.25],
  ['한타 밖 (궁 충전용)', 0.5],
];

const FIGHT_GAP = 15; // 처치 사이가 이보다 길면 다른 한타
const RESPAWN = 10; // 부활 기록이 없을 때 쓰는 부활 시간
const PAD_BEFORE = 10; // 첫 킬 전 이 시간부터 한타로 본다
const PAD_AFTER = 3;
const ULT_WINDOW = 8; // 궁 사용 뒤 이 시간 안의 궁 처치를 궁 효과로 본다
const INDEX_CAP = 250;

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const winChance = (diff) => sigmoid(0.8 * diff); // 생존 인원 차이 → 대략적인 한타 승리 확률

/**
 * 경기 기록을 한타 단위로 분석해서 사람마다 PIR 재료를 만든다.
 * @param players [{ key, team, role, hero, damage, healing, blocked, solo, assists, defAssists, fun }]
 * @param ev { t0, t1, teamSize: {1,2}, kills: [{t, aKey, vKey, aTeam, vTeam, ability, allies?, enemies?, vName}],
 *             spawns: [{t, name, team}], ults: [{t, key}], snaps: [{t, key, dmg, heal, blocked, ult}], abs: [{key, hero, slot}] }
 */
export function analyzeMatch(players, ev) {
  const byKey = new Map(players.map((p) => [p.key, p]));
  const size = { 1: ev.teamSize?.[1] || 5, 2: ev.teamSize?.[2] || 5 };
  const kills = [...ev.kills].filter((k) => k.vTeam === 1 || k.vTeam === 2).sort((a, b) => a.t - b.t);
  const hasSpawns = ev.spawns.length > 0;

  // --- 죽어 있던 구간 (팀별) ---
  const spawnTimes = new Map(); // "이름|팀" -> [t...]
  for (const s of ev.spawns) {
    const k = `${s.name}|${s.team}`;
    if (!spawnTimes.has(k)) spawnTimes.set(k, []);
    spawnTimes.get(k).push(s.t);
  }
  const deadIntervals = { 1: [], 2: [] };
  for (const k of kills) {
    let back = k.t + RESPAWN;
    if (hasSpawns) {
      const next = (spawnTimes.get(`${k.vName}|${k.vTeam}`) || []).find((t) => t > k.t);
      back = next ?? Math.min(ev.t1, k.t + RESPAWN * 2);
    }
    deadIntervals[k.vTeam].push([k.t, back]);
  }
  // t 바로 전(같은 초에 일어난 다른 처치는 순서대로 반영하기 위해 index로 처리)
  const aliveAt = (team, t) => Math.max(0, size[team] - deadIntervals[team].filter(([a, b]) => a <= t && t < b).length);

  // --- 한타 나누기 + 처치/데스 가치 ---
  const fights = [];
  let fight = null;
  const dead = { 1: [], 2: [] }; // 처치 순서대로 반영하는 현재 죽은 구간
  const aliveNow = (team, t) => Math.max(0, size[team] - dead[team].filter(([a, b]) => a <= t && t < b).length);
  const credits = []; // { key, kind, value, fight }
  for (const k of kills) {
    if (!fight || k.t - fight.end > FIGHT_GAP) {
      fight = { start: k.t, end: k.t, kills: [], decided: false, decidedAt: null, decidedFor: 0, winner: 0 };
      fights.push(fight);
    }
    const A = k.aTeam ? aliveNow(k.aTeam, k.t) : 0;
    const V = aliveNow(k.vTeam, k.t);
    const first = fight.kills.length === 0;
    const validAttacker = k.aKey && k.aKey !== k.vKey && k.aTeam && k.aTeam !== k.vTeam;
    let value = 0;
    let situation = 'normal';
    if (validAttacker) {
      if (first && A >= size[k.aTeam] && V >= size[k.vTeam]) [value, situation] = [1.5, 'opening'];
      else if (fight.decided) [value, situation] = [0.25, 'decided'];
      else {
        const diff = A - V;
        [value, situation] = diff < 0 ? [1.3, 'behind'] : diff === 0 ? [1.0, 'even'] : diff === 1 ? [0.8, 'ahead'] : [0.5, 'ahead2'];
      }
      // 주변 15m 안에 다른 아군·적이 없으면 1대1 (새 스크립트만)
      if (k.allies != null && k.allies <= 1 && k.enemies != null && k.enemies <= 1) {
        value *= 1.2;
        k.duel = true;
      }
    }
    // 데스 가중치 (혼자 잡힘은 한타가 끝난 뒤 다시 본다)
    let deathW;
    let deathKind;
    if (first) [deathW, deathKind] = [1.5, 'first'];
    else if (fight.decided) [deathW, deathKind] = fight.decidedFor === k.vTeam ? [0.5, 'afterWin'] : [0.1, 'sync'];
    else if (V < (k.aTeam ? A : size[3 - k.vTeam])) [deathW, deathKind] = [1.1, 'behind'];
    else [deathW, deathKind] = [1.0, 'normal'];

    const back = (() => {
      if (!hasSpawns) return k.t + RESPAWN;
      const next = (spawnTimes.get(`${k.vName}|${k.vTeam}`) || []).find((t) => t > k.t);
      return next ?? Math.min(ev.t1, k.t + RESPAWN * 2);
    })();
    dead[k.vTeam].push([k.t, back]);
    fight.kills.push({ ...k, value, situation, deathW, deathKind, team: validAttacker ? k.aTeam : 3 - k.vTeam });
    fight.end = k.t;
    // 한쪽이 3명 이상 우세하거나 전멸하면 그 한타는 사실상 끝
    const a1 = aliveNow(1, k.t + 0.01);
    const a2 = aliveNow(2, k.t + 0.01);
    if (!fight.decided && (Math.abs(a1 - a2) >= 3 || Math.min(a1, a2) === 0)) {
      fight.decided = true;
      fight.decidedAt = k.t;
      fight.decidedFor = a1 > a2 ? 1 : 2;
    }
  }
  for (const f of fights) {
    const by = { 1: 0, 2: 0 };
    for (const k of f.kills) by[k.team]++;
    f.winner = by[1] > by[2] ? 1 : by[2] > by[1] ? 2 : 0;
    if (f.kills.length === 1) {
      f.kills[0].deathW = 1.3; // 한타도 아닌데 혼자 잡힘
      f.kills[0].deathKind = 'pick';
    }
  }

  const fightAt = (t) => fights.find((f) => t >= f.start - PAD_BEFORE && t <= f.end + PAD_AFTER) || null;
  const flowFactor = (team, t) => {
    const f = fightAt(t);
    if (!f) return 0.5;
    if (f.decided && t >= f.decidedAt) return 0.25;
    return aliveAt(team, t) - aliveAt(3 - team, t) >= 1 ? 0.75 : 1.0;
  };

  // --- 사람별 재료 ---
  const out = new Map();
  for (const p of players) {
    out.set(p.key, { kills: 0, deathW: 0, initiation: 0, damage: 0, healing: 0, special: 0, ult: 0, duels: 0, firstKills: 0, firstDeaths: 0, syncDeaths: 0, decidedKills: 0, clutchKills: 0, picks: 0 });
  }
  const at = (key) => out.get(key);
  for (const f of fights) {
    f.kills.forEach((k, i) => {
      const a = k.value && at(k.aKey);
      if (a) {
        a.kills += k.value;
        if (k.duel) a.duels++;
        if (k.situation === 'decided') a.decidedKills++;
        if (k.situation === 'behind') a.clutchKills++;
        if (i === 0) {
          a.firstKills++;
          a.initiation += f.kills.length > 1 ? 1 : 0.5;
        }
      }
      const v = at(k.vKey);
      if (v) {
        v.deathW += k.deathW;
        if (k.deathKind === 'first') v.firstDeaths++;
        if (k.deathKind === 'sync') v.syncDeaths++;
        if (k.deathKind === 'pick') v.picks++;
      }
    });
  }

  // 궁극기: 쓰기 전후로 한타 승리 가능성이 얼마나 바뀌었나(50%), 궁으로 직접 잡은 것(30%), 충전 뒤 얼마나 잘 썼나(20%)
  const snapsBy = new Map();
  for (const s of ev.snaps) {
    if (!snapsBy.has(s.key)) snapsBy.set(s.key, []);
    snapsBy.get(s.key).push(s);
  }
  for (const list of snapsBy.values()) list.sort((a, b) => a.t - b.t);
  for (const u of ev.ults) {
    const me = at(u.key);
    const p = byKey.get(u.key);
    if (!me || !p) continue;
    const f = fightAt(u.t);
    const before = winChance(aliveAt(p.team, u.t) - aliveAt(3 - p.team, u.t));
    const afterP = f ? (f.winner === p.team ? 1 : f.winner === 0 ? 0.5 : 0) : winChance(aliveAt(p.team, u.t + ULT_WINDOW) - aliveAt(3 - p.team, u.t + ULT_WINDOW));
    const swing = (afterP - before + 1) / 2;
    const direct = kills.filter((k) => k.aKey === u.key && k.ability === 5 && k.t >= u.t && k.t <= u.t + ULT_WINDOW).length;
    let charge = 0.5;
    const snaps = snapsBy.get(u.key);
    if (snaps?.length) {
      const prior = snaps.filter((s) => s.t <= u.t);
      let ready = null;
      for (let i = prior.length - 1; i >= 0 && prior[i].ult >= 100; i--) ready = prior[i].t;
      if (ready != null) charge = Math.max(0, Math.min(1, 1 - (u.t - ready) / 60));
      else charge = 0.8;
    }
    me.ult += 0.5 * swing + 0.3 * Math.min(1, direct / 2) + 0.2 * charge;
    // 한타 첫 킬 전에 쓴 궁은 교전 개시로도 친다
    if (f && u.t <= f.start) me.initiation += 0.5;
  }

  // 피해·치유: 5초 기록 사이에 늘어난 만큼을 그때 상황으로 보정 (새 스크립트). 없으면 그대로.
  for (const p of players) {
    const me = at(p.key);
    const snaps = snapsBy.get(p.key);
    if (!snaps?.length) {
      me.damage = p.damage;
      me.healing = p.healing;
      continue;
    }
    let prev = { t: ev.t0, dmg: 0, heal: 0 };
    for (const s of [...snaps, { t: ev.t1, dmg: p.damage, heal: p.healing }]) {
      const factor = flowFactor(p.team, (prev.t + s.t) / 2);
      me.damage += Math.max(0, s.dmg - prev.dmg) * factor;
      me.healing += Math.max(0, s.heal - prev.heal) * factor;
      prev = s;
    }
  }

  // 특수 능력: 영웅별 기준이 있으면 그것, 없으면 역할 공통 기준
  const abCount = (key, hero, slot) => ev.abs.filter((a) => a.key === key && a.hero === hero && a.slot === slot).length;
  for (const p of players) {
    const me = at(p.key);
    const fun = p.fun || {};
    let special;
    if (p.role === 'TANK') special = ((p.blocked || 0) + (p.taken || 0)) / 1000 + (fun.envKills || 0); // 막고 버틴 피해
    else if (p.role === 'SUPPORT') special = 0.5 * (p.defAssists || 0) + (fun.envKills || 0);
    else special = (p.solo || 0) + me.duels + (fun.envKills || 0);
    if (p.hero === '아나') special += 2 * (fun.sleeps || 0);
    if (p.hero === '메르시') special += 3 * (fun.rez || 0);
    if (p.hero === '키리코') special += abCount(p.key, '키리코', 2); // 정화의 방울
    if (p.hero === '루시우') special += 2 * (fun.envKills || 0);
    me.special = special;
  }

  const fightsSummary = { count: fights.length, won: { 1: fights.filter((f) => f.winner === 1).length, 2: fights.filter((f) => f.winner === 2).length } };
  return { inputs: out, fights: fightsSummary };
}

/** 저장된 재료로 PIR을 계산한다. 같은 역할끼리 요소마다 평균 100, 역할별 가중치로 합친다. */
export function computePir2(players) {
  const parts = Object.keys(PART_NAMES);
  const raw = new Map(
    players.map((p) => {
      const i = p.pir2;
      return [p.key, { kills: i.kills, survival: 1 / (1 + i.deathW), initiation: i.initiation, damage: i.damage, healing: i.healing, special: i.special, ult: i.ult }];
    }),
  );
  const roleOf = (p) => (ROLE_WEIGHTS[p.role] ? p.role : 'DAMAGE');
  const groups = new Map();
  for (const p of players) {
    const r = roleOf(p);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  }
  const result = new Map();
  for (const p of players) {
    const group = groups.get(roleOf(p)).length >= 2 ? groups.get(roleOf(p)) : players;
    const index = {};
    for (const c of parts) {
      const values = group.map((q) => raw.get(q.key)[c]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const allMean = players.reduce((a, q) => a + raw.get(q.key)[c], 0) / players.length;
      const smooth = 0.1 * allMean + 1e-6;
      index[c] = Math.min(INDEX_CAP, Math.round((100 * (raw.get(p.key)[c] + smooth)) / (mean + smooth)));
    }
    const w = ROLE_WEIGHTS[roleOf(p)];
    const bonus = roleOf(p) === 'TANK' ? PIR_OPTIONS.tankBonus : 1;
    const pir = Math.round(bonus * parts.reduce((a, c) => a + (w[c] * index[c]) / 100, 0));
    result.set(p.key, { pir, parts: index });
  }
  return result;
}
