import assert from 'node:assert/strict';
import { LyricTranslator } from '../translator.mjs';
const lines = ['今日は青い空を見上げています。', '窓のそばに白い花があります。', '明日は駅で友達に会います。'].map((fullText, i) => ({ fullText, startTime: i * 5, endTime: i * 5 + 4 }));
let requests = 0;
const engine = new LyricTranslator({
  fetch: async (url, init) => { requests++; return fetch(url, { signal: AbortSignal.timeout(init.timeoutMs) }); },
  storage: { get: async () => ({}), set: async () => {} },
});
await engine.start({ title: '原創測試短句' }, lines, () => 0);
assert.equal(engine.current.error, '');
assert.equal(engine.current.translations.size, 3);
assert.ok([...engine.current.translations.values()].every(x => /\p{Script=Han}/u.test(x)));
console.log(JSON.stringify({ requests, translations: [...engine.current.translations.values()], status: engine.current.status }, null, 2));
