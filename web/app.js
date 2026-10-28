// Remote Music client: controls foobar2000 through the beefweb proxy and
// plays the live HLS stream of foobar's output.

const COLS = ['%title%', '%artist%', '%album artist%', '%album%', '%length%',
  '%codec%', '%samplerate%', '%__bitspersample%', '%tracknumber%', '$directory_path(%path%)'];
const COLS_QS = 'columns=' + encodeURIComponent(COLS.join(','));
const PAGE = 300;
const STREAM = '/hls/live.m3u8';
const CABLE = /Hi-Fi Cable/i;

const $ = (id) => document.getElementById(id);
const audio = $('audio');

const state = {
  player: null,
  trackKey: '',
  playlists: [],
  playlist: null, // open playlist {id, title, itemCount}
  tracks: [],     // loaded items of the open playlist
  album: null,    // open album inside the playlist
  view: 'tracks',
  loading: false,
  listening: false,
  seeking: false,
  outputs: null,
  polledAt: 0,    // performance.now() of the last player poll, to move the position between polls
  lyrics: null,   // { synced, lines: [{ time, text }] } or { synced: false, text } for the current track
  lyricsOn: false, // remembered per device, read at start-up
  lyricsHeldUntil: 0, // the listener scrolled the lyrics by hand: leave them alone until then
};
let hls = null;

// ---------- API ----------

async function api(path) {
  const r = await fetch('/api' + path);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

function post(path, body) {
  return fetch('/api' + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

function toTrack(item, index) {
  // foobar renders a missing tag as "?"; treat it as empty so untagged rips show nothing.
  const cols = item.columns.map((c) => (c === '?' ? '' : c));
  const [title, artist, albumArtist, album, length, codec, samplerate, bits, number, folder] = cols;
  return { index, title, artist, albumArtist, album, length, codec, samplerate, bits, number, folder };
}

// ---------- Album grouping ----------

// Group by folder plus album tag: a release almost always lives in one folder, while
// tags vary (compilations have a different artist per track, untagged rips have none).
// Returns [{ title, artist, firstIndex, tracks }] in order of first appearance.
function groupAlbums(tracks) {
  const albums = new Map();
  for (const t of tracks) {
    const key = `${t.folder}\n${t.album}`;
    if (!albums.has(key)) {
      albums.set(key, { title: t.album || folderTitle(t.folder), firstIndex: t.index, tracks: [] });
    }
    albums.get(key).tracks.push(t);
  }
  return [...albums.values()].map((a) => ({ ...a, artist: albumArtistOf(a.tracks) }));
}

// "…\黑与白\CD2" reads better as "黑与白 · CD2" than as "CD2".
function folderTitle(folder) {
  const parts = (folder || '').split(/[\\/]/).filter(Boolean);
  const last = parts.at(-1) || t('album.unknown');
  return /^(cd|disc|disk)\s*\d+$/i.test(last) && parts.length > 1 ? `${parts.at(-2)} · ${last}` : last;
}

// One album artist if the tags agree, else one track artist, else "群星" for a compilation.
function albumArtistOf(tracks) {
  const distinct = (key) => new Set(tracks.map((t) => t[key]).filter(Boolean));
  for (const key of ['albumArtist', 'artist']) {
    const names = distinct(key);
    if (names.size === 1) return [...names][0];
  }
  return distinct('artist').size ? t('album.various') : '';
}

// ---------- Formatting ----------

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  return `${Math.floor(sec / 60)}:${String(s).padStart(2, '0')}`;
}

function formatBadge(t) {
  if (!t.codec) return '';
  const rate = Number(t.samplerate);
  if (t.bits === '1') return `${t.codec} · ${(rate / 1e6).toFixed(1)} MHz`; // DSD/DST
  const bits = /^\d+$/.test(t.bits) ? `${t.bits}bit / ` : '';
  return `${t.codec} · ${bits}${rate / 1000} kHz`;
}

function setStatus(msg) {
  $('status').textContent = msg;
  $('status').hidden = !msg;
}

// ---------- Player state ----------

async function refresh() {
  try {
    const { player } = await api('/player?' + COLS_QS);
    renderPlayer(player);
    setStatus('');
  } catch {
    setStatus(t('error.unreachable'));
  }
}

function poll() {
  refresh().finally(() => setTimeout(poll, 1000));
}

// Send a player command, then show its result at once instead of on the next poll tick.
async function command(path) {
  await post(path);
  await refresh();
}

function renderPlayer(p) {
  state.player = p;
  const item = p.activeItem;
  const playing = p.playbackState === 'playing';
  const hasTrack = item.index >= 0 && item.columns.length > 0;
  const tr = hasTrack ? toTrack(item, item.index) : null; // not `t`: that is the translator
  const key = hasTrack ? `${item.playlistId}:${item.index}` : '';

  for (const b of document.querySelectorAll('.pp')) b.classList.toggle('playing', playing);
  $('seek').disabled = !hasTrack;

  if (key !== state.trackKey) {
    state.trackKey = key;
    const artUrl = hasTrack ? `/api/artwork/current?k=${encodeURIComponent(key)}` : '';
    for (const img of [$('art'), $('mini-art')]) {
      img.classList.remove('noart');
      if (artUrl) img.src = artUrl; else img.removeAttribute('src');
    }
    $('title').textContent = tr ? tr.title : t('player.idle');
    $('mini-title').textContent = tr ? [tr.title, tr.artist].filter(Boolean).join(' · ') : t('player.idle');
    $('subtitle').textContent = tr ? [tr.artist, tr.album].filter(Boolean).join(' · ') : '';
    // Keep the badge's box when there is no track, so nothing below it moves.
    $('format').textContent = tr ? formatBadge(tr) : '';
    $('format').style.visibility = tr ? 'visible' : 'hidden';
    updateMediaSession(tr, artUrl);
    markPlaying();
    loadLyrics(tr);
  }

  state.polledAt = performance.now();
  renderModes();
  $('seek').max = item.duration || 1;
  if (!state.seeking) $('seek').value = item.position;
  $('pos').textContent = fmtTime(item.position);
  $('dur').textContent = fmtTime(item.duration);
  updatePositionState(item, playing);
}

// With foobar's default playback order, skipping past either end of the playlist stops
// playback. Wrap around instead, like a music app; other orders (repeat, shuffle) are
// left to foobar.
function skip(dir) {
  listenHere();
  const p = state.player;
  const item = p?.activeItem;
  const order = playbackOrder();
  const pl = state.playlists.find((x) => x.id === item?.playlistId);
  if (order === 0 && pl && item.index >= 0) {
    if (dir > 0 && item.index === pl.itemCount - 1) return command(`/player/play/${pl.id}/0`);
    if (dir < 0 && item.index === 0) return command(`/player/play/${pl.id}/${pl.itemCount - 1}`);
  }
  return command(dir > 0 ? '/player/next' : '/player/previous');
}

function togglePlay() {
  const s = state.player?.playbackState;
  if (s !== 'playing') listenHere(); // pausing leaves the stream on (silence), so resuming is instant
  // Flip the icon on the tap itself; the refresh after the command corrects it if needed.
  for (const b of document.querySelectorAll('.pp')) b.classList.toggle('playing', s !== 'playing');
  return command(s === 'stopped' || !s ? '/player/play' : '/player/pause/toggle');
}

// ---------- Shuffle and repeat ----------

// foobar has one playback order where Spotify has two switches, so they share it:
// 0 default, 1 repeat playlist, 2 repeat track, 3 random, 4-6 shuffle (tracks, albums, folders).
// Shuffle and repeat therefore exclude each other; turning one on turns the other off.
const ORDER = { off: 0, all: 1, one: 2, shuffle: 4 };

function playbackOrder() {
  return state.player?.options?.find((o) => o.id === 'playbackOrder')?.value ?? 0;
}

function setOrder(value) {
  return post('/player', { options: [{ id: 'playbackOrder', value }] }).then(refresh);
}

function toggleShuffle() {
  return setOrder(playbackOrder() >= 3 ? ORDER.off : ORDER.shuffle);
}

// off → all → one → off, like the repeat button in Spotify
function cycleRepeat() {
  const next = { [ORDER.all]: ORDER.one, [ORDER.one]: ORDER.off }[playbackOrder()] ?? ORDER.all;
  return setOrder(next);
}

function renderModes() {
  const order = playbackOrder();
  const repeat = order === ORDER.all ? 'all' : order === ORDER.one ? 'one' : 'off';
  $('shuffle').classList.toggle('on', order >= 3);
  $('shuffle').setAttribute('aria-pressed', order >= 3);
  $('repeat').classList.toggle('on', repeat !== 'off');
  $('repeat').classList.toggle('one', repeat === 'one');
  $('repeat').setAttribute('aria-label', t(`repeat.${repeat}`));
}

// ---------- Lyrics ----------

// ESLyric's .lrc: "[mm:ss.xx]text", sometimes several stamps on one line. Header tags
// ([ti:], [ar:], even "[00:00.00][by:…]") carry no words and drop out.
function parseLrc(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/^(\[[^\]]*\])+/, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    if (!stamps.length || !words) continue;
    for (const m of stamps) lines.push({ time: Number(m[1]) * 60 + Number(m[2]), text: words });
  }
  return lines.sort((a, b) => a.time - b.time);
}

async function loadLyrics(tr) {
  const key = state.trackKey;
  state.lyrics = null;
  renderLyrics();
  if (!tr?.title) return;
  try {
    const r = await fetch(`/lyrics?${new URLSearchParams({ artist: tr.artist, title: tr.title })}`);
    if (!r.ok || key !== state.trackKey) return; // 404: no lyrics; or the track moved on
    const { synced, text } = await r.json();
    const lines = synced ? parseLrc(text) : [];
    // .txt files open with "Artist: …" and "Title: …", which the panel already shows
    const plain = text.replace(/^(?:(?:artist|title|album):.*\r?\n)+\s*/i, '');
    state.lyrics = lines.length ? { synced: true, lines } : { synced: false, text: plain };
  } catch {
    return; // lyrics are a nicety; the player works without them
  }
  renderLyrics();
}

function renderLyrics() {
  const box = $('lyrics');
  const lyr = state.lyrics;
  const shown = !!lyr && state.lyricsOn;
  $('lyrics-toggle').disabled = !lyr;
  $('lyrics-toggle').setAttribute('aria-pressed', shown);
  $('lyrics-toggle').classList.toggle('on', shown);
  box.hidden = !shown;
  box.parentElement.classList.toggle('with-lyrics', shown);
  box.classList.toggle('plain', !!lyr && !lyr.synced);
  if (!lyr) return box.replaceChildren();
  // A line with the same timestamp as the one before is its translation
  const lineEl = (l, i, all) => el('p', i > 0 && l.time === all[i - 1].time ? 'tr' : '', l.text);
  box.replaceChildren(...(lyr.synced ? lyr.lines.map(lineEl) : [el('p', '', lyr.text)]));
  box.scrollTop = 0;
  syncLyrics();
}

// What the listener hears now: foobar's position, moved on since the last poll, minus the
// stream delay when the sound is on this device (nothing on the computer itself).
function heardPosition() {
  const p = state.player;
  if (!p) return 0;
  const playing = p.playbackState === 'playing';
  const since = playing ? (performance.now() - state.polledAt) / 1000 : 0;
  return p.activeItem.position + since - (playing ? streamDelay() : 0);
}

// Bilingual files put the translation on its own line with the same timestamp, so the
// current line is every line sharing the latest timestamp that has been reached.
function syncLyrics() {
  const box = $('lyrics');
  if (box.hidden || !state.lyrics?.synced) return;
  const { lines } = state.lyrics;
  const now = heardPosition();
  const time = lines.findLast((l) => l.time <= now)?.time;
  const current = [...box.children].filter((p, i) => lines[i].time === time);
  if (!current.length || current[0].classList.contains('current')) return;
  for (const p of box.querySelectorAll('.current')) p.classList.remove('current');
  for (const p of current) p.classList.add('current');
  if (performance.now() < state.lyricsHeldUntil) return;
  const first = current[0];
  const last = current.at(-1);
  const middle = (first.offsetTop + last.offsetTop + last.offsetHeight) / 2;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.scrollTo({ top: middle - box.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
}

function toggleLyrics() {
  state.lyricsOn = !state.lyricsOn;
  try { localStorage.setItem('lyrics', state.lyricsOn ? '1' : '0'); } catch { /* private mode */ }
  renderLyrics();
}

// ---------- Media Session (lock screen controls) ----------

function updateMediaSession(t, artUrl) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = t ? new MediaMetadata({
    title: t.title, artist: t.artist, album: t.album,
    artwork: [{ src: new URL(artUrl, location.href).href, sizes: '512x512' }],
  }) : null;
}

// How far the listener's ears are behind foobar: the stream's distance from its live
// edge plus about one segment still in the encoder. Zero when sound is on the computer.
function streamDelay() {
  if (!state.listening || !audio.seekable.length) return 0;
  return Math.max(0, audio.seekable.end(audio.seekable.length - 1) - audio.currentTime) + 1;
}

// The audio element plays an endless live stream, so the lock screen has no track
// length or position of its own: report foobar's, shifted to what is actually heard.
function updatePositionState(item, playing) {
  const session = navigator.mediaSession;
  if (!session?.setPositionState) return;
  session.playbackState = playing ? 'playing' : 'paused';
  try {
    if (!(item.duration > 0)) return session.setPositionState(); // nothing playing: clear it
    const heard = item.position - (playing ? streamDelay() : 0);
    session.setPositionState({
      duration: item.duration,
      playbackRate: 1,
      position: Math.min(item.duration, Math.max(0, heard)),
    });
  } catch {
    // An out-of-range value throws; the next poll sends a fresh one.
  }
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  // Lock screen play/pause drives foobar; the stream keeps flowing (silence while paused),
  // so iOS keeps the audio session alive and resuming is instant.
  navigator.mediaSession.setActionHandler('play', togglePlay);
  navigator.mediaSession.setActionHandler('pause', togglePlay);
  navigator.mediaSession.setActionHandler('nexttrack', () => skip(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1));
  // Dragging the lock screen scrubber seeks foobar; add the delay back so the listener
  // lands where they dropped it.
  try {
    navigator.mediaSession.setActionHandler('seekto', (d) =>
      post('/player', { position: d.seekTime + streamDelay() }).then(refresh));
  } catch {
    // Older browsers reject unknown actions.
  }
}

// ---------- Listening (HLS stream) ----------

// Safari plays HLS natively, which also keeps playing with the screen locked.
const appleNative = navigator.vendor.startsWith('Apple') &&
  !!audio.canPlayType('application/vnd.apple.mpegurl');

function attachStream() {
  if (appleNative) {
    audio.src = STREAM;
  } else if (window.Hls?.isSupported()) {
    hls = new Hls({ liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 6 });
    hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) retryStream(); });
    hls.loadSource(STREAM);
    hls.attachMedia(audio);
  } else {
    setStatus(t('error.noHls'));
    return false;
  }
  audio.play().catch((e) => setStatus(t('error.blocked', { message: e.message })));
  return true;
}

function detachStream() {
  hls?.destroy();
  hls = null;
  audio.removeAttribute('src');
  audio.load();
}

function retryStream() {
  if (!state.listening) return;
  detachStream();
  setTimeout(() => state.listening && attachStream(), 2000);
}

function jumpToLive() {
  if (appleNative && audio.seekable.length) {
    audio.currentTime = Math.max(0, audio.seekable.end(audio.seekable.length - 1) - 2);
  }
}

// On the music computer itself the sound is already in the room. Anywhere else, starting
// playback means "play it here": no separate listen switch.
const onHostMachine = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

// Call synchronously from every tap that starts playback (play, a track, skip):
// iOS only lets audio start inside the tap itself, so attach before any await.
function listenHere() {
  if (state.listening || onHostMachine) return;
  state.listening = attachStream();
  if (state.listening) routeToCable();
  renderSound();
}

function stopListening() {
  if (!state.listening) return;
  state.listening = false;
  detachStream();
  renderSound();
}

// One quiet line under the controls says where the sound is; opening it picks the output.
function renderSound() {
  const active = outputDevices().find((d) =>
    d.typeId === state.outputs?.active.typeId && d.deviceId === state.outputs?.active.deviceId);
  const here = state.listening;
  let label;
  if (here) label = t('sound.here');
  else if (active && CABLE.test(active.name)) label = t('sound.leftPc');
  else if (active) label = t('sound.onPc', { device: active.name.replace(/^[^:]*:\s*/, '') }); // drop "WASAPI (事件) : "
  else label = t('sound.idle');
  $('sound-label').textContent = label;
  $('output-row').classList.toggle('here', here);
}

// ---------- foobar output device ----------

function outputDevices() {
  return (state.outputs?.types || []).flatMap((type) =>
    type.devices.map((d) => ({ typeId: type.id, deviceId: d.id, name: d.name })));
}

async function loadOutputs() {
  try {
    const { outputs } = await api('/outputs');
    state.outputs = outputs;
  } catch {
    renderSound(); // beefweb < 0.10 has no outputs API: status line only, no picker
    return;
  }
  const { typeId, deviceId } = state.outputs.active;
  $('output').replaceChildren(...outputDevices().map((d) => {
    const opt = new Option(d.name, JSON.stringify({ typeId: d.typeId, deviceId: d.deviceId }));
    opt.selected = d.typeId === typeId && d.deviceId === deviceId;
    return opt;
  }));
  $('output').hidden = false;
  renderSound();
}

async function setOutput(target) {
  await post('/outputs/active', target);
  await loadOutputs();
}

// Picking an output from the list: the cable means "here", anything else sends the
// sound back to the computer, so this device stops listening.
function pickOutput(target) {
  const device = outputDevices().find((d) => d.typeId === target.typeId && d.deviceId === target.deviceId);
  if (device && CABLE.test(device.name)) listenHere();
  else stopListening();
  return setOutput(target);
}

async function routeToCable() {
  await loadOutputs();
  const cable = outputDevices().find((d) => CABLE.test(d.name) && !/exclusive|独占/i.test(d.name));
  const active = state.outputs?.active;
  if (cable && !(active.typeId === cable.typeId && active.deviceId === cable.deviceId)) {
    await setOutput({ typeId: cable.typeId, deviceId: cable.deviceId });
  }
}

// ---------- Library ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

// One list row: optional artwork or leading number, title with optional sub line,
// optional trailing value (duration, count). Without onClick it renders as plain text.
function row({ title, sub, lead, trail, art, onClick }) {
  const li = document.createElement('li');
  const body = el(onClick ? 'button' : 'div', 'row');
  if (onClick) body.onclick = onClick;
  if (art) {
    const img = el('img', 'row-art');
    img.loading = 'lazy';
    img.alt = '';
    img.src = art;
    // No artwork: swap in a transparent pixel, so the grey placeholder square stays
    // (a hidden <img> would leave a hole) and no broken-image glyph shows.
    img.onerror = () => { img.onerror = null; img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; };
    body.append(img);
  }
  if (lead) body.append(el('span', 'lead', lead));
  const text = el('span', 'text');
  text.append(el('span', 'row-title', title));
  if (sub) text.append(el('span', 'row-sub', sub));
  body.append(text);
  if (trail) body.append(el('span', 'trail', trail));
  li.append(body);
  return li;
}

function filterText() {
  return $('filter').value.trim().toLowerCase();
}

function matches(...fields) {
  const q = filterText();
  return !q || fields.some((f) => f?.toLowerCase().includes(q));
}

// In a single-album list the artist on every row is noise; show it only for guests,
// and show "artist · album" when the list mixes albums.
function trackRow(t, mixed) {
  const sub = mixed ? `${t.artist} · ${t.album}` : (t.artist !== t.albumArtist ? t.artist : '');
  const number = /^\d+$/.test(t.number) ? String(Number(t.number)) : String(t.index + 1);
  const li = row({
    title: t.title, sub, lead: number, trail: t.length,
    onClick: () => {
      listenHere();
      command(`/player/play/${state.playlist.id}/${t.index}`);
    },
  });
  li.dataset.index = t.index;
  return li;
}

function render() {
  const list = $('list');
  const pl = state.playlist;
  $('back').hidden = !pl;
  $('view-toggle').hidden = !pl || !!state.album;
  for (const b of $('view-toggle').children) b.classList.toggle('on', b.dataset.view === state.view);

  if (!pl) {
    $('lib-title').textContent = t('library.playlists');
    list.replaceChildren(...state.playlists
      .filter((p) => p.itemCount > 0 && matches(p.title))
      .map((p) => row({ title: p.title, trail: t('count.tracks', { n: p.itemCount }), onClick: () => openPlaylist(p) })));
  } else if (state.album) {
    $('lib-title').textContent = state.album.title;
    list.replaceChildren(...state.album.tracks.filter((t) => matches(t.title, t.artist))
      .map((t) => trackRow(t, false)));
  } else if (state.view === 'albums') {
    $('lib-title').textContent = pl.title;
    list.replaceChildren(...groupAlbums(state.tracks)
      .filter((a) => matches(a.title, a.artist))
      .map((a) => row({
        title: a.title, sub: a.artist, trail: t('count.tracks', { n: a.tracks.length }),
        art: `/api/artwork/${pl.id}/${a.firstIndex}`, onClick: () => openAlbum(a),
      })));
  } else {
    $('lib-title').textContent = pl.title;
    const mixed = new Set(state.tracks.map((t) => t.album)).size > 1;
    list.replaceChildren(...state.tracks.filter((t) => matches(t.title, t.artist, t.album))
      .map((t) => trackRow(t, mixed)));
  }
  markPlaying();
}

// The playing row swaps its track number for an icon, so it reads without relying on colour.
function markPlaying() {
  const item = state.player?.activeItem;
  const here = state.playlist && item?.playlistId === state.playlist.id;
  let newIcon = false;
  for (const li of $('list').children) {
    const on = !!here && li.dataset.index === String(item.index);
    if (li.classList.contains('playing') === on) continue;
    li.classList.toggle('playing', on);
    li.firstChild.toggleAttribute('aria-current', on);
    const lead = li.querySelector('.lead');
    if (!lead) continue;
    if (on) {
      lead.dataset.num = lead.textContent;
      lead.innerHTML = '<i data-lucide="audio-lines"></i>';
      newIcon = true;
    } else {
      lead.textContent = lead.dataset.num;
    }
  }
  if (newIcon) window.lucide?.createIcons();
}

async function loadPlaylists() {
  try {
    state.playlists = (await api('/playlists')).playlists;
    render();
  } catch {
    setStatus(t('error.playlists'));
  }
}

function openPlaylist(p) {
  Object.assign(state, { playlist: p, tracks: [], album: null });
  $('filter').value = '';
  render();
  loadMore();
}

function openAlbum(a) {
  state.album = a;
  render();
  $('list').scrollTo?.(0, 0);
}

function back() {
  if (state.album) state.album = null;
  else state.playlist = null;
  $('filter').value = '';
  render();
}

async function loadMore() {
  const pl = state.playlist;
  if (!pl || state.album || state.loading || state.tracks.length >= pl.itemCount) return;
  state.loading = true;
  try {
    const offset = state.tracks.length;
    const { playlistItems } = await api(`/playlists/${pl.id}/items/${offset}:${PAGE}?${COLS_QS}`);
    if (state.playlist !== pl) return; // user navigated away meanwhile
    state.tracks.push(...playlistItems.items.map((it, i) => toTrack(it, offset + i)));
    render();
  } finally {
    state.loading = false;
  }
  // Keep paging while the sentinel is still visible (short pages on tall screens).
  if (isVisible($('sentinel'))) loadMore();
}

function isVisible(el) {
  const r = el.getBoundingClientRect();
  return r.top < innerHeight && r.bottom >= 0;
}

// ---------- Wiring ----------

const actions = {
  'toggle-play': togglePlay,
  previous: () => skip(-1),
  next: () => skip(1),
  shuffle: toggleShuffle,
  repeat: cycleRepeat,
  lyrics: toggleLyrics,
  back,
  'open-now': () => document.body.classList.add('now-open'),
  'close-now': () => document.body.classList.remove('now-open'),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action],[data-view]');
  if (!el) return;
  if (el.dataset.view) {
    state.view = el.dataset.view;
    render();
  } else {
    actions[el.dataset.action]?.();
  }
});

// iOS Safari applies :active on touch only when a touchstart listener exists on the
// element or an ancestor. React apps get one for free; this plain page needs it, or
// none of the press feedback in press.css ever shows on an iPhone or iPad.
document.addEventListener('touchstart', () => {}, { passive: true });

$('filter').addEventListener('input', render);
$('output').addEventListener('change', (e) => pickOutput(JSON.parse(e.target.value)));

const seek = $('seek');
seek.addEventListener('pointerdown', () => { state.seeking = true; });
seek.addEventListener('change', async () => {
  await post('/player', { position: Number(seek.value) });
  state.seeking = false;
});

for (const img of [$('art'), $('mini-art')]) img.onerror = () => img.classList.add('noart');
// Scrolling the lyrics by hand pauses the auto-centring for a few seconds
for (const type of ['wheel', 'touchmove']) {
  $('lyrics').addEventListener(type, () => { state.lyricsHeldUntil = performance.now() + 4000; }, { passive: true });
}
setInterval(syncLyrics, 250); // lines change between the 1 s polls
audio.addEventListener('play', jumpToLive);
audio.addEventListener('error', () => appleNative && retryStream()); // hls.js reports its own errors

new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) loadMore();
}).observe($('sentinel'));

try { state.lyricsOn = localStorage.getItem('lyrics') === '1'; } catch { /* private mode */ }
window.lucide?.createIcons();
setupMediaSession();
loadPlaylists();
loadOutputs();
poll();
