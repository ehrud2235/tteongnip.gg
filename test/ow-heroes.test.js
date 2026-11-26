import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwHeroes, heroSlug } from '../src/ow-heroes.js';
import { makeOwLog, startApp } from './helpers.js';

const quiet = { warn() {} };
const API_EN = [
  { key: 'ana', name: 'Ana', role: 'support', portrait: 'https://img.test/ana.png' },
  { key: 'soldier-76', name: 'Soldier: 76', role: 'damage', portrait: 'https://img.test/soldier.png' },
  { key: 'reinhardt', name: 'Reinhardt', role: 'tank', portrait: 'https://img.test/rein.png' },
  { key: 'newhero', name: 'New Hero', role: 'damage', portrait: 'https://img.test/new.png' },
];
const API_KO = [
  { key: 'ana', name: '아나' },
  { key: 'newhero', name: '새영웅' },
];

test('영웅 이름(한국어/영어)으로 얼굴 이미지를 찾는다', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    return Response.json(url.includes('ko-kr') ? API_KO : API_EN);
  };
  const h = createOwHeroes({ fetch, log: quiet });
  await h.start();
  h.stop();
  assert.ok(calls.some((u) => u.includes('locale=en-us')));
  assert.equal(h.portrait('아나'), 'https://img.test/ana.png');
  assert.equal(h.portrait('Ana'), 'https://img.test/ana.png');
  assert.equal(h.portrait('솔저: 76'), 'https://img.test/soldier.png'); // 한국어 목록에 없어도 영어 이름으로 찾는다
  assert.equal(h.portrait('라인하르트'), 'https://img.test/rein.png');
  assert.equal(h.portrait('새영웅'), 'https://img.test/new.png'); // 표에 없는 새 영웅도 API 한국어 이름으로
  assert.equal(h.portrait('없는영웅'), null);
  assert.equal(heroSlug('D.Va'), 'dva');
  assert.equal(heroSlug('Torbjörn'), 'torbjorn');
  assert.equal(heroSlug('Wrecking Ball'), 'wrecking-ball');
});

test('영웅 목록을 못 받아오면 이름 글자로 보여준다', async () => {
  const h = createOwHeroes({ fetch: async () => { throw new Error('offline'); }, log: quiet });
  await h.start();
  h.stop();
  assert.equal(h.portrait('아나'), null);
});

test('오버워치 화면에 영웅 얼굴이 나온다', async () => {
  const t = await startApp({ UPLOAD_KEY: 'k' });
  try {
    const owh = createOwHeroes({ fetch: async (url) => Response.json(url.includes('ko-kr') ? API_KO : API_EN), log: quiet });
    await owh.start();
    owh.stop();
    // 테스트 서버의 영웅 이미지 제공자를 바꿔 끼운다
    t.setOwHeroes(owh);
    const r = await fetch(`${t.base}/api/collector/overwatch`, {
      method: 'POST',
      headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
      body: JSON.stringify({ log: makeOwLog() }),
    });
    const { id } = await r.json();
    const matchHtml = await (await fetch(`${t.base}/ow/matches/${id}`)).text();
    assert.match(matchHtml, /<img class="hi " src="https:\/\/img\.test\/ana\.png" alt="아나"/);
    assert.match(matchHtml, /<span class="hero-main">겐지<\/span>/); // 이미지 모르는 영웅은 이름만
    const rank = await (await fetch(`${t.base}/ow`)).text();
    assert.match(rank, /img\.test\/rein\.png/);
  } finally {
    await t.close();
  }
});
