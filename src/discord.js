// 새 내전이 기록되면 디스코드 채널에 결과를 올린다 (채널 웹후크 주소만 있으면 된다, 봇 불필요).
import { fmtDuration, fmtSigned, modeName } from './util/format.js';

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

export function createNotifier({ config, fetch = globalThis.fetch, log = console }) {
  const url = config.discord.webhookUrl;
  return {
    enabled: Boolean(url),
    async matchCreated(match, ctx) {
      if (!url) return;
      const body = buildMatchMessage(match, { baseUrl: config.baseUrl, siteName: config.siteName, ...ctx });
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
    },
  };
}
