import { clamp, graphemes, lineProgress, validEnd, wordProgress } from './core.mjs';

// Uses Folium's owned container and lyric clock. No host DOM selectors or private stores.
// https://github.com/chthollyphile/folia-major/blob/main/mods/README.md#visualizers
export function mountLyrics(container, ctx, translator, preferences) {
  const doc = container.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = `
    .jpzh { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:6vh 8vw 15vh;
      box-sizing:border-box; color:#fff; text-align:center; font-family:"Noto Sans CJK TC","Microsoft JhengHei",sans-serif;
      pointer-events:none; overflow:hidden; }
    .jpzh-card { width:min(1100px,100%); padding:30px 34px; border-radius:24px;
      background:linear-gradient(125deg,rgba(12,16,22,.75),rgba(12,16,22,.38));
      border:1px solid rgba(255,255,255,.13); box-shadow:0 18px 70px #0003; }
    .jpzh-song { font-size:13px; letter-spacing:.08em; opacity:.65; margin-bottom:24px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .jpzh-original { font-size:clamp(24px,4vw,54px); font-size:clamp(24px,calc(4vw * var(--jpzh-size,1)),68px); font-weight:700;
      line-height:1.5; letter-spacing:.035em; overflow-wrap:anywhere; white-space:pre-wrap; }
    .jpzh-chinese { margin-top:14px; font-size:clamp(22px,calc(3.1vw * var(--jpzh-size,1)),52px); line-height:1.65;
      font-weight:600; overflow-wrap:anywhere; white-space:pre-wrap; }
    .jpzh-word { color:transparent; background:linear-gradient(90deg,var(--jpzh-lit,#fff) 0%,var(--jpzh-lit,#fff) var(--p,0%),
      var(--jpzh-dim,#ffffff55) var(--p,0%),var(--jpzh-dim,#ffffff55) 100%); background-clip:text; -webkit-background-clip:text; }
    .jpzh-chinese .jpzh-word { --jpzh-lit:#ffe3a4; --jpzh-dim:#ffe3a455; }
    .jpzh-next { font-size:clamp(14px,1.8vw,22px); line-height:1.6; opacity:.45; margin-top:28px; overflow-wrap:anywhere; }
    .jpzh-status { font-size:12px; opacity:.6; margin-top:18px; line-height:1.7; }
    .jpzh-empty { font-size:19px; opacity:.7; }
    @media (max-width:600px) { .jpzh { padding:4vh 5vw 18vh; } .jpzh-card { padding:22px 18px; } }
    @media (prefers-reduced-motion:reduce) { .jpzh-word { background:none; color:var(--jpzh-lit,#fff); } }
  `;
  const root = doc.createElement('div'); root.className = 'jpzh';
  const card = doc.createElement('div'); card.className = 'jpzh-card';
  const elements = {};
  for (const name of ['song', 'original', 'chinese', 'next', 'status']) {
    const el = doc.createElement('div'); el.className = `jpzh-${name}`; card.append(el); elements[name] = el;
  }
  elements.chinese.setAttribute('aria-label', '繁體中文字幕');
  root.append(card); container.append(style, root);
  let rendered = ''; let originalSpans = []; let chineseSpans = []; let words = [];
  let destroyed = false;
  const makeSpans = (element, texts) => {
    element.replaceChildren();
    return texts.map(text => { const span = doc.createElement('span'); span.className = 'jpzh-word'; span.textContent = text; element.append(span); return span; });
  };
  function render() {
    if (destroyed) return;
    const display = ctx.getDisplay();
    root.hidden = !display.showText;
    root.style.display = display.showText ? 'flex' : 'none';
    const prefs = preferences.get();
    root.style.setProperty('--jpzh-size', String(Number(prefs.fontScale) || 1));
    const time = ctx.staticMode ? (ctx.lines[ctx.staticLineIndex ?? 0]?.startTime ?? 0) : ctx.lyricTime.get();
    let index = ctx.staticMode ? (ctx.staticLineIndex ?? 0) : ctx.getLineIndex();
    if (index < 0) {
      index = ctx.lines.findLastIndex(line => line.startTime <= time);
      if (index >= 0 && time > validEnd(ctx.lines[index], ctx.lines[index + 1], ctx.getDuration()) + 4) index = -1;
    }
    const line = ctx.lines[index];
    elements.song.textContent = [ctx.song?.title, ctx.song?.artist].filter(Boolean).join('  /  ');
    if (!line) {
      rendered = ''; originalSpans = []; chineseSpans = [];
      elements.original.textContent = ctx.lines.length ? '♪' : '尚未取得日文歌詞';
      elements.chinese.textContent = ctx.lines.length ? '' : '取得帶時間軸的歌詞後，會自動開始翻譯';
      elements.next.textContent = ctx.lines.find(x => x.startTime > time)?.fullText ?? '';
      elements.status.textContent = translator.current?.status ?? '';
      return;
    }
    const sameSong = translator.current?.lines === ctx.lines || translator.current?.key === ctx.translationKey;
    const text = sameSong ? translator.value(line) : '';
    const signature = JSON.stringify([index, line.fullText, text]);
    if (signature !== rendered) {
      rendered = signature;
      words = Array.isArray(line.words) && line.words.map(w => w.text).join('') === line.fullText ? line.words : [];
      originalSpans = makeSpans(elements.original, words.length ? words.map(w => w.text) : graphemes(line.fullText));
      chineseSpans = makeSpans(elements.chinese, graphemes(text));
      if (!text) elements.chinese.textContent = translator.current?.error ? '暫無中文譯文' : preferences.get().autoTranslate ? '正在準備繁中翻譯…' : '這句沒有現成中文';
      elements.next.textContent = prefs.showNext ? (ctx.lines[index + 1]?.fullText ?? '') : '';
    }
    const progress = lineProgress(line, time, ctx.lines[index + 1], ctx.getDuration());
    originalSpans.forEach((span, i) => {
      const value = words.length ? wordProgress(words[i], line, time, ctx.lines[index + 1], ctx.getDuration()) : clamp(progress * originalSpans.length - i);
      span.style.setProperty('--p', `${(100 * value).toFixed(1)}%`);
    });
    chineseSpans.forEach((span, i) => span.style.setProperty('--p', `${(100 * (prefs.highlight ? clamp(progress * chineseSpans.length - i) : 1)).toFixed(1)}%`));
    const origin = translator.current?.origins.get(line.fullText.trim());
    elements.status.textContent = translator.current?.error || translator.current?.cacheWarning
      || (text ? `${origin ?? '繁中字幕'}${prefs.highlight ? ' · 中文亮起依句子時間估算' : ''}` : translator.current?.status ?? '');
  }
  const disposers = [ctx.onLyricTime(render), ctx.onChange(() => { rendered = ''; render(); }),
    translator.subscribe(render), preferences.onChange(() => { rendered = ''; render(); })];
  render();
  return () => { destroyed = true; disposers.forEach(fn => fn()); root.remove(); style.remove(); };
}
