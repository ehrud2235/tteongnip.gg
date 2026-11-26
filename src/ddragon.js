// 챔피언·아이템·스펠·룬 이름과 아이콘 (라이엇 공개 데이터 Data Dragon).
// 받아오지 못해도 사이트는 돌아가야 하므로, 실패하면 마지막으로 저장한 값이나 번호로 대신 보여준다.
import fs from 'node:fs/promises';
import path from 'node:path';

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CDRAGON_CHAMP = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons';
const FALLBACK_VERSION = '14.24.1';
const REFRESH_MS = 12 * 60 * 60 * 1000;

export function createDDragon({ fetch = globalThis.fetch, cacheDir = null, log = console } = {}) {
  let data = { version: FALLBACK_VERSION, champions: {}, items: {}, spells: {}, runes: {} };
  let loading = null;
  let timer = null;
  const cacheFile = cacheDir ? path.join(cacheDir, 'ddragon-cache.json') : null;

  const getJson = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  };

  async function download() {
    const [version] = await getJson(`${DDRAGON}/api/versions.json`);
    const base = `${DDRAGON}/cdn/${version}/data/ko_KR`;
    const [champ, item, spell, runes] = await Promise.all([
      getJson(`${base}/champion.json`),
      getJson(`${base}/item.json`),
      getJson(`${base}/summoner.json`),
      getJson(`${base}/runesReforged.json`),
    ]);
    const next = { version, champions: {}, items: {}, spells: {}, runes: {} };
    for (const c of Object.values(champ.data)) next.champions[c.key] = { id: c.id, name: c.name, tags: c.tags || [] };
    for (const [id, it] of Object.entries(item.data)) next.items[id] = it.name;
    for (const s of Object.values(spell.data)) next.spells[s.key] = { id: s.id, name: s.name };
    for (const style of runes) {
      next.runes[style.id] = { name: style.name, icon: style.icon };
      for (const slot of style.slots || []) for (const r of slot.runes || []) next.runes[r.id] = { name: r.name, icon: r.icon };
    }
    return next;
  }

  async function load() {
    try {
      data = await download();
      if (cacheFile) {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify(data));
      }
    } catch (err) {
      log.warn?.(`[ddragon] 챔피언 정보를 받아오지 못했어요: ${err.message}`);
      if (cacheFile && !Object.keys(data.champions).length) {
        try {
          data = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
        } catch {}
      }
    }
  }

  return {
    /** 처음 한 번 받아오고, 12시간마다 새로 받는다. */
    start() {
      loading = load();
      timer = setInterval(() => (loading = load()), REFRESH_MS);
      timer.unref?.();
      return loading;
    },
    stop() {
      clearInterval(timer);
    },
    ready: () => loading,
    get version() {
      return data.version;
    },
    champion(id) {
      const c = data.champions[id];
      return {
        name: c ? c.name : `챔피언 ${id}`,
        icon: c ? `${DDRAGON}/cdn/${data.version}/img/champion/${c.id}.png` : `${CDRAGON_CHAMP}/${id}.png`,
      };
    },
    championTags(id) {
      return data.champions[id]?.tags || [];
    },
    item(id) {
      if (!id) return null;
      return { name: data.items[id] || `아이템 ${id}`, icon: `${DDRAGON}/cdn/${data.version}/img/item/${id}.png` };
    },
    spell(id) {
      const s = data.spells[id];
      return s ? { name: s.name, icon: `${DDRAGON}/cdn/${data.version}/img/spell/${s.id}.png` } : null;
    },
    rune(id) {
      const r = data.runes[id];
      return r ? { name: r.name, icon: `${DDRAGON}/cdn/img/${r.icon}` } : null;
    },
    /** 테스트용 */
    _set(next) {
      data = { ...data, ...next };
    },
  };
}
