import test from 'node:test';
import assert from 'node:assert/strict';
import { LyricTranslator } from '../translator.mjs';
import { Converter } from '../vendor/opencc-cn2t.mjs';

const song = { title: '測試曲', artist: '測試者' };
const lines = ['朝が来ます', '風が吹きます', '明日へ歩きます', '風が吹きます'].map((fullText, i) => ({ fullText, startTime: i * 5, endTime: i * 5 + 4 }));
function harness(fetchOverride) {
  const calls = []; const saved = {}; let clock = 0;
  const translator = new LyricTranslator({
    fetch: async (url, options) => { const q = new URL(url).searchParams.get('q'); calls.push(q); return fetchOverride ? fetchOverride(q, calls.length) : { ok: true, status: 200, json: () => [[ [q.split('\n').map(x => `譯文：${x.replace(/[\u3040-\u30ff]/g, '')}`).join('\n')] ]] }; },
    storage: { get: async k => saved[k], set: async (k, v) => { saved[k] = structuredClone(v); } },
    now: () => clock, sleep: async ms => { clock += ms; }, interval: 1200,
    convert: Converter({ from: 'cn', to: 'tw' }),
  });
  return { translator, calls, saved };
}
test('current line translates first, repeated chorus deduplicates, replay uses cache', async () => {
  const { translator: t, calls } = harness();
  await t.start(song, lines, () => 6);
  assert.equal(calls[0], '風が吹きます');
  assert.equal(calls.length, 2);
  assert.equal(t.current.translations.size, 3);
  t.cancel(); await t.start(song, lines, () => 0);
  assert.equal(calls.length, 2);
  assert.equal(t.current.status, '繁中字幕已就緒');
});
test('existing simplified Chinese converts locally; opt-out sends no request', async () => {
  const { translator: t, calls } = harness();
  await t.start(song, [{ ...lines[0], translation: '风吹过后，云开了' }], () => 0, false);
  assert.equal(t.value(lines[0]), '風吹過後，雲開了');
  assert.equal(calls.length, 0);
});
test('songs without kana are not sent automatically', async () => {
  const { translator: t, calls } = harness();
  await t.start(song, [{ fullText: 'Hello world', startTime: 0, endTime: 4 }], () => 0);
  assert.equal(calls.length, 0);
});
test('in-flight old song result cannot overwrite the new song', async () => {
  let release; let called;
  const begun = new Promise(r => { called = r; });
  const { translator: t, calls } = harness(async (_q, count) => {
    if (count === 1) { called(); return new Promise(r => { release = r; }); }
    return { ok: true, status: 200, json: () => [[['新曲中文']]] };
  });
  const old = t.start(song, [lines[0]], () => 0); await begun;
  const next = t.start({ title: '另一首' }, [lines[1]], () => 0);
  release({ ok: true, status: 200, json: () => [[['舊曲中文']]] });
  await Promise.all([old, next]);
  assert.equal(t.value(lines[1]), '新曲中文');
  assert.equal(t.current.translations.has(lines[0].fullText), false);
  assert.equal(calls.length, 2);
});
test('429 stops the queue and immediate retry is blocked by cooldown', async () => {
  const { translator: t, calls } = harness(async () => ({ ok: false, status: 429 }));
  await t.start(song, lines, () => 0);
  assert.match(t.current.error, /限制請求/); assert.equal(calls.length, 1);
  await t.start(song, lines, () => 0, true, true);
  assert.equal(calls.length, 1);
});
test('bad batch alignment falls back to single lines with bounded requests', async () => {
  const { translator: t, calls } = harness(async () => ({ ok: true, status: 200, json: () => [[['這是一句譯文']]] }));
  await t.start(song, lines, () => 0);
  assert.equal(calls.length, 4);
  assert.equal(t.current.translations.size, 3);
  assert.equal(t.current.error, '');
});
test('network failure is visible and does not remove existing translations', async () => {
  const { translator: t, calls } = harness(async () => { throw new Error('offline'); });
  await t.start(song, [{ ...lines[0], translation: '早晨來了' }, lines[1]], () => 0);
  assert.match(t.current.error, /連線/); assert.equal(t.value(lines[0]), '早晨來了'); assert.equal(calls.length, 1);
});
test('disabling during fetch discards the response and does not schedule more', async () => {
  let release; let called;
  const begun = new Promise(r => { called = r; });
  const { translator: t, calls } = harness(async () => { called(); return new Promise(r => { release = r; }); });
  const run = t.start(song, lines, () => 0); await begun;
  await t.start(song, lines, () => 0, false);
  release({ ok: true, status: 200, json: () => [[['不該顯示']]] }); await run;
  assert.equal(calls.length, 1); assert.equal(t.current.translations.size, 0);
});
