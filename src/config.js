import crypto from 'node:crypto';

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** 환경 변수에서 설정을 읽는다. 각 값의 뜻은 .env.example 참고. */
export function loadConfig(env = process.env) {
  const port = Number(env.PORT) || 3000;
  const baseUrl = (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const discord = {
    clientId: env.DISCORD_CLIENT_ID || '',
    clientSecret: env.DISCORD_CLIENT_SECRET || '',
    guildId: env.DISCORD_GUILD_ID || '',
    webhookUrl: env.DISCORD_WEBHOOK_URL || '',
  };
  const warnings = [];
  const authEnabled = Boolean(discord.clientId && discord.clientSecret && discord.guildId);
  if (!authEnabled) {
    warnings.push('디스코드 로그인이 설정되지 않아 누구나 사이트를 볼 수 있어요 (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID).');
  }
  let sessionSecret = env.SESSION_SECRET || '';
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    warnings.push('SESSION_SECRET이 없어서 임시 값을 써요. 서버를 다시 켜면 로그인과 수집기 키가 초기화돼요.');
  }
  return {
    port,
    baseUrl,
    secureCookies: baseUrl.startsWith('https://'),
    siteName: env.SITE_NAME || '떡잎.gg',
    timeZone: env.SITE_TIMEZONE || 'Asia/Seoul',
    databaseUrl: env.DATABASE_URL || '',
    dataDir: env.DATA_DIR || 'data',
    sessionSecret,
    uploadKey: env.UPLOAD_KEY || '',
    discord,
    authEnabled,
    adminIds: list(env.ADMIN_DISCORD_IDS),
    minRankedGames: Math.max(1, Number(env.MIN_RANKED_GAMES) || 5),
    minPlayers: Math.max(2, Number(env.MIN_PLAYERS) || 10),
    minDuration: Number(env.MIN_GAME_SECONDS ?? 300) || 0,
    allowedModes: list(env.ALLOWED_MODES || 'CLASSIC').map((m) => m.toUpperCase()),
    owMinPlayers: Math.max(2, Number(env.OW_MIN_PLAYERS) || 8),
    owMinDuration: Number(env.OW_MIN_GAME_SECONDS ?? 180) || 0,
    warnings,
  };
}
