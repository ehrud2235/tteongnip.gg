// 가짜 롤 클라이언트 + 진짜 사이트 서버로 수집기를 끝까지 돌려본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createLcu,
  createServerApi,
  loadState,
  main,
  parseArgs,
  parseCommandLine,
  parseLockfile,
  syncOnce,
} from '../collector/collector.mjs';
import { makeHistoryList, makeLcuGame, startApp } from './helpers.js';

function fakeLeagueClient(games, token = 'lcu-pass') {
  const requests = [];
  const byId = new Map(games.map((g) => [String(g.gameId), g]));
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.headers.authorization !== `Basic ${Buffer.from(`riot:${token}`).toString('base64')}`) {
      res.writeHead(401).end();
      return;
    }
    const json = (obj) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
    if (req.url === '/lol-summoner/v1/current-summoner') return json({ puuid: 'me', gameName: '쌈무', tagLine: 'KR1' });
    if (req.url.startsWith('/lol-match-history/v1/products/lol/current-summoner/matches')) return json(makeHistoryList(games));
    const m = /^\/lol-match-history\/v1\/games\/(\d+)$/.exec(req.url);
    if (m && byId.has(m[1])) return json(byId.get(m[1]));
    res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, token, requests, close: () => new Promise((r) => server.close(r)) }),
    ),
  );
}

test('lockfile과 실행 인자에서 접속 정보를 읽는다', () => {
  assert.deepEqual(parseLockfile('LeagueClient:1234:54321:abcDEF-123:https'), { baseUrl: 'https://127.0.0.1:54321', token: 'abcDEF-123' });
  assert.equal(parseLockfile('garbage'), null);
  const cmd = '"C:/Riot Games/League of Legends/LeagueClientUx.exe" "--riotclient-auth-token=xx" "--app-port=61234" "--remoting-auth-token=Tok_en-9" "--install-directory=C:/Riot Games"';
  assert.deepEqual(parseCommandLine(cmd), { baseUrl: 'https://127.0.0.1:61234', token: 'Tok_en-9' });
  assert.equal(parseCommandLine(''), null);
  const opts = parseArgs(['--server', 'https://x.test/', '--key', 'k', '--once'], { TTEONGNIP_STATE: '/tmp/s.json' });
  assert.deepEqual([opts.server, opts.key, opts.once, opts.statePath], ['https://x.test', 'k', true, '/tmp/s.json']);
});

test('최근 전적에서 내전만 골라 한 번씩만 올린다', async () => {
  const games = [
    makeLcuGame({ gameId: 1, createdAt: Date.UTC(2026, 10, 25, 12) }),
    makeLcuGame({ gameId: 2, createdAt: Date.UTC(2026, 10, 25, 13), winner: 200 }),
    makeLcuGame({ gameId: 3, gameType: 'MATCHED_GAME' }), // 솔랭: 상세 조회도 안 한다
    makeLcuGame({ gameId: 4, gameMode: 'PRACTICETOOL' }), // 연습: 상세 조회도 안 한다
    makeLcuGame({ gameId: 5, blue: ['혼자'], red: ['봇'] }), // 사용자 설정이지만 2명 → 서버가 거른다
  ];
  const lol = await fakeLeagueClient(games);
  const site = await startApp({ UPLOAD_KEY: 'k' });
  try {
    const lcu = createLcu({ baseUrl: lol.url, token: lol.token });
    const api = createServerApi({ server: site.base, key: 'k' });
    const state = { sent: {} };
    const logs = [];
    const first = await syncOnce({ lcu, api, state, log: (m) => logs.push(m) });
    assert.deepEqual(first, { checked: 3, created: 2, duplicate: 0, ignored: 1 });
    assert.equal(lol.requests.filter((u) => u.includes('/games/3') || u.includes('/games/4')).length, 0);
    assert.equal((await site.db.listMatches()).length, 2);
    assert.ok(logs.some((l) => l.includes('/matches/KR_1')));

    const before = lol.requests.length;
    const second = await syncOnce({ lcu, api, state });
    assert.deepEqual(second, { checked: 3, created: 0, duplicate: 0, ignored: 0 });
    assert.equal(lol.requests.length, before + 1, '두 번째에는 목록만 본다');

    // 다른 사람 PC에서 같은 판을 올려도 한 번만 기록된다
    const other = await syncOnce({ lcu, api, state: { sent: {} } });
    assert.equal(other.duplicate, 2);
    assert.equal((await site.db.listMatches()).length, 2);
  } finally {
    await lol.close();
    await site.close();
  }
});

test('수집기 전체 실행 (--once)', async () => {
  const lol = await fakeLeagueClient([makeLcuGame({ gameId: 11 })]);
  const site = await startApp({ UPLOAD_KEY: 'k' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tn-collector-'));
  const statePath = path.join(dir, 'state.json');
  const original = console.log;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  try {
    await main(['--server', site.base, '--key', 'k', '--once', '--state', statePath], { LCU_URL: lol.url, LCU_TOKEN: lol.token });
    console.log = original;
    assert.ok(out.some((l) => l.includes('사이트 연결됨')), out.join('\n'));
    assert.ok(out.some((l) => l.includes('롤 클라이언트 연결됨: 쌈무#KR1')), out.join('\n'));
    assert.ok(out.some((l) => l.includes('새 내전을 올렸어요')), out.join('\n'));
    assert.equal(loadState(statePath).sent.KR_11.status, 'created');
    assert.equal((await site.db.listMatches()).length, 1);

    out.length = 0;
    console.log = (...a) => out.push(a.join(' '));
    await main(['--server', site.base, '--key', 'wrong', '--once', '--state', statePath], {});
    console.log = original;
    assert.ok(out.some((l) => l.includes('수집기 키가 맞지 않아요')), out.join('\n'));
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = original;
    process.exitCode = 0;
    fs.rmSync(dir, { recursive: true, force: true });
    await lol.close();
    await site.close();
  }
});
