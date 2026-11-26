// 저장소: SQLite(파일 하나, 내 PC나 디스크가 있는 서버용)와 Postgres(무료 클라우드 DB용)가 같은 코드를 쓴다.
// 드라이버는 run(sql, params) -> { changes }, all(sql, params) -> rows, exec(sql), close() 만 있으면 된다.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    uploaded_at BIGINT NOT NULL,
    uploaded_by TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    raw TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS matches_created_at ON matches (created_at)`,
  `CREATE TABLE IF NOT EXISTS members (
    discord_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT,
    last_login BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS links (
    puuid TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    linked_at BIGINT NOT NULL
  )`,
];

const MATCH_COLUMNS = 'id, created_at, uploaded_at, uploaded_by, hidden, data';

function toMatch(row) {
  const data = JSON.parse(row.data);
  data.meta = {
    hidden: Number(row.hidden) === 1,
    uploadedBy: row.uploaded_by || null,
    uploadedAt: Number(row.uploaded_at),
  };
  return data;
}

function stripMeta(match) {
  const { meta, ...data } = match;
  return data;
}

export function createStore(driver) {
  return {
    kind: driver.kind,

    async init() {
      for (const sql of SCHEMA) await driver.exec(sql);
    },

    /** @returns {'created' | 'duplicate'} */
    async insertMatch({ match, raw, uploadedBy }) {
      const r = await driver.run(
        `INSERT INTO matches (id, created_at, uploaded_at, uploaded_by, hidden, data, raw)
         VALUES (?, ?, ?, ?, 0, ?, ?) ON CONFLICT (id) DO NOTHING`,
        [match.id, match.createdAt, Date.now(), uploadedBy ?? null, JSON.stringify(stripMeta(match)), raw == null ? null : JSON.stringify(raw)],
      );
      return r.changes > 0 ? 'created' : 'duplicate';
    },

    async listMatches({ includeHidden = false } = {}) {
      const rows = await driver.all(
        `SELECT ${MATCH_COLUMNS} FROM matches ${includeHidden ? '' : 'WHERE hidden = 0'} ORDER BY created_at DESC`,
        [],
      );
      return rows.map(toMatch);
    },

    async getMatch(id) {
      const rows = await driver.all(`SELECT ${MATCH_COLUMNS} FROM matches WHERE id = ?`, [id]);
      return rows.length ? toMatch(rows[0]) : null;
    },

    async getRaw(id) {
      const rows = await driver.all('SELECT raw FROM matches WHERE id = ?', [id]);
      return rows.length && rows[0].raw ? JSON.parse(rows[0].raw) : null;
    },

    async updateMatch(match) {
      await driver.run('UPDATE matches SET data = ? WHERE id = ?', [JSON.stringify(stripMeta(match)), match.id]);
    },

    async setHidden(id, hidden) {
      const r = await driver.run('UPDATE matches SET hidden = ? WHERE id = ?', [hidden ? 1 : 0, id]);
      return r.changes > 0;
    },

    async upsertMember({ discordId, name, avatar }) {
      await driver.run(
        `INSERT INTO members (discord_id, name, avatar, last_login) VALUES (?, ?, ?, ?)
         ON CONFLICT (discord_id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, last_login = excluded.last_login`,
        [discordId, name, avatar ?? null, Date.now()],
      );
    },

    async listMembers() {
      const rows = await driver.all('SELECT discord_id, name, avatar, last_login FROM members', []);
      return rows.map((r) => ({ discordId: r.discord_id, name: r.name, avatar: r.avatar, lastLogin: Number(r.last_login) }));
    },

    async setLink(puuid, discordId) {
      await driver.run(
        `INSERT INTO links (puuid, discord_id, linked_at) VALUES (?, ?, ?)
         ON CONFLICT (puuid) DO UPDATE SET discord_id = excluded.discord_id, linked_at = excluded.linked_at`,
        [puuid, discordId, Date.now()],
      );
    },

    async removeLink(puuid) {
      await driver.run('DELETE FROM links WHERE puuid = ?', [puuid]);
    },

    async listLinks() {
      const rows = await driver.all('SELECT puuid, discord_id, linked_at FROM links', []);
      return rows.map((r) => ({ puuid: r.puuid, discordId: r.discord_id, linkedAt: Number(r.linked_at) }));
    },

    async close() {
      await driver.close();
    },
  };
}
