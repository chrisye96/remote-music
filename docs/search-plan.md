# Search the whole library from the home page: plan and what was built

Decided 2026-10-28; implemented 2026-10-28.

## Problem

The filter box only narrows the list on the current page. On the home page that list is the playlists, so typing an artist or a song finds nothing unless a playlist happens to be named after it. Since 2026-10-28 the placeholder says what each page filters ("Filter playlists", "Filter songs, artists, albums"), but there is still no way to find a song without knowing which playlist holds it.

## Facts that shape the design

- beefweb has no search endpoint; it only lists playlists and their items.
- The development machine has 112 playlists with 43,852 tracks in total, so the client cannot fetch everything on every keystroke.

## Plan

- **Server index**: `server.py` reads every playlist's items once (title, artist, album, album artist, length, playlist id and index) and keeps them in memory. It rebuilds the index when a playlist's item count or the playlist list changes (checked when a search comes in, at most every few seconds), so newly added music shows up without a restart.
- **Endpoint**: `GET /search?q=…` returns the first N matches. Matching uses the same loose comparison as the lyrics lookup (NFKC, case folding, collapsed spaces), so fullwidth and halfwidth characters match, and every word of the query must match some field.
- **Page**: on the home page the filter box becomes "Search": playlists whose name matches stay on top, then a "Songs" section with the matching tracks (title, artist · album, playlist name). Tapping a song plays it from its playlist, exactly like tapping it inside that playlist. Requests are debounced (about 200 ms) and a stale response is dropped.
- **Inside a playlist** nothing changes: the filter keeps narrowing that list on the device.

## Decisions (2026-10-28)

- **Grouped results**, in this order: Artists, Albums, Songs, Playlists. Tapping an artist lists all their songs; tapping an album opens it as the album view does.
- **One row per song, several places to play it.** foobar2000's playback statistics component is installed, so every file has `%play_count%` and `%last_played%`. The song plays from the copy played most recently; the other playlists follow by play count, and a "+N lists" control on the row expands them. The statistics are kept per file, not per playlist, so the same file in two playlists ties; then the playlist foobar2000 is playing from now wins, then foobar2000's playlist order. No play history of our own is recorded.
- **Index refresh**: reading all 43,852 items takes about 0.5 s (4 MB), so the index is rebuilt whenever a playlist's item count changes and otherwise at most once a minute, which keeps the statistics fresh.

## As built

- **Server** (`server.py`): `GET /search?q=…` returns up to 8 artists, 8 albums and 50 songs plus the total song count; `GET /search?artist=…` lists one artist's songs. Matching reuses the lyrics lookup's `loose_key` (NFKC, case folding, collapsed spaces), and every query word must appear in title, artist, album artist or album. Songs whose title matches come first, then artist, then album; within a tier, by play count. A query takes 15 to 25 ms on 43,852 tracks; the first build of the index about 0.8 s.
- **Albums** are a folder plus album tag, as in the album view, and open from the playlist that ranks best by the same rule as songs. The page builds the album with its existing `groupAlbums`, so titles such as "黑与白 · CD2" come out the same.
- **Page**: on the home page the box says "Search songs, artists, albums" and shows Artists, Albums, Songs and Playlists; elsewhere it still filters the page. Back from an artist or from an album opened in the results returns to the same results. A song held in several playlists has a "N more lists" control that folds the others out, ordered by play count.
- **Known gap**: search reads tags only. Faye Wong's tracks are tagged in pinyin, so "王菲" finds three music videos whose titles contain it and the playlists named after her, not her albums. Searching folder names too would fix that but also match far more than intended; left out for now.
