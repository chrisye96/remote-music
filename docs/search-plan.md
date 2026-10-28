# Search the whole library from the home page: plan (not implemented)

Decided 2026-10-28, left for later.

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

## Open questions

- Whether artists and albums should be their own result sections (tap an artist to see all their songs), or songs only at first.
- The same song often sits in several playlists (an album playlist and a compilation). Show it once, from which playlist?
