// UI strings. Source language is zh-CN; en was added with the localize skill
// (glossary: foobar2000, server.py and HLS stay as they are; 这台设备 "this device",
// 电脑 "computer"). Language follows the browser; ?lang=en or ?lang=zh-CN overrides it
// and is remembered on this device, so a home screen app keeps it without the parameter.
// Placeholders: {name} is replaced by t(id, { name }). A string given as
// { one, other } is chosen by Intl.PluralRules on the `n` variable.

const STRINGS = {
  'zh-CN': {
    'now.region': '正在播放',
    'now.close': '收起',
    'player.idle': '未在播放',
    'player.seek': '播放进度',
    'player.previous': '上一首',
    'player.toggle': '播放或暂停',
    'player.next': '下一首',
    'player.shuffle': '随机播放',
    'repeat.off': '不循环',
    'repeat.all': '列表循环',
    'repeat.one': '单曲循环',
    'lyrics.button': '歌词',
    'sound.picker': 'foobar 输出设备',
    // The pill's icon already says where the sound is, so the text names the place only
    'sound.here': '这台设备 · 晚 3 秒',
    'sound.leftPc': '按播放在这里收听',
    'sound.onPc': '电脑 · {device}',
    'sound.idle': '按播放在这里收听',
    'library.region': '音乐库',
    'library.back': '返回',
    'library.playlists': '播放列表',
    'library.view': '显示方式',
    'library.tracks': '曲目',
    'library.albums': '专辑',
    'filter.playlists': '筛选播放列表',
    'filter.albums': '筛选专辑',
    'filter.tracks': '筛选歌曲、歌手、专辑',
    'mini.open': '打开正在播放',
    'album.unknown': '未知专辑',
    'album.various': '群星',
    'count.tracks': '{n} 首',
    'error.unreachable': '连不上 foobar2000，确认它和 server.py 都在运行',
    'error.noHls': '这个浏览器不支持 HLS 播放',
    'error.blocked': '播放被浏览器拦截：{message}',
    'error.playlists': '读取播放列表失败',
  },
  en: {
    'now.region': 'Now playing',
    'now.close': 'Close',
    'player.idle': 'Not playing',
    'player.seek': 'Playback position',
    'player.previous': 'Previous track',
    'player.toggle': 'Play or pause',
    'player.next': 'Next track',
    'player.shuffle': 'Shuffle',
    'repeat.off': 'Repeat off',
    'repeat.all': 'Repeat all',
    'repeat.one': 'Repeat one',
    'lyrics.button': 'Lyrics',
    'sound.picker': 'foobar output device',
    'sound.here': 'This Device · 3 s behind',
    'sound.leftPc': 'Play to listen here',
    'sound.onPc': 'Computer · {device}',
    'sound.idle': 'Play to listen here',
    'library.region': 'Library',
    'library.back': 'Back',
    'library.playlists': 'Playlists',
    'library.view': 'View',
    'library.tracks': 'Tracks',
    'library.albums': 'Albums',
    'filter.playlists': 'Filter playlists',
    'filter.albums': 'Filter albums',
    'filter.tracks': 'Filter songs, artists, albums',
    'mini.open': 'Open now playing',
    'album.unknown': 'Unknown album',
    'album.various': 'Various artists',
    'count.tracks': { one: '{n} track', other: '{n} tracks' },
    'error.unreachable': "Can't reach foobar2000. Check that it and server.py are running",
    'error.noHls': "This browser can't play HLS streams",
    'error.blocked': 'The browser blocked playback: {message}',
    'error.playlists': "Couldn't load playlists",
  },
};

function pickLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  let saved = null;
  try {
    if (fromUrl) localStorage.setItem('lang', fromUrl);
    saved = localStorage.getItem('lang');
  } catch {
    // Private mode: fall back to the URL and the browser languages
  }
  const wanted = [fromUrl, saved, ...navigator.languages];
  for (const tag of wanted) {
    if (!tag) continue;
    if (/^zh/i.test(tag)) return 'zh-CN';
    if (/^en/i.test(tag)) return 'en';
  }
  return 'en';
}

const LANG = pickLang();
const plurals = new Intl.PluralRules(LANG);

function t(id, vars = {}) {
  let s = STRINGS[LANG][id] ?? STRINGS['zh-CN'][id] ?? id;
  if (typeof s === 'object') s = s[plurals.select(vars.n)] ?? s.other;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Static markup: data-i18n sets the text, data-i18n-label the aria-label,
// data-i18n-placeholder the placeholder.
function applyI18n(root = document) {
  document.documentElement.lang = LANG;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

applyI18n();
