// 워크샵 스크립트: 오버워치에 붙여넣기 전에 잡을 수 있는 실수(괄호, 중괄호, 따옴표)를 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text = fs.readFileSync(new URL('../overwatch/workshop.txt', import.meta.url), 'utf8');

test('워크샵 스크립트: 줄마다 괄호와 따옴표 짝이 맞는다', () => {
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/"[^"]*"/g, '""'); // 문자열 안의 괄호는 빼고 센다
    let depth = 0;
    for (const ch of code) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      assert.ok(depth >= 0, `${i + 1}번째 줄: 닫는 괄호가 먼저 나와요`);
    }
    assert.equal(depth, 0, `${i + 1}번째 줄: 괄호 짝이 안 맞아요`);
    assert.equal((line.match(/"/g) || []).length % 2, 0, `${i + 1}번째 줄: 따옴표 짝이 안 맞아요`);
  });
});

test('워크샵 스크립트: 중괄호 짝이 맞고, 액션은 세미콜론으로 끝난다', () => {
  const code = text.replace(/"[^"]*"/g, '""'); // 문자열 안의 {0} 같은 건 빼고 센다
  assert.equal((code.match(/{/g) || []).length, (code.match(/}/g) || []).length);
  for (const block of code.matchAll(/actions\s*{([^}]*)}/g)) {
    for (const line of block[1].split('\n').map((l) => l.trim()).filter(Boolean)) {
      assert.ok(line.endsWith(';'), `세미콜론 없음: ${line.slice(0, 60)}`);
    }
  }
});

test('워크샵 스크립트: 서버가 읽는 기록 종류를 모두 남긴다', () => {
  for (const kind of ['start', 'hero', 'kill', 'ult', 'ab1', 'ab2', 'asleep', 'stat', 'end']) {
    assert.ok(text.includes(`"TN,${kind},`), `TN,${kind} 기록이 없어요`);
  }
});
