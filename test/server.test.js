import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csrfToken, makeUploadKey } from '../src/auth.js';
import { makeLcuGame, makeOwLog, puuidOf, startApp } from './helpers.js';

const upload = (base, key, game) =>
  fetch(`${base}/api/collector/matches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ game }),
  });

const form = (obj) => ({
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(obj).toString(),
});

test('개발 모드: 업로드, 중복, 페이지, 라인 수정, 숨기기, 디스코드 알림', async () => {
  const hooks = [];
  const fakeFetch = async (url, init) => {
    hooks.push({ url, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  const t = await startApp({ UPLOAD_KEY: 'shared-key', DISCORD_WEBHOOK_URL: 'https://discord.test/hook' }, { fetch: fakeFetch });
  try {
    const game = makeLcuGame({ gameId: 42, blue: ['쌈무', '나', '다', '라', '마'], winner: 100 });

    assert.equal((await upload(t.base, 'wrong', game)).status, 401);
    const created = await upload(t.base, 'shared-key', game);
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { status: 'created', id: 'KR_42', url: 'http://tteongnip.test/matches/KR_42' });
    const dup = await upload(t.base, 'shared-key', game);
    assert.equal((await dup.json()).status, 'duplicate');
    const ranked = await upload(t.base, 'shared-key', makeLcuGame({ gameId: 43, gameType: 'MATCHED_GAME' }));
    assert.equal((await ranked.json()).status, 'ignored');
    const bad = await fetch(`${t.base}/api/collector/matches`, { method: 'POST', headers: { authorization: 'Bearer shared-key' }, body: '{' });
    assert.equal(bad.status, 400);

    await t.app.drain();
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].url, 'https://discord.test/hook');
    const embed = hooks[0].body.embeds[0];
    assert.match(embed.title, /내전 결과/);
    assert.match(embed.fields[0].name, /승리/);
    assert.match(embed.fields[0].value, /\*\*아트록스\*\* 쌈무 · 3\/2\/5 \(\+20\)/);
    assert.deepEqual(hooks[0].body.allowed_mentions, { parse: [] });

    const home = await (await fetch(`${t.base}/`)).text();
    assert.match(home, /내전 랭킹/);
    assert.match(home, /쌈무/);
    assert.match(home, /배치 중/);

    const matchRes = await fetch(`${t.base}/matches/KR_42`);
    assert.equal(matchRes.status, 200);
    assert.match(matchRes.headers.get('content-security-policy'), /default-src 'self'/);
    const matchHtml = await matchRes.text();
    assert.match(matchHtml, /MVP/);
    assert.match(matchHtml, /아트록스/);
    assert.match(matchHtml, /직접 고치기/);

    const player = await fetch(`${t.base}/players/${puuidOf('쌈무')}`);
    assert.equal(player.status, 200);
    assert.match(await player.text(), /쌈무<span class="tag">#KR1/);
    assert.equal((await fetch(`${t.base}/players/nobody`)).status, 404);
    assert.equal((await fetch(`${t.base}/champions`)).status, 200);
    assert.equal((await fetch(`${t.base}/matches`)).status, 200);

    const search = await fetch(`${t.base}/search?q=쌈`, { redirect: 'manual' });
    assert.equal(search.status, 303);
    assert.equal(search.headers.get('location'), `/players/${puuidOf('쌈무')}`);

    // 라인 수정: CSRF 토큰 없으면 거절
    assert.equal((await fetch(`${t.base}/matches/KR_42/positions`, form({ pos_1: 'UTILITY' }))).status, 403);
    const csrf = csrfToken('dev', 'test-secret');
    const edit = await fetch(`${t.base}/matches/KR_42/positions`, form({ _csrf: csrf, pos_1: 'UTILITY', pos_5: 'TOP' }));
    assert.equal(edit.status, 303);
    const edited = await t.db.getMatch('KR_42');
    assert.equal(edited.players[0].position, 'UTILITY');
    assert.equal(edited.players[4].position, 'TOP');

    // 계정 연결
    assert.equal((await fetch(`${t.base}/players/${puuidOf('쌈무')}/link`, form({ _csrf: csrf }))).status, 303);
    assert.match(await (await fetch(`${t.base}/`)).text(), /@개발 모드/);

    // 숨기기 (개발 모드에서는 모두 관리자)
    assert.equal((await fetch(`${t.base}/matches/KR_42/hide`, form({ _csrf: csrf }))).status, 303);
    assert.match(await (await fetch(`${t.base}/`)).text(), /아직 기록된 내전이 없어요/);
    assert.match(await (await fetch(`${t.base}/matches/KR_42`)).text(), /숨긴 내전이에요/);
    assert.match(await (await fetch(`${t.base}/matches?hidden=1`)).text(), /쌈무/);
    await fetch(`${t.base}/matches/KR_42/unhide`, form({ _csrf: csrf }));
    assert.match(await (await fetch(`${t.base}/`)).text(), /쌈무/);

    const nf = await fetch(`${t.base}/no/such/page`);
    assert.equal(nf.status, 404);
    assert.equal((await fetch(`${t.base}/healthz`)).status, 200);
    assert.match(await (await fetch(`${t.base}/robots.txt`)).text(), /Disallow: \//);
    assert.equal((await fetch(`${t.base}/static/style.css`)).status, 200);
    assert.equal((await fetch(`${t.base}/static/nope.css`)).status, 404);
    assert.equal((await fetch(`${t.base}/static/..%2Fpackage.json`)).status, 404);
    const script = await fetch(`${t.base}/collector/collector.mjs`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /떡잎\.gg 수집기/);
  } finally {
    await t.close();
  }
});

function discordMock({ member = true, memberStatus = 200 } = {}) {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    calls.push(String(url));
    const u = String(url);
    if (u.endsWith('/oauth2/token')) {
      assert.equal(new URLSearchParams(String(init.body)).get('code'), 'good-code');
      return Response.json({ access_token: 'at', token_type: 'Bearer' });
    }
    if (u.endsWith('/users/@me')) return Response.json({ id: '777', username: 'ssammu', global_name: '쌈무', avatar: 'av' });
    if (u.includes('/users/@me/guilds/999/member')) {
      return member ? Response.json({ nick: '서버닉', roles: [] }, { status: memberStatus }) : Response.json({ code: 10004 }, { status: 404 });
    }
    throw new Error(`unexpected ${u}`);
  };
  return { fetchMock, calls };
}

const AUTH_ENV = { DISCORD_CLIENT_ID: 'cid', DISCORD_CLIENT_SECRET: 'csecret', DISCORD_GUILD_ID: '999', ADMIN_DISCORD_IDS: '1' };

async function loginFlow(base, next = '/matches') {
  const start = await fetch(`${base}/auth/discord?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
  assert.equal(start.status, 303);
  const location = new URL(start.headers.get('location'));
  assert.equal(location.origin + location.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(location.searchParams.get('client_id'), 'cid');
  assert.equal(location.searchParams.get('redirect_uri'), 'http://tteongnip.test/auth/callback');
  assert.equal(location.searchParams.get('scope'), 'identify guilds.members.read');
  const oauthCookie = start.headers.getSetCookie()[0].split(';')[0];
  const state = location.searchParams.get('state');
  return { oauthCookie, state };
}

test('디스코드 로그인: 멤버만 들어오고, 개인 수집기 키를 받는다', async () => {
  const { fetchMock } = discordMock();
  const t = await startApp(AUTH_ENV, { fetch: fetchMock });
  try {
    const home = await fetch(`${t.base}/`, { redirect: 'manual' });
    assert.equal(home.status, 303);
    assert.equal(home.headers.get('location'), '/login?next=%2F');
    assert.equal((await fetch(`${t.base}/matches/KR_1/hide`, { method: 'POST', redirect: 'manual' })).status, 401);
    const loginHtml = await (await fetch(`${t.base}/login?next=/matches`)).text();
    assert.match(loginHtml, /디스코드로 로그인/);
    assert.match(loginHtml, /\/auth\/discord\?next=%2Fmatches/);

    // state가 다르면 거절
    const { oauthCookie, state } = await loginFlow(t.base);
    const wrong = await fetch(`${t.base}/auth/callback?code=good-code&state=nope`, { headers: { cookie: oauthCookie }, redirect: 'manual' });
    assert.equal(wrong.status, 400);

    const cb = await fetch(`${t.base}/auth/callback?code=good-code&state=${state}`, { headers: { cookie: oauthCookie }, redirect: 'manual' });
    assert.equal(cb.status, 303);
    assert.equal(cb.headers.get('location'), '/matches');
    const session = cb.headers.getSetCookie().find((c) => c.startsWith('tn_session='));
    assert.match(session, /HttpOnly/);
    const cookie = session.split(';')[0];

    const page = await fetch(`${t.base}/`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    assert.match(pageHtml, /서버닉/);
    assert.doesNotMatch(pageHtml, /누구나 볼 수 있어요/);

    // 개인 수집기 파일
    const bat = await fetch(`${t.base}/collector/tteongnip-collector.bat`, { headers: { cookie } });
    assert.equal(bat.status, 200);
    assert.match(bat.headers.get('content-disposition'), /tteongnip-collector\.bat/);
    const batText = await bat.text();
    const key = makeUploadKey('777', 'test-secret');
    assert.ok(batText.includes(`set "TTEONGNIP_KEY=${key}"`));
    assert.ok(batText.includes('set "TTEONGNIP_SERVER=http://tteongnip.test"'));
    assert.ok(batText.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(batText), '배치 파일은 줄바꿈이 CRLF여야 해요');

    const ping = await fetch(`${t.base}/api/collector/ping`, { headers: { authorization: `Bearer ${key}` } });
    assert.deepEqual((await ping.json()).uploader, '서버닉');
    const fake = makeUploadKey('777', 'other-secret');
    assert.equal((await fetch(`${t.base}/api/collector/ping`, { headers: { authorization: `Bearer ${fake}` } })).status, 401);

    const up = await upload(t.base, key, makeLcuGame({ gameId: 77 }));
    assert.equal(up.status, 201);
    assert.match(await (await fetch(`${t.base}/matches/KR_77`, { headers: { cookie } })).text(), /올린 사람 서버닉/);

    // 일반 멤버는 숨기기 불가
    const csrf = csrfToken('777', 'test-secret');
    const hide = await fetch(`${t.base}/matches/KR_77/hide`, { ...form({ _csrf: csrf }), headers: { ...form({}).headers, cookie } });
    assert.equal(hide.status, 403);

    const out = await fetch(`${t.base}/logout`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
    assert.match(out.headers.getSetCookie()[0], /tn_session=;.*Max-Age=0/);
  } finally {
    await t.close();
  }
});

test('디스코드 로그인: 서버 멤버가 아니면 막는다', async () => {
  const { fetchMock } = discordMock({ member: false });
  const t = await startApp(AUTH_ENV, { fetch: fetchMock });
  try {
    const { oauthCookie, state } = await loginFlow(t.base);
    const cb = await fetch(`${t.base}/auth/callback?code=good-code&state=${state}`, { headers: { cookie: oauthCookie }, redirect: 'manual' });
    assert.equal(cb.status, 403);
    assert.match(await cb.text(), /멤버만 들어올 수 있어요/);
    assert.equal(cb.headers.getSetCookie().some((c) => c.startsWith('tn_session=') && !c.startsWith('tn_session=;')), false);
  } finally {
    await t.close();
  }
});

test('다른 사이트 주소로 튕기지 않는다', async () => {
  const { fetchMock } = discordMock();
  const t = await startApp(AUTH_ENV, { fetch: fetchMock });
  try {
    const { oauthCookie, state } = await loginFlow(t.base, '//evil.example');
    const cb = await fetch(`${t.base}/auth/callback?code=good-code&state=${state}`, { headers: { cookie: oauthCookie }, redirect: 'manual' });
    assert.equal(cb.headers.get('location'), '/');
  } finally {
    await t.close();
  }
});

test('오버워치: 업로드, 페이지, 명장면, 계정 연결, 숨기기, 검색, 디스코드 알림', async () => {
  const hooks = [];
  const fakeFetch = async (url, init) => {
    hooks.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  };
  const t = await startApp({ UPLOAD_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://discord.test/hook' }, { fetch: fakeFetch });
  const send = (body) =>
    fetch(`${t.base}/api/collector/overwatch`, { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${t.base}/api/collector/overwatch`, { method: 'POST', body: '{}' })).status, 401);
    const log = makeOwLog({ sleeps: 3 });
    const created = await send({ log, playedAt: Date.UTC(2026, 10, 26, 12) });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.status, 'created');
    assert.match(body.url, /\/ow\/matches\/OW_/);
    assert.deepEqual(body.score, [3, 2]);
    assert.equal((await (await send({ log })).json()).status, 'duplicate');
    const half = await (await send({ log: makeOwLog({ complete: false }) })).json();
    assert.equal(half.status, 'ignored');
    assert.match(half.reason, /끝까지/);

    await t.app.drain();
    assert.equal(hooks.length, 1);
    assert.match(hooks[0].embeds[0].title, /오버워치 내전 · 왕의 길 · 3 : 2/);
    assert.match(hooks[0].embeds[0].description, /아나장인\*\* 수면총으로 3명 재움/);
    assert.match(hooks[0].embeds[0].fields[0].value, /\*\*라인하르트\*\* 라인장인/);

    const rank = await (await fetch(`${t.base}/ow`)).text();
    assert.match(rank, /오버워치 내전 랭킹/);
    assert.match(rank, /아나장인/);
    assert.match(rank, /aria-current="true">오버워치/);
    // 롤 랭킹에는 섞이지 않는다
    assert.match(await (await fetch(`${t.base}/`)).text(), /아직 기록된 내전이 없어요/);

    const id = body.id;
    const matchHtml = await (await fetch(`${t.base}/ow/matches/${id}`)).text();
    assert.match(matchHtml, /명장면 · 흑역사/);
    assert.match(matchHtml, /수면총으로 3명 재움/);
    assert.match(matchHtml, /궁 쓰고 3초 안에 사망/);
    assert.match(matchHtml, /솜브라/);
    // 롤 주소로 들어오면 오버워치 주소로 보낸다
    const wrong = await fetch(`${t.base}/matches/${id}`, { redirect: 'manual' });
    assert.equal(wrong.headers.get('location'), `/ow/matches/${id}`);

    const playerUrl = `${t.base}/ow/players/${encodeURIComponent('아나장인')}`;
    const player = await fetch(playerUrl);
    assert.equal(player.status, 200);
    const playerHtml = await player.text();
    assert.match(playerHtml, /기록실/);
    assert.match(playerHtml, /수면총으로 재운 횟수/);
    assert.match(playerHtml, /판당 3\.0명 재움 · 수면총 명중률 100%/);
    assert.equal((await fetch(`${t.base}/ow/players/${encodeURIComponent('없는사람')}`)).status, 404);
    assert.equal((await fetch(`${t.base}/ow/players/%E0%A4%A`)).status, 404);
    assert.match(await (await fetch(`${t.base}/ow/heroes`)).text(), /라인하르트/);
    assert.match(await (await fetch(`${t.base}/ow/matches`)).text(), /왕의 길/);

    const csrf = csrfToken('dev', 'test-secret');
    assert.equal((await fetch(`${playerUrl}/link`, form({ _csrf: csrf }))).status, 303);
    assert.match(await (await fetch(`${t.base}/ow`)).text(), /@개발 모드/);

    const search = await fetch(`${t.base}/search?q=${encodeURIComponent('아나장')}`, { redirect: 'manual' });
    assert.equal(search.headers.get('location'), `/ow/players/${encodeURIComponent('아나장인')}`);

    const collector = await (await fetch(`${t.base}/collector`)).text();
    assert.match(collector, /오버워치 내전 기록하기/);
    assert.match(collector, /TN,start/);
    const workshop = await fetch(`${t.base}/collector/overwatch-workshop.txt`);
    assert.match(await workshop.text(), /rule\("떡잎\.gg \| 경기 시작"\)/);

    const hide = await fetch(`${t.base}/matches/${id}/hide`, form({ _csrf: csrf }));
    assert.equal(hide.headers.get('location'), `/ow/matches/${id}`);
    assert.match(await (await fetch(`${t.base}/ow`)).text(), /아직 기록된 오버워치 내전이 없어요/);
    assert.match(await (await fetch(`${t.base}/ow/matches?hidden=1`)).text(), /왕의 길/);
  } finally {
    await t.close();
  }
});
