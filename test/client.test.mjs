import test from 'node:test';
import assert from 'node:assert/strict';
import activate from '../client.mjs';

function makeHost(context = 'main') {
  const definitions = {}; const registered = new Set(); const listeners = new Map(); const data = new Map();
  let network = 0; let mode = 'monet';
  const register = kind => def => {
    definitions[`${kind}:${def.id}`] = def; registered.add(`${kind}:${def.id}`);
    const values = Object.fromEntries((def.settings ?? []).map(s => [s.key, s.defaultValue]));
    return { unregister() { registered.delete(`${kind}:${def.id}`); }, settings: { get: () => values, onChange: () => () => {} } };
  };
  const host = {
    modId: 'jp-zh-live-lyrics', env: { context }, host: { folium: { major: 1, minor: 8 }, folia: '0.7.27' },
    registries: Object.fromEntries(['settingsSections', 'visualizers', 'commands'].map(k => [k, { register: register(k) }])),
    storage: { get: async key => data.get(key), set: async (key, value) => { data.set(key, value); } },
    net: { fetch: async () => { network++; throw new Error('unexpected network'); } },
    playback: { getState: () => ({ song: null, position: 0 }) }, lyrics: { getLines: () => [] },
    events: { on: (event, fn) => { listeners.set(event, fn); return () => listeners.delete(event); } },
    visualizer: { getMode: () => mode, setMode: next => { mode = next; return { status: 'applied' }; } },
    log: { warn() {} },
  };
  return { host, definitions, registered, listeners, data, getMode: () => mode, getNetwork: () => network };
}
test('client installs the mode once and removes registrations/listeners on disable', async () => {
  const h = makeHost(); const dispose = activate(h.host);
  await new Promise(r => setImmediate(r));
  assert.equal(h.getMode(), 'mod:jp-zh-live-lyrics:bilingual');
  assert.equal(h.definitions['visualizers:bilingual'].hostLayers.subtitles, false);
  assert.equal(h.data.get('mode-initialized'), true);
  assert.equal(h.getNetwork(), 0);
  dispose(); assert.equal(h.getMode(), 'monet'); assert.equal(h.registered.size, 0); assert.equal(h.listeners.size, 0);
  h.host.visualizer.setMode('pendolo'); const stop = activate(h.host);
  await new Promise(r => setImmediate(r)); assert.equal(h.getMode(), 'pendolo'); stop();
});
test('export context registers rendering but does not start requests or change mode', async () => {
  const h = makeHost('export'); const dispose = activate(h.host);
  await new Promise(r => setImmediate(r));
  assert.equal(h.getMode(), 'monet'); assert.equal(h.getNetwork(), 0); assert.equal(h.listeners.size, 0); dispose();
});

test('all registry labels follow Folium locale-map contract and render Chinese', () => {
  const h = makeHost(); const dispose = activate(h.host);
  for (const def of Object.values(h.definitions)) {
    for (const item of [def, ...(def.settings ?? [])]) {
      for (const key of ['label', 'description']) {
        if (item[key] === undefined) continue;
        assert.equal(typeof item[key], 'object', `${def.id}.${key} must be a locale map`);
        for (const locale of ['zh-CN', 'zh-TW', 'en']) {
          assert.match(item[key][locale], /\p{Script=Han}/u, `${def.id}.${key}.${locale}`);
        }
      }
    }
  }
  dispose();
});
