import test from 'node:test';
import assert from 'node:assert/strict';
import { batchTexts, existingChinese, graphemes, googleUrl, lineProgress, parseGoogleResponse, prioritize, songKey, trimCache, wordProgress } from '../core.mjs';

test('translation selection rejects Japanese and repeated original, accepts alternate Chinese', () => {
  assert.equal(existingChinese({ fullText: '風が吹く', translation: '風が吹く', alternateTexts: [{ role: 'translation', text: '風吹過來' }] }), '風吹過來');
  assert.equal(existingChinese({ fullText: '花', translation: '花' }), '');
});
test('progress follows pause/seek, respects word timing and recovers missing line end', () => {
  const line = { startTime: 10, endTime: 14 };
  assert.equal(lineProgress(line, 12), .5);
  assert.equal(lineProgress(line, 12), .5);
  assert.equal(lineProgress(line, 9), 0);
  assert.equal(lineProgress(line, 99), 1);
  assert.equal(lineProgress({ startTime: 10 }, 12, { startTime: 18 }), .25);
  assert.equal(wordProgress({ startTime: 10, endTime: 11 }, line, 10.5), .5);
});
test('current and upcoming lines precede old lines; repeats/cache are skipped', () => {
  const lines = ['a', 'b', 'c', 'b'].map((fullText, i) => ({ fullText, startTime: i * 5, endTime: i * 5 + 4 }));
  assert.deepEqual(prioritize(lines, 6, new Map()), [1, 2, 0]);
  assert.deepEqual(prioritize(lines, 6, new Map([['b', '譯文']])), [2, 0]);
});
test('batch response cannot silently shift translation rows', () => {
  assert.deepEqual(parseGoogleResponse([[['第一行\n第二行\n']]], 2), ['第一行', '第二行']);
  assert.throws(() => parseGoogleResponse([[['合併一行']]], 2), /分行/);
  assert.throws(() => parseGoogleResponse({ error: 'invalid' }, 1), /格式/);
  assert.equal(batchTexts(Array(10).fill('こんにちは')).length, 6);
  assert.throws(() => batchTexts(['あ'.repeat(500)]), /過長/);
});
test('query encodes punctuation literally and normalizes embedded newlines', () => {
  const url = new URL(googleUrl(['あ&b?\nc', '次の行']));
  assert.equal(url.hostname, 'translate.googleapis.com');
  assert.equal(url.searchParams.get('q'), 'あ&b? c\n次の行');
  assert.equal(url.searchParams.get('tl'), 'zh-TW');
});
test('cache isolates different songs and stays under byte budget', () => {
  const lines = [{ fullText: '明日へ' }];
  assert.equal(songKey({ title: 'a', ref: '1' }, lines), songKey({ title: 'a', ref: '2' }, lines));
  assert.notEqual(songKey({ title: 'a' }, lines), songKey({ title: 'b' }, lines));
  const value = trimCache({ a: { used: 1, entries: [['a', '甲']] }, b: { used: 2, entries: [['b', '乙']] } }, 1000, 1);
  assert.deepEqual(Object.keys(value), ['b']);
  assert.deepEqual(graphemes('風👨‍👩‍👧‍👦あ\u3099'), ['風', '👨‍👩‍👧‍👦', 'あ\u3099']);
});
