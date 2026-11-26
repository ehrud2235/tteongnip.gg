import http from 'node:http';
import { loadConfig } from './config.js';
import { openStore } from './db/index.js';
import { createDDragon } from './ddragon.js';
import { createApp } from './app.js';

const config = loadConfig();
for (const w of config.warnings) console.warn(`[설정] ${w}`);

const db = await openStore(config);
const ddragon = createDDragon({ cacheDir: config.dataDir });
ddragon.start();
const app = createApp({ config, db, ddragon });

const server = http.createServer((req, res) => app.handle(req, res));
server.listen(config.port, () => {
  console.log(`${config.siteName} 실행 중: ${config.baseUrl} (저장소: ${db.kind})`);
  if (config.authEnabled) {
    console.log(`디스코드 OAuth2 Redirects에 이 주소를 그대로 등록하세요: ${config.baseUrl}/auth/callback`);
  }
});

async function shutdown() {
  server.close();
  ddragon.stop();
  await app.drain();
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
