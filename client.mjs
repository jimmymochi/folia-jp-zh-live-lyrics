import { Converter } from './vendor/opencc-cn2t.mjs';
import { LyricTranslator } from './translator.mjs';
import { songKey } from './core.mjs';
import { mountLyrics } from './view.mjs';

// FoliumLabel is a locale map, not a string; include en as the host fallback.
const label = text => ({ 'zh-TW': text, 'zh-CN': text, en: text });

// New Folium extension; no code copied from Folia or another community mod.
// API source: https://github.com/chthollyphile/folia-major/blob/main/mods/README.md
export default function activate(folium) {
  const live = folium.env.context === 'main';
  const mode = `mod:${folium.modId}:bilingual`;
  const handles = []; const disposers = [];
  let stopped = false; let previousMode = null; let latest = null; let lyricClock = null;
  const prefs = folium.registries.settingsSections.register({
    id: 'translation', label: label('日文歌翻譯與字幕'),
    description: label('自動翻譯只傳送歌詞文字至 Google；免費網頁介面沒有可用性保證。中文逐字亮起為時間估算。'),
    settings: [
      { key: 'autoTranslate', type: 'boolean', label: label('使用 Google 自動翻譯缺少中文的日文歌詞'), defaultValue: true },
      { key: 'highlight', type: 'boolean', label: label('中文逐字亮起（估算）'), defaultValue: true },
      { key: 'showNext', type: 'boolean', label: label('顯示下一句日文'), defaultValue: true },
      { key: 'fontScale', type: 'number', label: label('字幕大小'), defaultValue: 1, min: 0.7, max: 1.6, step: 0.05 },
    ],
  });
  handles.push(prefs);
  const translate = new LyricTranslator({
    fetch: (url, init) => folium.net.fetch(url, init),
    storage: live ? folium.storage : { get: async () => ({}), set: async () => {} },
    convert: Converter({ from: 'cn', to: 'tw' }),
  });
  const start = (song, lines, force = false) => {
    if (stopped || !live) return;
    latest = { song, lines };
    const getTime = () => lyricClock?.get() ?? folium.playback.getState().position;
    return translate.start(song, lines, getTime, Boolean(prefs.settings.get().autoTranslate), force)
      .catch(() => folium.log.warn('翻譯初始化失敗；原始歌詞繼續顯示'));
  };
  handles.push(folium.registries.visualizers.register({
    id: 'bilingual', label: label('日文・繁中同步'), order: 10,
    hostLayers: { background: true, subtitles: false },
    mount(container, ctx) {
      if (live && !ctx.isPreview) { lyricClock = ctx.lyricTime; void start(ctx.song, ctx.lines); }
      // Contexts are frozen host objects; wrap without mutating them.
      const viewContext = { ...ctx, translationKey: songKey(ctx.song, ctx.lines) };
      const dispose = mountLyrics(container, viewContext, translate, prefs.settings);
      return () => { if (lyricClock === ctx.lyricTime) lyricClock = null; dispose(); };
    },
  }));
  const openMode = () => {
    const currentMode = folium.visualizer.getMode();
    if (currentMode !== mode) previousMode = currentMode;
    const result = folium.visualizer.setMode(mode);
    return result;
  };
  const command = (id, text, run) => handles.push(folium.registries.commands.register({ id, label: label(text), run }));
  command('show', '開啟日文・繁中同步字幕', () => { openMode(); return '已切換雙語字幕畫面'; });
  command('retry', '重試目前歌曲的繁中翻譯', () => { if (latest) void start(latest.song, latest.lines, true); return '已安排重新檢查缺少的譯文'; });
  command('status', '查看日文翻譯狀態', () => translate.current?.status ?? '等待歌詞');
  command('clear-cache', '清除本模組的翻譯快取', async () => {
    translate.cancel(); await translate.clearCache();
    if (latest) void start(latest.song, latest.lines, true);
    return '已清除本模組的翻譯快取';
  });
  if (live) {
    disposers.push(folium.events.on('playback.songChanged', () => { latest = null; lyricClock = null; translate.cancel(); }));
    disposers.push(folium.events.on('lyrics.loaded', event => { void start(event.song, event.lines); }));
    disposers.push(prefs.settings.onChange(() => { if (latest) void start(latest.song, latest.lines); }));
    // Do not await network/storage during activate; Folium has a startup time budget.
    void folium.storage.get('mode-initialized').then(initialized => {
      if (stopped) return;
      if (!initialized) { openMode(); return folium.storage.set('mode-initialized', true); }
    }).catch(() => folium.log.warn('首次字幕模式設定未儲存，可從模組命令開啟'));
    const lines = folium.lyrics.getLines();
    if (lines.length) void start(folium.playback.getState().song, lines);
  }
  return () => {
    stopped = true; translate.dispose(); disposers.forEach(fn => fn());
    if (live && previousMode && folium.visualizer.getMode() === mode) {
      try { folium.visualizer.setMode(previousMode); } catch { /* Host handles a removed previous mode. */ }
    }
    handles.reverse().forEach(handle => handle.unregister());
  };
}
