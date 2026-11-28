// HTTP 요청 처리: 페이지, 로그인, 수집기 API.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createDiscordAuth,
  csrfToken,
  discordAvatarUrl,
  makeUploadKey,
  parseCookies,
  serializeCookie,
  sign,
  unsign,
  verifyUploadKey,
} from './auth.js';
import { createNotifier } from './discord.js';
import { applyPositionEdits, normalizeGame } from './game.js';
import { computeStats } from './stats.js';
import { normalizeOverwatch, owFormat, owPlayedAt, setOwWinner } from './overwatch.js';
import { computeOwStats } from './ow-stats.js';
import { PIR_OPTIONS } from './ow-pir.js';
import { makeDateFormat } from './util/format.js';
import * as pages from './views/pages.js';
import * as owPages from './views/ow.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const COLLECTOR_FILE = path.join(ROOT, 'collector', 'collector.mjs');
const WORKSHOP_FILE = path.join(ROOT, 'overwatch', 'workshop.txt');
const SESSION_COOKIE = 'tn_session';
const OAUTH_COOKIE = 'tn_oauth';
const SESSION_DAYS = 30;
const MATCHES_PER_PAGE = 20;
const MAX_JSON = 3 * 1024 * 1024;
const MAX_FORM = 64 * 1024;

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'",
  // 영웅 얼굴 이미지 주소는 바뀔 수 있어서 https 이미지는 모두 허용한다 (스크립트는 우리 사이트 것만)
  "img-src 'self' data: https:",
  "style-src 'self'",
  "script-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, '보낸 데이터가 너무 커요'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 다른 사이트로 튕기지 않도록 우리 사이트 안의 경로만 허용한다. */
function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

export function collectorBat({ server, key }) {
  const lines = [
    '@echo off',
    'setlocal',
    'title tteongnip.gg collector',
    'cd /d "%~dp0"',
    `set "TTEONGNIP_SERVER=${server}"`,
    `set "TTEONGNIP_KEY=${key}"`,
    'set "SCRIPT=%~dp0tteongnip-collector.mjs"',
    '',
    'rem Find Node.js even if PATH is not updated yet (right after installing)',
    'set "NODE="',
    'where node >nul 2>nul && set "NODE=node"',
    'if not defined NODE if exist "%ProgramFiles%\\nodejs\\node.exe" set "NODE=%ProgramFiles%\\nodejs\\node.exe"',
    'if not defined NODE if exist "%LOCALAPPDATA%\\Programs\\nodejs\\node.exe" set "NODE=%LOCALAPPDATA%\\Programs\\nodejs\\node.exe"',
    'if not defined NODE goto nonode',
    '',
    'echo Checking for the latest collector...',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri '%TTEONGNIP_SERVER%/collector/collector.mjs' -OutFile '%SCRIPT%.new'; Move-Item -Force '%SCRIPT%.new' '%SCRIPT%' } catch { exit 1 }"`,
    'if not exist "%SCRIPT%" goto nodownload',
    '',
    '"%NODE%" "%SCRIPT%"',
    'echo.',
    'pause',
    'goto end',
    '',
    ':nonode',
    'echo.',
    'echo [!] Node.js is not installed on this PC.',
    'echo     Install the LTS version from https://nodejs.org',
    'echo     then double-click this file again.',
    'echo     Already installed? Restart the PC and try again.',
    'start "" https://nodejs.org',
    'pause',
    'goto end',
    '',
    ':nodownload',
    'echo.',
    'echo [!] Could not download the collector from %TTEONGNIP_SERVER%',
    'echo     Check your internet connection and try again.',
    'pause',
    '',
    ':end',
    'endlocal',
    '',
  ];
  return lines.join('\r\n');
}

const NO_HERO_IMAGES = { portrait: () => null };

/** 표 정렬 기준. ?sort=games.desc,winRate.desc 처럼 최대 두 개 (예전 형식 ?sort=pir&dir=asc 도 받는다) */
export function parseSorts(url) {
  const fallbackDir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
  return String(url.searchParams.get('sort') || '')
    .split(',')
    .map((part) => {
      const [key, d] = part.split('.');
      return { key, dir: d === 'asc' || d === 'desc' ? d : fallbackDir };
    })
    .filter((x) => /^\w+$/.test(x.key || ''))
    .slice(0, 2);
}
const OW_TABS = ['all', '5v5', '6v6'];

export function createApp({ config, db, ddragon, owHeroes = NO_HERO_IMAGES, fetch = globalThis.fetch, log = console }) {
  PIR_OPTIONS.tankBonus = config.owTankBonus ?? PIR_OPTIONS.tankBonus;
  const discordAuth = createDiscordAuth({ config, fetch });
  const notifier = createNotifier({ config, fetch, log });
  const dates = makeDateFormat(config.timeZone);
  const assetVersion = Date.now().toString(36);
  const pending = new Set();
  let cache = null;

  const track = (promise) => {
    const p = Promise.resolve(promise)
      .catch((err) => log.error?.(err))
      .finally(() => pending.delete(p));
    pending.add(p);
  };

  async function getData() {
    if (!cache) {
      const [matches, links, members] = await Promise.all([db.listMatches(), db.listLinks(), db.listMembers()]);
      const lol = matches.filter((m) => (m.game || 'lol') === 'lol');
      const ow = matches.filter((m) => m.game === 'ow');
      cache = {
        matches: lol,
        byId: new Map(matches.map((m) => [m.id, m])),
        stats: computeStats(lol, { minRankedGames: config.minRankedGames }),
        // 오버워치는 전체 / 5대5 / 6대6 을 각각 따로 계산한다 (탭마다 그 판들로만 점수와 순위)
        ow: Object.fromEntries(
          Object.entries({ all: ow, '5v5': ow.filter((m) => owFormat(m) === '5v5'), '6v6': ow.filter((m) => owFormat(m) === '6v6') }).map(
            ([key, list]) => [key, { key, matches: list, stats: computeOwStats(list, { minRankedGames: config.minRankedGames }) }],
          ),
        ),
        links: new Map(links.map((l) => [l.puuid, l])),
        members: new Map(members.map((m) => [m.discordId, m])),
      };
    }
    return cache;
  }
  const invalidate = () => (cache = null);

  // ---------- 응답 도우미 ----------
  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'x-robots-tag': 'noindex, nofollow',
      ...headers,
    });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  }
  const sendHtml = (res, status, page, headers = {}) =>
    send(res, status, String(page), {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'cache-control': 'no-store',
      ...headers,
    });
  const sendJson = (res, status, obj) =>
    send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  const redirect = (res, location, headers = {}) => send(res, 303, '', { location, ...headers });

  function currentUser(req) {
    if (!config.authEnabled) return { uid: 'dev', name: '개발 모드', avatar: null, isAdmin: true, dev: true };
    const session = unsign(parseCookies(req.headers.cookie)[SESSION_COOKIE], config.sessionSecret);
    if (!session?.uid) return null;
    return {
      uid: session.uid,
      name: session.name,
      avatar: discordAvatarUrl(session.uid, session.avatar),
      isAdmin: config.adminIds.includes(session.uid),
    };
  }

  async function pageCtx(req, url) {
    const user = currentUser(req);
    const data = await getData();
    return {
      config,
      user,
      csrf: user ? csrfToken(user.uid, config.sessionSecret) : '',
      dd: ddragon,
      owh: owHeroes,
      dates,
      data,
      assetVersion,
      query: url.searchParams.get('q') || '',
      path: url.pathname,
      sorts: parseSorts(url),
      owTab: OW_TABS.includes(url.searchParams.get('f')) ? url.searchParams.get('f') : 'all',
      get ow() {
        return data.ow[this.owTab];
      },
      linkedName(puuid) {
        const l = data.links.get(puuid);
        return l ? data.members.get(l.discordId)?.name || '연결됨' : null;
      },
    };
  }

  async function readForm(req, ctx) {
    const form = new URLSearchParams(await readBody(req, MAX_FORM));
    if (!ctx.user) throw new HttpError(401, '로그인이 필요해요');
    const token = form.get('_csrf') || '';
    const expected = csrfToken(ctx.user.uid, config.sessionSecret);
    if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new HttpError(403, '페이지가 오래됐어요. 새로고침하고 다시 해주세요.');
    }
    return form;
  }

  function uploader(req) {
    const header = req.headers.authorization || '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    return verifyUploadKey(key, config.sessionSecret, config.uploadKey);
  }

  // ---------- 페이지 ----------
  const handlers = {
    async ranking(req, res, ctx) {
      sendHtml(res, 200, pages.rankingPage(ctx));
    },

    async matchList(req, res, ctx, url) {
      sendHtml(res, 200, pages.matchesPage(ctx, await pagedMatches(ctx, url, 'lol')));
    },

    async owMatchList(req, res, ctx, url) {
      sendHtml(res, 200, owPages.owMatchesPage(ctx, await pagedMatches(ctx, url, 'ow')));
    },

    async matchDetail(req, res, ctx, url, id) {
      const m = await findMatch(ctx, id);
      if (!m) return notFound(res, ctx);
      if (m.game === 'ow') return redirect(res, `/ow/matches/${encodeURIComponent(id)}`);
      sendHtml(res, 200, pages.matchPage(ctx, m));
    },

    async owMatchDetail(req, res, ctx, url, id) {
      const m = await findMatch(ctx, id);
      if (!m || m.game !== 'ow') return notFound(res, ctx);
      sendHtml(res, 200, owPages.owMatchPage(ctx, m));
    },

    async matchPositions(req, res, ctx, url, id) {
      const form = await readForm(req, ctx);
      if (!ctx.user.isAdmin) throw new HttpError(403, '라인은 관리자만 고칠 수 있어요');
      const m = await db.getMatch(id);
      if (!m) return notFound(res, ctx);
      const edits = {};
      for (const [k, v] of form) if (k.startsWith('pos_')) edits[k.slice(4)] = v;
      applyPositionEdits(m, edits);
      await db.updateMatch(m);
      invalidate();
      redirect(res, `/matches/${encodeURIComponent(id)}`);
    },

    async matchHide(req, res, ctx, url, id, action) {
      await readForm(req, ctx);
      if (!ctx.user.isAdmin) throw new HttpError(403, '관리자만 할 수 있어요');
      const m = await db.getMatch(id);
      if (!m) return notFound(res, ctx);
      await db.setHidden(id, action === 'hide');
      invalidate();
      redirect(res, `${m.game === 'ow' ? '/ow' : ''}/matches/${encodeURIComponent(id)}`);
    },

    async playerDetail(req, res, ctx, url, puuid) {
      const s = ctx.data.stats.players.get(puuid);
      if (!s) return notFound(res, ctx);
      sendHtml(res, 200, pages.playerPage(ctx, s));
    },

    async playerLink(req, res, ctx, url, puuid, action) {
      await linkPlayer(req, ctx, puuid, action, ctx.data.stats.players.has(puuid));
      redirect(res, `/players/${encodeURIComponent(puuid)}`);
    },

    async owPlayerDetail(req, res, ctx, url, name) {
      const key = `ow:${name.toLowerCase()}`;
      const s = ctx.ow.stats.players.get(key);
      if (!s) {
        // 이 탭(5대5/6대6)에서는 한 판이 없는 사람
        if (ctx.owTab !== 'all' && ctx.data.ow.all.stats.players.has(key)) {
          return sendHtml(res, 200, owPages.owPlayerEmptyPage(ctx, ctx.data.ow.all.stats.players.get(key)));
        }
        return notFound(res, ctx);
      }
      sendHtml(res, 200, owPages.owPlayerPage(ctx, s));
    },

    async owMatchWinner(req, res, ctx, url, id) {
      const form = await readForm(req, ctx);
      const m = await db.getMatch(id);
      if (!m || m.game !== 'ow') return notFound(res, ctx);
      // 점수로 확실히 정해진 판은 관리자만 고칠 수 있다
      if (!ctx.user.isAdmin) throw new HttpError(403, '승패는 관리자만 정할 수 있어요');
      const winner = Number(form.get('winner'));
      if (![0, 1, 2].includes(winner)) throw new HttpError(400, '이긴 팀을 골라주세요');
      setOwWinner(m, winner);
      await db.updateMatch(m);
      invalidate();
      redirect(res, `/ow/matches/${encodeURIComponent(id)}`);
    },

    async owPlayerLink(req, res, ctx, url, name, action) {
      const key = `ow:${name.toLowerCase()}`;
      await linkPlayer(req, ctx, key, action, ctx.data.ow.all.stats.players.has(key));
      redirect(res, `/ow/players/${encodeURIComponent(name.toLowerCase())}`);
    },

    async matchReparse(req, res, ctx, url, id) {
      await readForm(req, ctx);
      if (!ctx.user.isAdmin) throw new HttpError(403, '관리자만 할 수 있어요');
      const m = await db.getMatch(id);
      if (!m) return notFound(res, ctx);
      if (!(await reparseMatch(m))) throw new HttpError(400, '원본 기록이 없거나 다시 분석할 수 없는 판이에요');
      invalidate();
      redirect(res, `${m.game === 'ow' ? '/ow' : ''}/matches/${encodeURIComponent(id)}`);
    },

    async owReparseAll(req, res, ctx) {
      await readForm(req, ctx);
      if (!ctx.user.isAdmin) throw new HttpError(403, '관리자만 할 수 있어요');
      for (const m of (await db.listMatches({ includeHidden: true })).filter((x) => x.game === 'ow')) await reparseMatch(m);
      invalidate();
      redirect(res, '/ow/matches');
    },

    async owRanking(req, res, ctx) {
      sendHtml(res, 200, owPages.owRankingPage(ctx));
    },

    async owHeroList(req, res, ctx) {
      sendHtml(res, 200, owPages.owHeroesPage(ctx));
    },

    async workshopFile(req, res) {
      send(res, 200, await fs.readFile(WORKSHOP_FILE), {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="tteongnip-workshop.txt"',
      });
    },

    async championList(req, res, ctx) {
      sendHtml(res, 200, pages.championsPage(ctx));
    },

    async search(req, res, ctx, url) {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return redirect(res, '/');
      const needle = q.toLowerCase().replace(/\s+/g, '');
      const hit = (text) => String(text || '').toLowerCase().replace(/\s+/g, '').includes(needle);
      const results = [
        ...[...ctx.data.stats.players.values()]
          .filter((s) => hit(`${s.name}#${s.tag}`) || hit(ctx.linkedName(s.puuid)))
          .map((s) => ({ game: 'lol', s, url: `/players/${encodeURIComponent(s.puuid)}` })),
        ...[...ctx.data.ow.all.stats.players.values()]
          .filter((s) => hit(s.name) || hit(ctx.linkedName(s.key)))
          .map((s) => ({ game: 'ow', s, url: `/ow/players/${encodeURIComponent(s.key.slice(3))}` })),
      ].sort((a, b) => b.s.games - a.s.games);
      if (results.length === 1) return redirect(res, results[0].url);
      sendHtml(res, 200, pages.searchPage(ctx, { q, results }));
    },

    async collectorPage(req, res, ctx) {
      const workshop = await fs.readFile(WORKSHOP_FILE, 'utf8');
      sendHtml(res, 200, pages.collectorPage(ctx, { key: makeUploadKey(ctx.user.uid, config.sessionSecret), workshop }));
    },

    async collectorBatFile(req, res, ctx) {
      const body = collectorBat({ server: config.baseUrl, key: makeUploadKey(ctx.user.uid, config.sessionSecret) });
      send(res, 200, body, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="tteongnip-collector.bat"',
        'cache-control': 'no-store',
      });
    },
  };

  // ---------- 로그인 없이 열리는 것들 ----------
  const open = {
    async healthz(req, res) {
      send(res, 200, 'ok', { 'content-type': 'text/plain' });
    },

    async robots(req, res) {
      send(res, 200, 'User-agent: *\nDisallow: /\n', { 'content-type': 'text/plain' });
    },

    async staticFile(req, res, url, name) {
      const ext = path.extname(name);
      if (!CONTENT_TYPES[ext]) throw new HttpError(404, '없는 파일이에요');
      let body;
      try {
        body = await fs.readFile(path.join(PUBLIC_DIR, path.basename(name)));
      } catch {
        throw new HttpError(404, '없는 파일이에요');
      }
      send(res, 200, body, { 'content-type': CONTENT_TYPES[ext], 'cache-control': 'public, max-age=86400' });
    },

    async collectorScript(req, res) {
      send(res, 200, await fs.readFile(COLLECTOR_FILE), {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
      });
    },

    async login(req, res, url) {
      if (!config.authEnabled) return redirect(res, '/');
      const next = safeNext(url.searchParams.get('next'));
      if (currentUser(req)) return redirect(res, next);
      const ctx = { config, user: null, dates, assetVersion, dd: ddragon };
      sendHtml(res, 200, pages.loginPage(ctx, { next }));
    },

    async authStart(req, res, url) {
      if (!config.authEnabled) return redirect(res, '/');
      const state = crypto.randomBytes(16).toString('hex');
      const next = safeNext(url.searchParams.get('next'));
      const cookie = sign({ state, next, exp: Date.now() + 10 * 60 * 1000 }, config.sessionSecret);
      redirect(res, discordAuth.authorizeUrl(state), {
        'set-cookie': serializeCookie(OAUTH_COOKIE, cookie, { maxAge: 600, secure: config.secureCookies }),
      });
    },

    async authCallback(req, res, url) {
      if (!config.authEnabled) return redirect(res, '/');
      const ctx = { config, user: null, dates, assetVersion, dd: ddragon };
      const saved = unsign(parseCookies(req.headers.cookie)[OAUTH_COOKIE], config.sessionSecret);
      const clearOauth = serializeCookie(OAUTH_COOKIE, '', { maxAge: 0, secure: config.secureCookies });
      const code = url.searchParams.get('code');
      if (!saved || !code || saved.state !== url.searchParams.get('state')) {
        return sendHtml(res, 400, pages.loginPage(ctx, { error: '로그인이 중간에 끊겼어요. 다시 시도해 주세요.' }), { 'set-cookie': clearOauth });
      }
      let result;
      try {
        result = await discordAuth.login(code);
      } catch (err) {
        result = { ok: false, reason: 'error', detail: err.message };
      }
      if (!result.ok) {
        const notMember = result.reason === 'not_member';
        if (!notMember) log.warn?.(`[login] ${result.detail}`);
        return sendHtml(
          res,
          notMember ? 403 : 502,
          pages.loginPage(ctx, {
            next: saved.next,
            error: notMember ? '우리 디스코드 서버 멤버만 들어올 수 있어요.' : '디스코드 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.',
          }),
          { 'set-cookie': clearOauth },
        );
      }
      const { user } = result;
      await db.upsertMember({ discordId: user.uid, name: user.name, avatar: user.avatar });
      invalidate();
      const session = sign({ uid: user.uid, name: user.name, avatar: user.avatar, exp: Date.now() + SESSION_DAYS * 86400000 }, config.sessionSecret);
      redirect(res, safeNext(saved.next), {
        'set-cookie': [
          clearOauth,
          serializeCookie(SESSION_COOKIE, session, { maxAge: SESSION_DAYS * 86400, secure: config.secureCookies }),
        ],
      });
    },

    async logout(req, res) {
      redirect(res, config.authEnabled ? '/login' : '/', {
        'set-cookie': serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }),
      });
    },

    async apiPing(req, res) {
      const who = uploader(req);
      if (!who) return sendJson(res, 401, { error: '수집기 키가 맞지 않아요. 사이트의 수집기 페이지에서 새로 받아주세요.' });
      const data = await getData();
      sendJson(res, 200, {
        ok: true,
        site: config.siteName,
        uploader: data.members.get(who.uid)?.name || (who.uid === 'shared' ? '공용 키' : who.uid === 'dev' ? '개발 모드' : '멤버'),
        matches: data.stats.totalMatches,
      });
    },

    async apiUpload(req, res) {
      const who = uploader(req);
      if (!who) return sendJson(res, 401, { error: '수집기 키가 맞지 않아요. 사이트의 수집기 페이지에서 새로 받아주세요.' });
      let body;
      try {
        body = JSON.parse(await readBody(req, MAX_JSON));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        return sendJson(res, 400, { error: 'JSON 형식이 아니에요' });
      }
      const game = body?.game;
      const result = normalizeGame(game, {
        minPlayers: config.minPlayers,
        minDuration: config.minDuration,
        allowedModes: config.allowedModes,
        championTags: (id) => ddragon.championTags(id),
      });
      if (!result.ok) return sendJson(res, 200, { status: 'ignored', reason: result.reason });
      const match = result.match;
      const status = await db.insertMatch({ match, raw: game, uploadedBy: who.uid });
      if (status === 'created') {
        invalidate();
        log.info?.(`[upload] 새 내전 ${match.id} (올린 사람 ${who.uid})`);
        track(
          (async () => {
            const data = await getData();
            await notifier.matchCreated(match, {
              ddragon,
              deltas: data.stats.deltas.get(match.id) || {},
              linkOf: (puuid) => data.links.get(puuid)?.discordId || null,
            });
          })(),
        );
      }
      sendJson(res, status === 'created' ? 201 : 200, {
        status,
        id: match.id,
        url: `${config.baseUrl}/matches/${encodeURIComponent(match.id)}`,
      });
    },
  };

  open.apiUploadOverwatch = async (req, res) => {
    const who = uploader(req);
    if (!who) return sendJson(res, 401, { error: '수집기 키가 맞지 않아요. 사이트의 수집기 페이지에서 새로 받아주세요.' });
    let body;
    try {
      body = JSON.parse(await readBody(req, MAX_JSON));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      return sendJson(res, 400, { error: 'JSON 형식이 아니에요' });
    }
    // 경기 시각은 로그 파일 이름 + 줄 앞의 경과 시간으로 서버가 직접 계산한다 (예전 수집기는 잘못 계산했다)
    const playedAt = owPlayedAt(body?.file, body?.log, config.timeZone) || Number(body?.playedAt) || Date.now();
    const result = normalizeOverwatch(body?.log, {
      minPlayers: config.owMinPlayers,
      minDuration: config.owMinDuration,
      playedAt,
    });
    if (!result.ok) return sendJson(res, 200, { status: 'ignored', reason: result.reason });
    const match = result.match;
    const status = await db.insertMatch({ match, raw: { log: body.log, playedAt: body.playedAt, file: body.file }, uploadedBy: who.uid });
    if (status === 'created') {
      invalidate();
      log.info?.(`[upload] 새 오버워치 내전 ${match.id} (올린 사람 ${who.uid})`);
      track(
        (async () => {
          const data = await getData();
          await notifier.owMatchCreated(match, {
            deltas: data.ow[owFormat(match)].stats.deltas.get(match.id) || {},
            linkOf: (key) => data.links.get(key)?.discordId || null,
          });
        })(),
      );
    }
    sendJson(res, status === 'created' ? 201 : 200, {
      status,
      id: match.id,
      url: `${config.baseUrl}/ow/matches/${encodeURIComponent(match.id)}`,
      map: match.map,
      score: match.score,
    });
  };

  async function pagedMatches(ctx, url, game) {
    const showHidden = url.searchParams.get('hidden') === '1' && ctx.user?.isAdmin;
    const all = showHidden
      ? (await db.listMatches({ includeHidden: true })).filter(
          (m) => m.meta.hidden && (m.game || 'lol') === game && (game !== 'ow' || ctx.owTab === 'all' || owFormat(m) === ctx.owTab),
        )
      : game === 'ow'
        ? ctx.ow.matches
        : ctx.data.matches;
    const pagesCount = Math.max(1, Math.ceil(all.length / MATCHES_PER_PAGE));
    const page = Math.min(pagesCount, Math.max(1, Number(url.searchParams.get('page')) || 1));
    return { matches: all.slice((page - 1) * MATCHES_PER_PAGE, page * MATCHES_PER_PAGE), page, pages: pagesCount, showHidden };
  }

  /** 저장된 원본으로 지금 방식대로 다시 계산한다. 직접 고친 승패·라인은 유지한다. */
  async function reparseMatch(m) {
    const raw = await db.getRaw(m.id);
    if (!raw) return false;
    let next;
    if (m.game === 'ow') {
      const playedAt = owPlayedAt(raw.file, raw.log, config.timeZone) || m.createdAt;
      const r = normalizeOverwatch(raw.log, { minPlayers: 2, minDuration: 0, playedAt });
      if (!r.ok) return false;
      next = r.match;
      if (m.winnerSource === 'manual') setOwWinner(next, m.winner);
      next.id = m.id;
      await db.updateMatch(next);
      return true;
    } else {
      const r = normalizeGame(raw, { minPlayers: 2, minDuration: 0, allowedModes: [m.mode], championTags: (id) => ddragon.championTags(id) });
      if (!r.ok) return false;
      next = r.match;
      for (const old of m.players) {
        const p = next.players.find((x) => x.participantId === old.participantId);
        if (p && old.positionManual) Object.assign(p, { position: old.position, positionManual: true });
      }
    }
    next.id = m.id;
    next.createdAt = m.createdAt;
    await db.updateMatch(next);
    return true;
  }

  /** 숨긴 내전은 관리자만 볼 수 있다. */
  async function findMatch(ctx, id) {
    const m = ctx.data.byId.get(id) || (ctx.user?.isAdmin ? await db.getMatch(id) : null);
    if (m) {
      const by = m.meta?.uploadedBy;
      ctx.uploaderName = by && by !== 'shared' && by !== 'dev' ? ctx.data.members.get(by)?.name : null;
    }
    return m;
  }

  async function linkPlayer(req, ctx, key, action, exists) {
    await readForm(req, ctx);
    if (!exists) throw new HttpError(404, '기록이 없는 플레이어예요');
    const existing = ctx.data.links.get(key);
    if (action === 'link') {
      if (existing && existing.discordId !== ctx.user.uid && !ctx.user.isAdmin) {
        throw new HttpError(403, '이미 다른 사람과 연결된 계정이에요. 관리자에게 말해주세요.');
      }
      await db.setLink(key, ctx.user.uid);
      if (ctx.user.dev) await db.upsertMember({ discordId: 'dev', name: '개발 모드', avatar: null });
    } else if (existing) {
      if (existing.discordId !== ctx.user.uid && !ctx.user.isAdmin) throw new HttpError(403, '내 계정만 연결을 끊을 수 있어요');
      await db.removeLink(key);
    }
    invalidate();
  }

  // [메서드, 경로, 처리 함수, 로그인 없이 열림?]
  const routes = [
    ['GET', /^\/healthz$/, open.healthz, true],
    ['GET', /^\/robots\.txt$/, open.robots, true],
    ['GET', /^\/static\/([\w.-]+)$/, open.staticFile, true],
    ['GET', /^\/collector\/collector\.mjs$/, open.collectorScript, true],
    ['GET', /^\/login$/, open.login, true],
    ['GET', /^\/auth\/discord$/, open.authStart, true],
    ['GET', /^\/auth\/callback$/, open.authCallback, true],
    ['POST', /^\/logout$/, open.logout, true],
    ['GET', /^\/api\/collector\/ping$/, open.apiPing, true],
    ['POST', /^\/api\/collector\/matches$/, open.apiUpload, true],
    ['POST', /^\/api\/collector\/overwatch$/, open.apiUploadOverwatch, true],
    ['GET', /^\/$/, handlers.ranking],
    ['GET', /^\/matches$/, handlers.matchList],
    ['GET', /^\/matches\/([\w-]+)$/, handlers.matchDetail],
    ['POST', /^\/matches\/([\w-]+)\/positions$/, handlers.matchPositions],
    ['POST', /^\/matches\/([\w-]+)\/(hide|unhide)$/, handlers.matchHide],
    ['POST', /^\/matches\/([\w-]+)\/reparse$/, handlers.matchReparse],
    ['POST', /^\/ow\/reparse-all$/, handlers.owReparseAll],
    ['GET', /^\/players\/([\w-]+)$/, handlers.playerDetail],
    ['POST', /^\/players\/([\w-]+)\/(link|unlink)$/, handlers.playerLink],
    ['GET', /^\/champions$/, handlers.championList],
    ['GET', /^\/search$/, handlers.search],
    ['GET', /^\/collector$/, handlers.collectorPage],
    ['GET', /^\/collector\/tteongnip-collector\.bat$/, handlers.collectorBatFile],
    ['GET', /^\/collector\/overwatch-workshop\.txt$/, handlers.workshopFile],
    ['GET', /^\/ow$/, handlers.owRanking],
    ['GET', /^\/ow\/matches$/, handlers.owMatchList],
    ['GET', /^\/ow\/matches\/([\w-]+)$/, handlers.owMatchDetail],
    ['POST', /^\/ow\/matches\/([\w-]+)\/winner$/, handlers.owMatchWinner],
    ['GET', /^\/ow\/players\/([^/]+)$/, handlers.owPlayerDetail],
    ['POST', /^\/ow\/players\/([^/]+)\/(link|unlink)$/, handlers.owPlayerLink],
    ['GET', /^\/ow\/heroes$/, handlers.owHeroList],
  ];

  async function notFound(res, ctx) {
    sendHtml(res, 404, pages.messagePage(ctx, { title: '찾을 수 없어요', message: '주소가 틀렸거나 지워진 기록이에요.' }));
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(res, 400, 'bad request');
    }
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const isApi = url.pathname.startsWith('/api/');
    try {
      let pathMatched = false;
      for (const [m, re, fn, isOpen] of routes) {
        const match = re.exec(url.pathname);
        if (!match) continue;
        pathMatched = true;
        if (m !== method) continue;
        let params;
        try {
          params = match.slice(1).map((p) => decodeURIComponent(p));
        } catch {
          throw new HttpError(404, '주소가 잘못됐어요');
        }
        if (isOpen) return await fn(req, res, url, ...params);
        if (config.authEnabled && !currentUser(req)) {
          if (method !== 'GET') throw new HttpError(401, '로그인이 필요해요');
          return redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
        }
        const ctx = await pageCtx(req, url);
        return await fn(req, res, ctx, url, ...params);
      }
      if (pathMatched) throw new HttpError(405, '지원하지 않는 요청이에요');
      if (config.authEnabled && !currentUser(req)) return redirect(res, `/login?next=${encodeURIComponent(url.pathname)}`);
      return notFound(res, await pageCtx(req, url));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log.error?.(err);
      const message = status === 500 ? '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' : err.message;
      if (res.headersSent) return res.end();
      if (isApi) return sendJson(res, status, { error: message });
      try {
        const ctx = await pageCtx(req, url);
        return sendHtml(res, status, pages.messagePage(ctx, { title: status === 500 ? '앗, 문제가 생겼어요' : '할 수 없어요', message }));
      } catch {
        return send(res, status, message, { 'content-type': 'text/plain; charset=utf-8' });
      }
    }
  }

  return {
    handle,
    /** 웹후크 같은 뒤처리 작업이 끝날 때까지 기다린다 (테스트용). */
    async drain() {
      while (pending.size) await Promise.all([...pending]);
    },
    invalidate,
  };
}
