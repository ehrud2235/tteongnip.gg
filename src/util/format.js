export const POSITION_NAMES = {
  TOP: '탑',
  JUNGLE: '정글',
  MIDDLE: '미드',
  BOTTOM: '원딜',
  UTILITY: '서폿',
};

export const MODE_NAMES = {
  CLASSIC: '소환사의 협곡',
  ARAM: '칼바람 나락',
};

export function modeName(mode) {
  return MODE_NAMES[mode] || mode || '사용자 설정';
}

export function fmtDuration(sec) {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}분 ${String(s).padStart(2, '0')}초`;
}

export function winRate(wins, games) {
  return games ? Math.round((wins / games) * 1000) / 10 : 0;
}

export function fmtPct(wins, games) {
  return `${winRate(wins, games)}%`;
}

export function kdaRatio(kills, deaths, assists) {
  if (deaths === 0) return kills + assists > 0 ? Infinity : 0;
  return (kills + assists) / deaths;
}

export function fmtRatio(ratio) {
  if (ratio === Infinity) return 'Perfect';
  return ratio.toFixed(2);
}

export function fmtNum(n) {
  return Math.round(n).toLocaleString('ko-KR');
}

export function fmtAvg(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function fmtSigned(n) {
  return n > 0 ? `+${n}` : String(n);
}

/** 사이트 시간대(기본: 한국) 기준 날짜 포맷 함수들을 만든다. */
export function makeDateFormat(timeZone = 'Asia/Seoul') {
  const f = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (ms) => Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const date = (ms) => {
    const p = parts(ms);
    return `${p.year}.${p.month}.${p.day} (${p.weekday}) ${p.hour}:${p.minute}`;
  };
  const ago = (ms, now = Date.now()) => {
    const diff = Math.max(0, now - ms);
    const min = Math.floor(diff / 60000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}일 전`;
    const p = parts(ms);
    return `${p.year}.${p.month}.${p.day}`;
  };
  const day = (ms) => {
    const p = parts(ms);
    return `${p.year}.${p.month}.${p.day} (${p.weekday})`;
  };
  const time = (ms) => {
    const p = parts(ms);
    return `${p.hour}:${p.minute}`;
  };
  return { date, ago, day, time };
}
