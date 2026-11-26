import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './store.js';

async function sqliteDriver(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  return {
    kind: 'sqlite',
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    all: (sql, params) => db.prepare(sql).all(...params),
    close: () => db.close(),
  };
}

async function postgresDriver(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  // SQLite와 같은 SQL을 쓰기 위해 ? 자리표시자를 $1, $2...로 바꾼다.
  const convert = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  return {
    kind: 'postgres',
    exec: (sql) => pool.query(sql),
    run: async (sql, params) => {
      const r = await pool.query(convert(sql), params);
      return { changes: r.rowCount };
    },
    all: async (sql, params) => (await pool.query(convert(sql), params)).rows,
    close: () => pool.end(),
  };
}

/** DATABASE_URL이 있으면 Postgres, 없으면 dataDir 안의 SQLite 파일을 쓴다. */
export async function openStore({ databaseUrl, dataDir, sqliteFile }) {
  const driver = databaseUrl
    ? await postgresDriver(databaseUrl)
    : await sqliteDriver(sqliteFile || path.join(dataDir || 'data', 'tteongnip.db'));
  const store = createStore(driver);
  await store.init();
  return store;
}
