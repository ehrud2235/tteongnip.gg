// 새 내전이 기록되면 디스코드 채널에 결과를 올린다 (채널 웹후크 주소만 있으면 된다, 봇 불필요).
import { fmtDuration, fmtSigned, modeName } from './util/format.js';
import { matchHighlights } from './overwatch.js';

const BLUE = 0x4c8dff;
const RED = 0xff5a5f;

export function buildMatchMessage(match, { baseUrl, siteName, ddragon, deltas = {}, linkOf = () => null }) {
  const line = (p) => {
    const champ = ddragon.champion(p.championId).name;
    const who = linkOf(p.puuid) ? `<@${linkOf(p.puuid)}>` : p.name;
    const delta = deltas[p.puuid];
    return `**${champ}** ${who} · ${p.kills}/${p.deaths}/${p.assists}${delta != null ? ` (${fmtSigned(delta)})` : ''}`;
  };
  const team = (teamId) => match.players.filter((p) => p.teamId === teamId).map(line).join('\n') || '-';
  const won = (teamId) => (match.winner === teamId ? ' 🏆 승리' : '');
  return {
    username: siteName,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `내전 결과 · ${modeName(match.mode)} · ${fmtDuration(match.duration)}`,
        url: `${baseUrl}/matches/${encodeURIComponent(match.id)}`,
        color: match.winner === 100 ? BLUE : RED,
        fields: [
          { name: `🔵 블루팀${won(100)}`, value: team(100).slice(0, 1024), inline: true },
          { name: `🔴 레드팀${won(200)}`, value: team(200).slice(0, 1024), inline: true },
        ],
        timestamp: new Date(match.createdAt).toISOString(),
        footer: { text: `${siteName}에서 자세히 보기` },
      },
    ],
  };
}

export function buildOwMatchMessage(match, { baseUrl, siteName, deltas = {}, linkOf = () => null, highlights = [] }) {
  const line = (p) => {
    const who = linkOf(p.key) ? `<@${linkOf(p.key)}>` : p.name;
    const delta = deltas[p.key];
    return `**${p.hero}** ${who} · ${p.elims}/${p.assists}/${p.deaths}${delta ? ` (${fmtSigned(delta)})` : ''}`;
  };
  const team = (t) => match.players.filter((p) => p.team === t).map(line).join('\n') || '-';
  const won = (t) => (match.winner === t ? ' 🏆 승리' : '');
  return {
    username: siteName,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `오버워치 내전 · ${match.map} · ${match.score[0]} : ${match.score[1]}`,
        url: `${baseUrl}/ow/matches/${encodeURIComponent(match.id)}`,
        description: highlights.map((h) => `${h.icon} **${h.who.name}** ${h.text}`).join('\n').slice(0, 2000) || undefined,
        color: match.winner === 1 ? BLUE : match.winner === 2 ? RED : 0x8a93a6,
        fields: [
          { name: `1팀${won(1)}`, value: team(1).slice(0, 1024), inline: true },
          { name: `2팀${won(2)}`, value: team(2).slice(0, 1024), inline: true },
        ],
        timestamp: new Date(match.createdAt).toISOString(),
        footer: { text: `${match.mode} · ${fmtDuration(match.duration)} · 처치/도움/죽음` },
      },
    ],
  };
}

export function createNotifier({ config, fetch = globalThis.fetch, log = console }) {
  const url = config.discord.webhookUrl;
  async function post(body) {
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) log.warn?.(`[discord] 결과 메시지를 못 올렸어요 (${res.status})`);
    } catch (err) {
      log.warn?.(`[discord] 결과 메시지를 못 올렸어요: ${err.message}`);
    }
  }
  return {
    enabled: Boolean(url),
    matchCreated: (match, ctx) => post(buildMatchMessage(match, { baseUrl: config.baseUrl, siteName: config.siteName, ...ctx })),
    owMatchCreated: (match, ctx) =>
      post(buildOwMatchMessage(match, { baseUrl: config.baseUrl, siteName: config.siteName, highlights: matchHighlights(match).slice(0, 3), ...ctx })),
  };
}
