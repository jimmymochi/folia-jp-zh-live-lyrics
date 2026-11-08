import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountLyrics } from '../view.mjs';
import { songKey } from '../core.mjs';

test('DOM subtitles follow pause, backward seek, visibility and cleanup without HTML injection', () => {
  const dom = new JSDOM('<main></main>'); const root = dom.window.document.querySelector('main');
  const song = { title: '<script>alert(1)</script>' };
  const lines = [{ fullText: '風が吹く', startTime: 10, endTime: 14, words: [{ text: '風が', startTime: 10, endTime: 12 }, { text: '吹く', startTime: 12, endTime: 14 }] }];
  let time = 12, show = true; const hooks = new Set();
  const subscribe = fn => { hooks.add(fn); return () => hooks.delete(fn); };
  const key = songKey(song, lines);
  const translator = { current: { lines, key, origins: new Map([['風が吹く', 'Google 翻譯']]) }, value: () => '微風吹來', subscribe };
  const context = { lines, song, translationKey: key, lyricTime: { get: () => time }, getLineIndex: () => 0,
    getDisplay: () => ({ showText: show }), getDuration: () => 20, onLyricTime: subscribe, onChange: subscribe };
  const prefs = { get: () => ({ highlight: true, fontScale: 1 }), onChange: subscribe };
  const dispose = mountLyrics(root, context, translator, prefs);
  let spans = root.querySelectorAll('.jpzh-chinese span');
  assert.equal(spans.length, 4);
  assert.equal(spans[0].style.getPropertyValue('--p'), '100.0%');
  assert.equal(spans[2].style.getPropertyValue('--p'), '0.0%');
  for (const fn of hooks) fn(); // unchanged clock = paused
  assert.equal(spans[0].style.getPropertyValue('--p'), '100.0%');
  time = 10; for (const fn of hooks) fn();
  spans = root.querySelectorAll('.jpzh-chinese span');
  assert.equal(spans[0].style.getPropertyValue('--p'), '0.0%');
  assert.equal(root.querySelector('script'), null);
  show = false; for (const fn of hooks) fn();
  assert.equal(root.querySelector('.jpzh').style.display, 'none');
  dispose(); assert.equal(hooks.size, 0); assert.equal(root.childNodes.length, 0);
});
