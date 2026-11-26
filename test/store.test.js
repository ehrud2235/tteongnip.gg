// 저장소 동작 확인. Postgres도 확인하려면 TEST_DATABASE_URL을 넣고 실행한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/db/index.js';
import { normalizeGame } from '../src/game.js';
import { makeLcuGame } from './helpers.js';

const targets = [['sqlite', { sqliteFile: ':memory:' }]];
if (process.env.TEST_DATABASE_URL) targets.push(['postgres', { databaseUrl: process.env.TEST_DATABASE_URL }]);

for (const [name, opts] of targets) {
  test(`${name}: 경기 저장, 중복 무시, 숨기기, 계정 연결`, async () => {
    const db = await openStore(opts);
    try {
      const raw = makeLcuGame({ gameId: 555 });
      const match = normalizeGame(raw).match;
      const id = match.id;
      // Postgres 테스트 DB는 여러 번 돌릴 수 있어서 첫 저장이 중복일 수도 있다
      await db.setHidden(id, false);

      const first = await db.insertMatch({ match, raw, uploadedBy: '111' });
      const second = await db.insertMatch({ match, raw, uploadedBy: '111' });
      if (name === 'sqlite') assert.equal(first, 'created');
      assert.equal(second, 'duplicate');

      const list = await db.listMatches();
      const got = list.find((m) => m.id === id);
      assert.ok(got);
      assert.equal(got.players.length, 10);
      assert.equal(got.meta.uploadedBy, '111');
      assert.equal(got.meta.hidden, false);
      assert.equal(typeof got.meta.uploadedAt, 'number');
      assert.deepEqual((await db.getRaw(id)).gameId, 555);

      got.players[0].position = 'MIDDLE';
      await db.updateMatch(got);
      assert.equal((await db.getMatch(id)).players[0].position, 'MIDDLE');

      assert.equal(await db.setHidden(id, true), true);
      assert.equal((await db.listMatches()).some((m) => m.id === id), false);
      assert.equal((await db.listMatches({ includeHidden: true })).some((m) => m.id === id), true);
      assert.equal((await db.getMatch(id)).meta.hidden, true);
      assert.equal(await db.setHidden('nope', true), false);
      await db.setHidden(id, false);

      await db.upsertMember({ discordId: '111', name: '첫이름', avatar: null });
      await db.upsertMember({ discordId: '111', name: '새이름', avatar: 'abc' });
      const member = (await db.listMembers()).find((m) => m.discordId === '111');
      assert.equal(member.name, '새이름');
      assert.equal(member.avatar, 'abc');

      await db.setLink('p1', '111');
      await db.setLink('p1', '222');
      assert.equal((await db.listLinks()).find((l) => l.puuid === 'p1').discordId, '222');
      await db.removeLink('p1');
      assert.equal((await db.listLinks()).some((l) => l.puuid === 'p1'), false);
      assert.equal(await db.getMatch('없음'), null);
    } finally {
      await db.close();
    }
  });
}
