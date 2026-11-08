import { batchTexts, existingChinese, googleUrl, isJapaneseSong, parseGoogleResponse, prioritize, readable, songKey, trimCache } from './core.mjs';

export class LyricTranslator {
  constructor({ fetch, storage, convert = text => text, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), interval = 1200 }) {
    Object.assign(this, { fetch, storage, convert, now, sleep, interval });
    this.cache = {}; this.generation = 0; this.lastRequest = -Infinity; this.cooldownUntil = 0;
    this.listeners = new Set(); this.current = null; this.disposed = false; this.saveChain = Promise.resolve();
    // Serialize network operations across song changes; in-flight host fetches cannot be aborted.
    this.network = Promise.resolve();
    this.ready = storage.get('translations-v1').then(value => { this.cache = trimCache(value ?? {}); }).catch(() => {});
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this.current); }
  dispose() { this.disposed = true; this.generation++; this.listeners.clear(); }
  cancel() { this.generation++; this.current = null; this.emit(); }
  alive(generation) { return !this.disposed && generation === this.generation; }
  value(line) { return this.current?.translations.get(line.fullText?.trim()) ?? ''; }
  async start(song, lines, getTime, enabled = true, force = false) {
    const key = songKey(song, lines);
    if (!force && this.current?.key === key && this.current.enabled === enabled) return;
    const generation = ++this.generation;
    const translations = new Map(); const origins = new Map();
    for (const line of lines) {
      const original = line.fullText?.trim(); const text = existingChinese(line);
      if (text) { translations.set(original, this.convert(text)); origins.set(original, '現有譯文'); }
    }
    this.current = { key, lines, translations, origins, enabled, status: '讀取翻譯快取', error: '', done: false };
    this.emit();
    await this.ready;
    if (!this.alive(generation)) return;
    for (const entry of this.cache[key]?.entries ?? []) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && readable(entry[1]) && !translations.has(entry[0])) {
        translations.set(entry[0], this.convert(entry[1])); origins.set(entry[0], '快取翻譯');
      }
    }
    const state = this.current;
    if (!enabled || !isJapaneseSong(lines)) {
      state.status = !enabled ? '自動翻譯已關閉' : '未偵測到日文歌詞'; state.done = true; this.emit(); return;
    }
    this.emit();
    let singleOnly = false;
    try {
      while (this.alive(generation)) {
        const missing = prioritize(lines, getTime(), translations);
        if (!missing.length) break;
        // The first uncached line gets its own request; later requests translate short, adjacent sentences.
        const firstRequest = ![...origins.values()].some(x => x === 'Google 翻譯');
        const batch = batchTexts(missing.map(i => lines[i].fullText.trim()), firstRequest || singleOnly ? 1 : 6);
        state.status = `翻譯中 · 已就緒 ${translations.size} 句`; this.emit();
        let results;
        try { results = await this.request(batch, generation); }
        catch (error) {
          if (error.message === '翻譯分行不一致' && batch.length > 1) { singleOnly = true; continue; }
          throw error;
        }
        if (!this.alive(generation)) return;
        batch.forEach((text, i) => { translations.set(text, this.convert(results[i])); origins.set(text, 'Google 翻譯'); });
        state.status = `翻譯中 · 已就緒 ${translations.size} 句`; this.emit();
        await this.save(key, translations);
      }
      if (this.alive(generation)) { state.status = '繁中字幕已就緒'; state.done = true; this.emit(); }
    } catch (error) {
      if (this.alive(generation)) { state.error = error.message; state.status = error.message; state.done = true; this.emit(); }
    }
  }
  async request(batch, generation) {
    const run = async () => {
      if (!this.alive(generation)) throw new Error('已切換歌曲');
      if (this.now() < this.cooldownUntil) throw new Error('Google 暫時限制請求，請稍後重試');
      await this.sleep(Math.max(0, this.interval - (this.now() - this.lastRequest)));
      if (!this.alive(generation)) throw new Error('已切換歌曲');
      this.lastRequest = this.now();
      let response;
      try { response = await this.fetch(googleUrl(batch), { timeoutMs: 15000 }); }
      catch { throw new Error('Google 連線失敗或逾時，可稍後重試'); }
      if (response.status === 429 || response.status === 403) {
        this.cooldownUntil = this.now() + 60000;
        throw new Error('Google 暫時限制請求，請稍後重試');
      }
      if (!response.ok) throw new Error(`Google 翻譯暫時無法使用（HTTP ${response.status}）`);
      let body;
      try { body = await response.json(); } catch { throw new Error('翻譯服務回傳格式已改變'); }
      return parseGoogleResponse(body, batch.length);
    };
    const result = this.network.then(run, run);
    this.network = result.catch(() => {});
    return result;
  }
  async save(key, translations) {
    this.cache[key] = { used: this.now(), entries: [...translations] };
    this.cache = trimCache(this.cache);
    const snapshot = JSON.parse(JSON.stringify(this.cache));
    this.saveChain = this.saveChain.then(() => this.storage.set('translations-v1', snapshot)).catch(() => {
      if (this.current) { this.current.cacheWarning = '無法儲存快取，這次字幕仍可使用'; this.emit(); }
    });
    await this.saveChain;
  }
  async clearCache() {
    await this.saveChain;
    this.cache = {}; await this.storage.set('translations-v1', {});
  }
}
