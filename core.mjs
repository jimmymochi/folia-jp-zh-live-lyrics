// Original implementation for this mod. Folium's lyric clock is in seconds.
// https://github.com/chthollyphile/folia-major/blob/main/src/mods/folium/contract.ts
export const readable = text => typeof text === 'string' && /[\p{L}\p{N}]/u.test(text);
export const hasKana = text => /[\u3041-\u3096\u30a1-\u30fa]/u.test(text ?? '');
export const isJapaneseSong = lines => lines.some(line => hasKana(line.fullText));
export const clamp = n => Math.max(0, Math.min(1, n));
export const graphemes = text => [...new Intl.Segmenter('zh-TW', { granularity: 'grapheme' }).segment(text)].map(x => x.segment);

export function existingChinese(line) {
  const choices = [line.translation, ...(line.alternateTexts ?? []).filter(x => x.role === 'translation').map(x => x.text)];
  return choices.find(text => typeof text === 'string' && text.trim() !== line.fullText?.trim()
    && /\p{Script=Han}/u.test(text) && !hasKana(text))?.trim() ?? '';
}

export function songKey(song, lines) {
  // Stable across Folium session refs; timings excluded because the cache stores text only.
  const text = JSON.stringify([song?.title, song?.artist, lines.map(x => x.fullText)]);
  let hash = 14695981039346656037n;
  for (const char of text) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0))) * 1099511628211n);
  return hash.toString(16);
}

export function validEnd(line, next, duration = 0) {
  if (Number.isFinite(line.endTime) && line.endTime > line.startTime) return line.endTime;
  if (Number.isFinite(next?.startTime) && next.startTime > line.startTime) return next.startTime;
  if (duration > line.startTime) return Math.min(duration, line.startTime + 12);
  return line.startTime + 5;
}

export function lineProgress(line, time, next, duration) {
  return clamp((time - line.startTime) / Math.max(0.05, validEnd(line, next, duration) - line.startTime));
}

export function wordProgress(word, line, time, next, duration) {
  if (Number.isFinite(word.startTime) && Number.isFinite(word.endTime) && word.endTime > word.startTime) {
    return clamp((time - word.startTime) / (word.endTime - word.startTime));
  }
  return lineProgress(line, time, next, duration);
}

export function prioritize(lines, time, translated) {
  let first = lines.findIndex((line, i) => validEnd(line, lines[i + 1]) > time);
  if (first < 0) first = 0;
  const indices = [...lines.keys()];
  const ordered = [...indices.slice(first), ...indices.slice(0, first)];
  const seen = new Set();
  return ordered.filter(i => {
    const text = lines[i].fullText?.trim();
    if (!readable(text) || translated.has(text) || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

export function batchTexts(texts, limit = 6, maxEncoded = 3500) {
  const batch = [];
  for (const text of texts) {
    if (batch.length >= limit || encodeURIComponent([...batch, text].join('\n')).length > maxEncoded) break;
    batch.push(text);
  }
  // Exceptionally long source lines are rejected explicitly, never silently truncated.
  if (!batch.length && texts.length) throw new Error('歌詞單句過長，無法使用免費翻譯介面');
  return batch;
}

export function parseGoogleResponse(body, expected) {
  if (!Array.isArray(body?.[0])) throw new Error('翻譯服務回傳格式已改變');
  const result = body[0].map(x => typeof x?.[0] === 'string' ? x[0] : '').join('').trim();
  const lines = result.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines.length !== expected || lines.some(x => !readable(x))) throw new Error('翻譯分行不一致');
  return lines;
}

export function googleUrl(texts) {
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: 'zh-TW', dt: 't', q: texts.map(text => text.replace(/\r?\n/g, ' ')).join('\n') });
  return `https://translate.googleapis.com/translate_a/single?${params}`;
}

export function trimCache(cache, maxBytes = 650000, maxSongs = 40) {
  const entries = Object.entries(cache).filter(([, x]) => x && Number.isFinite(x.used) && Array.isArray(x.entries))
    .sort((a, b) => b[1].used - a[1].used);
  const result = {};
  let size = 2;
  for (const [key, value] of entries.slice(0, maxSongs)) {
    const bytes = new TextEncoder().encode(JSON.stringify({ [key]: value })).length;
    if (size + bytes > maxBytes) continue;
    result[key] = value;
    size += bytes;
  }
  return result;
}
