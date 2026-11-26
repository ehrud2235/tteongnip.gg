// 오버워치 영웅 얼굴 이미지. 블리자드는 공식 이미지 서버가 없어서, 영웅 목록과 얼굴 이미지 주소를 주는
// 공개 API(OverFast, 블리자드 사이트 정보를 모아서 제공)를 쓴다. 받아오지 못하면 영웅 이름 글자로 대신 보여준다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { heroEnglish } from './overwatch.js';

const API = 'https://overfast-api.tekrop.fr/heroes';
const REFRESH_MS = 12 * 60 * 60 * 1000;

const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, '');

/** 영어 이름 → API 영웅 키 ("Soldier: 76" → "soldier-76", "D.Va" → "dva", "Torbjörn" → "torbjorn") */
export function heroSlug(en) {
  return String(en || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.:']/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function createOwHeroes({ fetch = globalThis.fetch, cacheDir = null, log = console } = {}) {
  let data = { byKey: {}, byName: {} };
  let timer = null;
  let loading = null;
  const cacheFile = cacheDir ? path.join(cacheDir, 'ow-heroes-cache.json') : null;

  const getList = async (locale) => {
    const res = await fetch(`${API}?locale=${locale}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('영웅 목록 형식이 달라요');
    return list;
  };

  async function download() {
    const next = { byKey: {}, byName: {} };
    for (const h of await getList('en-us')) {
      if (!h?.key) continue;
      next.byKey[h.key] = { portrait: typeof h.portrait === 'string' ? h.portrait : null };
      if (h.name) next.byName[norm(h.name)] = h.key;
    }
    try {
      for (const h of await getList('ko-kr')) if (h?.key && h.name) next.byName[norm(h.name)] = h.key;
    } catch {}
    if (!Object.keys(next.byKey).length) throw new Error('영웅 목록이 비어 있어요');
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
      log.warn?.(`[ow-heroes] 영웅 이미지 목록을 받아오지 못했어요: ${err.message}`);
      if (cacheFile && !Object.keys(data.byKey).length) {
        try {
          data = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
        } catch {}
      }
    }
  }

  return {
    start() {
      loading = load();
      timer = setInterval(() => (loading = load()), REFRESH_MS);
      timer.unref?.();
      return loading;
    },
    stop() {
      clearInterval(timer);
    },
    /** 한국어/영어 영웅 이름으로 얼굴 이미지 주소를 찾는다. 없으면 null */
    portrait(name) {
      const en = heroEnglish(name);
      const key = data.byName[norm(name)] || (en && data.byName[norm(en)]) || heroSlug(en || name);
      return data.byKey[key]?.portrait || null;
    },
    /** 테스트용 */
    _set(next) {
      data = next;
    },
  };
}
