#!/usr/bin/env node
// 떡잎.gg 수집기
// - 롤: 이 PC의 롤 클라이언트 전적 탭에서 사용자 설정 게임(내전) 결과를 읽어 사이트로 보낸다.
// - 오버워치: 떡잎.gg 워크샵 스크립트가 남긴 로그 파일(문서\Overwatch\Workshop)에서 끝난 경기를 찾아 보낸다.
// 다른 파일 없이 이 파일 하나만으로 돌아간다 (Node.js 18 이상).
//
//   node collector.mjs --server https://사이트주소 --key 내수집기키
//
// 롤 클라이언트는 자기 PC 안에서만 접속할 수 있는 API(LCU)를 연다.
// 접속 정보(포트, 비밀번호)는 실행 중인 LeagueClientUx 프로세스나 설치 폴더의 lockfile에 있다.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const VERSION = '0.2.0';
const POLL_MS = 30_000;
const PING_MS = 10 * 60_000;
const HISTORY_COUNT = 20;
const KEEP_STATE = 500;
const OW_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

// ---------------- 설정 ----------------
export function parseArgs(argv = [], env = {}) {
  const opts = {
    server: env.TTEONGNIP_SERVER || '',
    key: env.TTEONGNIP_KEY || '',
    once: false,
    statePath: env.TTEONGNIP_STATE || path.join(os.homedir(), '.tteongnip', 'collector-state.json'),
    leagueDir: env.TTEONGNIP_LEAGUE_DIR || '',
    lcuUrl: env.LCU_URL || '',
    lcuToken: env.LCU_TOKEN || '',
    owDir: env.TTEONGNIP_OW_DIR || '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] || '';
    if (a === '--server') opts.server = next();
    else if (a === '--key') opts.key = next();
    else if (a === '--once') opts.once = true;
    else if (a === '--state') opts.statePath = next();
    else if (a === '--league-dir') opts.leagueDir = next();
    else if (a === '--ow-dir') opts.owDir = next();
  }
  opts.server = opts.server.replace(/\/+$/, '');
  return opts;
}

// ---------------- 롤 클라이언트 찾기 ----------------
/** lockfile 내용: "LeagueClient:pid:port:password:https" */
export function parseLockfile(text) {
  const parts = String(text).trim().split(':');
  if (parts.length < 5) return null;
  const port = Number(parts[2]);
  if (!port || !parts[3]) return null;
  return { baseUrl: `${parts[4] || 'https'}://127.0.0.1:${port}`, token: parts[3] };
}

/** LeagueClientUx 실행 인자에서 --app-port 와 --remoting-auth-token 을 찾는다. */
export function parseCommandLine(cmd) {
  const port = /--app-port=["']?(\d+)/.exec(cmd)?.[1];
  const token = /--remoting-auth-token=["']?([\w-]+)/.exec(cmd)?.[1];
  return port && token ? { baseUrl: `https://127.0.0.1:${port}`, token } : null;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? '' : String(stdout)),
    );
  });
}

async function processCommandLine(platform) {
  if (platform === 'win32') {
    const ps = "Get-CimInstance -ClassName Win32_Process -Filter \"Name = 'LeagueClientUx.exe'\" | ForEach-Object { $_.CommandLine }";
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
  }
  if (platform === 'darwin') {
    const out = await run('ps', ['-A', '-o', 'args=']);
    return out.split('\n').filter((l) => l.includes('LeagueClientUx')).join('\n');
  }
  return '';
}

function lockfileCandidates(platform, leagueDir) {
  const list = [];
  if (leagueDir) list.push(path.join(leagueDir, 'lockfile'));
  if (platform === 'win32') {
    for (const drive of ['C', 'D', 'E']) list.push(`${drive}:\\Riot Games\\League of Legends\\lockfile`);
  } else if (platform === 'darwin') {
    list.push('/Applications/League of Legends.app/Contents/LoL/lockfile');
  }
  return list;
}

export async function findClient(opts, platform = process.platform) {
  if (opts.lcuUrl && opts.lcuToken) return { baseUrl: opts.lcuUrl.replace(/\/+$/, ''), token: opts.lcuToken };
  const fromProcess = parseCommandLine(await processCommandLine(platform));
  if (fromProcess) return fromProcess;
  for (const file of lockfileCandidates(platform, opts.leagueDir)) {
    try {
      const found = parseLockfile(fs.readFileSync(file, 'utf8'));
      if (found) return found;
    } catch {}
  }
  return null;
}

// ---------------- 롤 클라이언트 API ----------------
export class LcuError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createLcu({ baseUrl, token }) {
  const auth = `Basic ${Buffer.from(`riot:${token}`).toString('base64')}`;
  function get(pathname) {
    const url = new URL(pathname, baseUrl);
    const mod = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request(
        url,
        {
          method: 'GET',
          headers: { Authorization: auth, Accept: 'application/json' },
          // 롤 클라이언트는 자체 서명 인증서를 쓴다. 이 PC 안(127.0.0.1)에서만 접속한다.
          rejectUnauthorized: false,
          timeout: 20000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) {
              reject(new LcuError(`롤 클라이언트 응답 ${res.statusCode} (${pathname})`, { status: res.statusCode }));
              return;
            }
            try {
              resolve(JSON.parse(text));
            } catch {
              reject(new LcuError(`롤 클라이언트 응답을 읽지 못했어요 (${pathname})`));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new LcuError('롤 클라이언트가 응답하지 않아요', { code: 'ETIMEDOUT' })));
      req.on('error', (err) => reject(err instanceof LcuError ? err : new LcuError(err.message, { code: err.code })));
      req.end();
    });
  }
  return {
    get,
    me: () => get('/lol-summoner/v1/current-summoner'),
    history: () => get(`/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${HISTORY_COUNT - 1}`),
    game: (gameId) => get(`/lol-match-history/v1/games/${gameId}`),
  };
}

/** 롤 클라이언트가 꺼졌거나 다시 켜져서 접속 정보가 바뀐 경우 */
export const clientGone = (err) =>
  err instanceof LcuError && (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(err.code) || err.status === 401 || err.status === 403);

// ---------------- 사이트 API ----------------
export class ServerError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createServerApi({ server, key, fetch = globalThis.fetch }) {
  async function call(pathname, init = {}) {
    let res;
    try {
      res = await fetch(`${server}${pathname}`, {
        ...init,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers || {}) },
        // 무료 서버는 잠들어 있다가 깨는 데 1분 가까이 걸릴 수 있다
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      throw new ServerError(`사이트에 연결하지 못했어요 (${err.cause?.code || err.name})`, 0);
    }
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) throw new ServerError(body?.error || `사이트 응답 ${res.status}`, res.status);
    return body;
  }
  return {
    ping: () => call('/api/collector/ping'),
    upload: (game, uploader) =>
      call('/api/collector/matches', { method: 'POST', body: JSON.stringify({ game, uploader, collector: VERSION }) }),
    uploadOverwatch: (log, playedAt, file) =>
      call('/api/collector/overwatch', { method: 'POST', body: JSON.stringify({ log, playedAt, file, collector: VERSION }) }),
  };
}

// ---------------- 이미 올린 판 기억하기 ----------------
export function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const obj = (v) => (v && typeof v === 'object' ? v : {});
    return { sent: obj(s.sent), ow: obj(s.ow) };
  } catch {
    return { sent: {}, ow: {} };
  }
}

const prune = (map) =>
  Object.fromEntries(Object.entries(map || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, KEEP_STATE));

export function saveState(file, state) {
  state.sent = prune(state.sent);
  state.ow = prune(state.ow);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 1));
  } catch {}
}

const gameKey = (g) => `${g.platformId || 'KR'}_${g.gameId}`;

/** 최근 전적에서 아직 안 올린 사용자 설정 게임을 찾아 올린다. */
export async function syncOnce({ lcu, api, state, save = () => {}, uploader = null, log = () => {} }) {
  const list = await lcu.history();
  const games = list?.games?.games || [];
  const custom = games.filter((g) => g.gameType === 'CUSTOM_GAME' && g.gameMode !== 'PRACTICETOOL');
  const result = { checked: custom.length, created: 0, duplicate: 0, ignored: 0 };
  for (const g of custom) {
    const key = gameKey(g);
    if (state.sent[key]) continue;
    const detail = await lcu.game(g.gameId);
    const res = await api.upload(detail, uploader);
    state.sent[key] = { status: res.status, at: Date.now() };
    save(state);
    if (res.status === 'created') {
      result.created++;
      log(`새 내전을 올렸어요: ${when(g.gameCreation)} · ${Math.round((g.gameDuration || 0) / 60)}분 → ${res.url}`);
    } else if (res.status === 'duplicate') {
      result.duplicate++;
      log(`이미 기록된 내전이에요: ${when(g.gameCreation)}`);
    } else {
      result.ignored++;
      log(`기록하지 않는 게임이에요 (${res.reason}): ${when(g.gameCreation)}`);
    }
  }
  return result;
}

// ---------------- 오버워치 워크샵 로그 ----------------
/** 로그 파일을 경기 단위로 자른다. TN,end 줄까지 있어야 끝난 경기다. */
export function splitOwMatches(text) {
  const blocks = [];
  let cur = [];
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf('TN,');
    if (i < 0) continue;
    cur.push(line);
    if (line.slice(i).startsWith('TN,end,')) {
      blocks.push(cur);
      cur = [];
    }
  }
  return blocks.map((lines) => {
    const payloads = lines.map((l) => l.slice(l.indexOf('TN,')).trim());
    const startLine = lines.find((l) => l.includes('TN,start,')) || lines[0];
    return {
      text: lines.join('\n'),
      key: crypto.createHash('sha1').update(payloads.join('\n')).digest('hex').slice(0, 20),
      clock: /\[(\d{1,2}):(\d{2}):(\d{2})\]/.exec(startLine)?.slice(1).map(Number) || null,
    };
  });
}

/** 파일 이름(Log-2026-11-26-21-03-10.txt 같은)의 날짜와 줄 앞의 [21:15:00] 시간으로 경기 시각을 추정한다. */
export function estimatePlayedAt(fileName, clock, mtimeMs) {
  const m = /(\d{4})-(\d{2})-(\d{2})[-_ T](\d{2})-(\d{2})-(\d{2})/.exec(fileName);
  if (!m || !clock) return mtimeMs;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const fileStart = new Date(y, mo - 1, d, h, mi, se).getTime();
  let at = new Date(y, mo - 1, d, clock[0], clock[1], clock[2]).getTime();
  if (at < fileStart - 60_000) at += 24 * 3600 * 1000; // 자정을 넘긴 경우
  return at;
}

async function documentsDir(platform) {
  if (platform === 'win32') {
    const encoded = Buffer.from("[Environment]::GetFolderPath('MyDocuments')", 'utf16le').toString('base64');
    const out = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])).trim();
    if (out) return out;
  }
  return path.join(os.homedir(), 'Documents');
}

/** 오버워치 워크샵 로그 폴더 후보들 (문서 폴더가 OneDrive로 옮겨진 경우까지) */
export async function findOwDir(opts, platform = process.platform) {
  if (opts.owDir) return opts.owDir;
  const candidates = [
    path.join(await documentsDir(platform), 'Overwatch', 'Workshop'),
    path.join(os.homedir(), 'Documents', 'Overwatch', 'Workshop'),
    path.join(os.homedir(), 'OneDrive', 'Documents', 'Overwatch', 'Workshop'),
    path.join(os.homedir(), 'OneDrive', '문서', 'Overwatch', 'Workshop'),
  ];
  return candidates.find((d) => fs.existsSync(d)) || candidates[0];
}

/** 워크샵 로그 폴더에서 끝난 경기를 찾아 한 번씩만 올린다. */
export async function syncOverwatch({ dir, api, state, save = () => {}, log = () => {}, seen = new Map(), now = Date.now() }) {
  const result = { found: false, created: 0, duplicate: 0, ignored: 0 };
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.txt'));
  } catch {
    return result;
  }
  result.found = true;
  state.ow = state.ow || {};
  for (const name of names) {
    const file = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs > OW_MAX_AGE_MS || seen.get(file) === stat.mtimeMs) continue;
    const blocks = splitOwMatches(fs.readFileSync(file, 'utf8'));
    for (const b of blocks) {
      if (state.ow[b.key]) continue;
      const res = await api.uploadOverwatch(b.text, estimatePlayedAt(name, b.clock, stat.mtimeMs), name);
      state.ow[b.key] = { status: res.status, at: Date.now() };
      save(state);
      if (res.status === 'created') {
        result.created++;
        log(`오버워치 내전을 올렸어요: ${res.map || ''} ${res.score ? res.score.join(' : ') : ''} → ${res.url}`);
      } else if (res.status === 'duplicate') {
        result.duplicate++;
        log('이미 기록된 오버워치 내전이에요.');
      } else {
        result.ignored++;
        log(`기록하지 않는 오버워치 경기예요 (${res.reason})`);
      }
    }
    seen.set(file, stat.mtimeMs);
  }
  return result;
}

// ---------------- 실행 ----------------
function when(ms) {
  if (!ms) return '?';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function log(msg) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  console.log(`[${pad(d.getHours())}:${pad(d.getMinutes())}] ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv, env);
  console.log(`떡잎.gg 수집기 v${VERSION}`);
  console.log('이 창을 켜둔 채로 롤이나 오버워치를 하면 내전 결과가 자동으로 올라가요. 끄려면 창을 닫으세요.\n');
  if (!opts.server || !opts.key) {
    console.log('사이트 주소와 수집기 키가 필요해요. 사이트의 [수집기] 메뉴에서 받은 파일로 실행하세요.');
    console.log('직접 실행: node collector.mjs --server https://사이트주소 --key 수집기키');
    process.exitCode = 1;
    return;
  }

  const api = createServerApi(opts);
  log(`사이트 확인 중: ${opts.server} (잠들어 있으면 1분쯤 걸릴 수 있어요)`);
  for (;;) {
    try {
      const info = await api.ping();
      log(`사이트 연결됨 · ${info.site} · 올리는 사람: ${info.uploader}`);
      break;
    } catch (err) {
      if (err.status === 401) {
        log(`수집기 키가 맞지 않아요. ${err.message}`);
        process.exitCode = 1;
        return;
      }
      log(`${err.message}. 30초 뒤에 다시 시도할게요.`);
      if (opts.once) return;
      await sleep(POLL_MS);
    }
  }

  const state = loadState(opts.statePath);
  const save = (s) => saveState(opts.statePath, s);
  let lcu = null;
  let uploader = null;
  let waiting = false;
  let lastPing = Date.now();
  let lastError = '';
  const owDir = await findOwDir(opts);
  const owSeen = new Map();
  let owFound = null;
  let owError = '';

  for (;;) {
    // 오버워치: 롤 클라이언트와 상관없이 매번 확인
    try {
      const r = await syncOverwatch({ dir: owDir, api, state, save, log, seen: owSeen });
      if (r.found !== owFound) {
        owFound = r.found;
        log(r.found ? `오버워치 워크샵 로그 폴더 확인: ${owDir}` : `오버워치 워크샵 로그 폴더가 아직 없어요 (오버워치 설정에서 워크샵 로그를 켜면 생겨요): ${owDir}`);
      }
      owError = '';
    } catch (err) {
      if (err instanceof ServerError && err.status === 401) {
        log(`수집기 키가 맞지 않아요. ${err.message}`);
        process.exitCode = 1;
        return;
      }
      if (err.message !== owError) log(`오버워치 기록을 올리지 못했어요: ${err.message}. 잠시 뒤 다시 시도할게요.`);
      owError = err.message;
    }

    try {
      if (!lcu) {
        const client = await findClient(opts);
        if (client) {
          const candidate = createLcu(client);
          const me = await candidate.me();
          lcu = candidate;
          uploader = { puuid: me.puuid, gameName: me.gameName, tagLine: me.tagLine };
          log(`롤 클라이언트 연결됨: ${me.gameName || me.displayName}${me.tagLine ? `#${me.tagLine}` : ''}`);
          waiting = false;
        } else if (!waiting) {
          log('롤 클라이언트가 켜지길 기다리는 중...');
          waiting = true;
        }
      }
      if (lcu) {
        await syncOnce({ lcu, api, state, save, uploader, log });
        if (lastError) log('다시 정상적으로 확인하고 있어요.');
        lastError = '';
        if (Date.now() - lastPing > PING_MS) {
          lastPing = Date.now();
          api.ping().catch(() => {});
        }
      }
    } catch (err) {
      if (clientGone(err)) {
        if (lcu) log('롤 클라이언트가 꺼졌어요. 다시 켜지길 기다릴게요.');
        else if (!waiting) log('롤 클라이언트가 켜지길 기다리는 중...');
        lcu = null;
        waiting = true;
      } else if (err instanceof ServerError && err.status === 401) {
        log(`수집기 키가 맞지 않아요. ${err.message}`);
        process.exitCode = 1;
        return;
      } else if (err.message !== lastError) {
        // 로그인 중이라 전적을 아직 못 불러오는 경우 등. 같은 오류는 한 번만 보여준다.
        lastError = err.message;
        log(`${err.message}. 잠시 뒤 다시 시도할게요.`);
      }
    }
    if (opts.once) return;
    await sleep(POLL_MS);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
