// 로그인(디스코드), 서명된 쿠키, 수집기 키.
import crypto from 'node:crypto';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';

const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 변조할 수 없는 토큰을 만든다. payload.exp(ms)가 지나면 무효. */
export function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function unsign(token, secret) {
  if (typeof token !== 'string') return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined || !safeEqual(mac, hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure = false, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge != null) s += `; Max-Age=${Math.floor(maxAge)}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  return s;
}

/** 멤버마다 다른 수집기 키. 서버 비밀값으로 서명해서 따로 저장할 필요가 없다. */
export function makeUploadKey(uid, secret) {
  return `tn1.${uid}.${hmac(secret, `upload:${uid}`).slice(0, 32)}`;
}

export function verifyUploadKey(key, secret, sharedKey = '') {
  if (typeof key !== 'string' || !key) return null;
  if (sharedKey && safeEqual(key, sharedKey)) return { uid: 'shared' };
  const [prefix, uid, mac, extra] = key.split('.');
  if (prefix !== 'tn1' || !uid || !mac || extra !== undefined) return null;
  return safeEqual(mac, hmac(secret, `upload:${uid}`).slice(0, 32)) ? { uid } : null;
}

export function csrfToken(uid, secret) {
  return hmac(secret, `csrf:${uid}`).slice(0, 32);
}

export function discordAvatarUrl(uid, avatar) {
  return avatar ? `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=64` : null;
}

/** 디스코드 OAuth2: identify + guilds.members.read 로 우리 서버 멤버인지 확인한다. */
export function createDiscordAuth({ config, fetch = globalThis.fetch }) {
  const redirectUri = `${config.baseUrl}/auth/callback`;
  return {
    authorizeUrl(state) {
      const q = new URLSearchParams({
        client_id: config.discord.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'identify guilds.members.read',
        state,
        prompt: 'none',
      });
      return `${DISCORD_AUTHORIZE}?${q}`;
    },

    /** @returns {Promise<{ok: true, user: {uid, name, avatar}} | {ok: false, reason: 'not_member' | 'error', detail?: string}>} */
    async login(code) {
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.discord.clientId,
          client_secret: config.discord.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenRes.ok) return { ok: false, reason: 'error', detail: `토큰 발급 실패 (${tokenRes.status})` };
      const { access_token: accessToken } = await tokenRes.json();
      const headers = { authorization: `Bearer ${accessToken}` };
      const meRes = await fetch(`${DISCORD_API}/users/@me`, { headers, signal: AbortSignal.timeout(10000) });
      if (!meRes.ok) return { ok: false, reason: 'error', detail: `사용자 정보 실패 (${meRes.status})` };
      const me = await meRes.json();
      const memberRes = await fetch(`${DISCORD_API}/users/@me/guilds/${config.discord.guildId}/member`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (memberRes.status === 404 || memberRes.status === 403) return { ok: false, reason: 'not_member' };
      if (!memberRes.ok) return { ok: false, reason: 'error', detail: `서버 멤버 확인 실패 (${memberRes.status})` };
      const member = await memberRes.json();
      return {
        ok: true,
        user: {
          uid: String(me.id),
          name: member.nick || me.global_name || me.username,
          avatar: me.avatar || null,
        },
      };
    },
  };
}
