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
    'diag.region': '连接状态',
    'diag.server': '服务',
    'diag.serverDown': '连不上 server.py，确认它在电脑上运行',
    'diag.foobarOk': '{version} · beefweb {beefweb}',
    'diag.foobarDown': '没有在运行',
    'diag.noBeefweb': '在运行，但 beefweb 没有响应',
    'diag.encoder': '采集和编码',
    'diag.encoderOk': '{source} · 最新一段 {age} 秒前',
    'diag.encoderDown': '{source} 没有声音进来，已重启 {n} 次',
    'diag.lyrics': '歌词文件夹',
    'diag.lyricsNone': '没找到，歌词不会显示',
    'diag.device': '这台设备',
    'diag.deviceHost': '这就是电脑本身，声音直接从电脑播放',
    'diag.deviceIdle': '没有在收听，按播放开始',
    'diag.deviceError': '串流播放出错，正在重试',
    'diag.deviceListening': '正在收听，比电脑晚 {delay} 秒',
    'library.region': '音乐库',
    'library.back': '返回',
    'library.playlists': '播放列表',
    'library.view': '显示方式',
    'library.tracks': '曲目',
    'library.albums': '专辑',
    'filter.home': '搜索歌曲、歌手、专辑',
    'filter.albums': '筛选专辑',
    'filter.tracks': '筛选歌曲、歌手、专辑',
    'library.search': '搜索',
    'search.artists': '歌手',
    'search.albums': '专辑',
    'search.songs': '歌曲',
    'search.playlists': '播放列表',
    'search.more': '另 {n} 个列表',
    'search.all': '显示全部 {n} 个',
    'search.allSongs': '显示全部 {n} 首',
    'search.moreSongs': '还有 {n} 首，多输入几个字缩小范围',
    'search.none': '没有找到“{q}”',
    'mini.open': '打开正在播放',
    'album.unknown': '未知专辑',
    'album.various': '群星',
    'count.tracks': '{n} 首',
    'error.unreachable': '连不上 foobar2000，确认它和 server.py 都在运行',
    'error.noHls': '这个浏览器不支持 HLS 播放',
    'error.blocked': '播放被浏览器拦截：{message}',
    'error.playlists': '读取播放列表失败',
    'error.search': '搜索失败，确认 foobar2000 在运行',
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
    'diag.region': 'Connection status',
    'diag.server': 'Server',
    'diag.serverDown': "Can't reach server.py. Check that it runs on the computer",
    'diag.foobarOk': '{version} · beefweb {beefweb}',
    'diag.foobarDown': 'Not running',
    'diag.noBeefweb': 'Running, but beefweb does not answer',
    'diag.encoder': 'Capture and encoding',
    'diag.encoderOk': '{source} · last segment {age} s ago',
    'diag.encoderDown': { one: 'No sound from {source}; restarted {n} time', other: 'No sound from {source}; restarted {n} times' },
    'diag.lyrics': 'Lyrics folder',
    'diag.lyricsNone': 'Not found, so no lyrics are shown',
    'diag.device': 'This device',
    'diag.deviceHost': 'This is the computer itself; the sound plays here',
    'diag.deviceIdle': 'Not listening. Press play to start',
    'diag.deviceError': 'The stream failed; retrying',
    'diag.deviceListening': 'Listening, {delay} s behind the computer',
    'library.region': 'Library',
    'library.back': 'Back',
    'library.playlists': 'Playlists',
    'library.view': 'View',
    'library.tracks': 'Tracks',
    'library.albums': 'Albums',
    'filter.home': 'Search songs, artists, albums',
    'filter.albums': 'Filter albums',
    'filter.tracks': 'Filter songs, artists, albums',
    'library.search': 'Search',
    'search.artists': 'Artists',
    'search.albums': 'Albums',
    'search.songs': 'Songs',
    'search.playlists': 'Playlists',
    'search.more': { one: '{n} more list', other: '{n} more lists' },
    'search.all': 'Show all {n}',
    'search.allSongs': 'Show all {n} songs',
    'search.moreSongs': { one: '{n} more song. Type more to narrow it down', other: '{n} more songs. Type more to narrow it down' },
    'search.none': 'Nothing found for “{q}”',
    'mini.open': 'Open now playing',
    'album.unknown': 'Unknown album',
    'album.various': 'Various artists',
    'count.tracks': { one: '{n} track', other: '{n} tracks' },
    'error.unreachable': "Can't reach foobar2000. Check that it and server.py are running",
    'error.noHls': "This browser can't play HLS streams",
    'error.blocked': 'The browser blocked playback: {message}',
    'error.playlists': "Couldn't load playlists",
    'error.search': "Search failed. Check that foobar2000 is running",
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
