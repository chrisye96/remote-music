# Scrolling lyrics: plan and what was built

Decided 2026-10-28; implemented 2026-10-28.

## Plan

- **Source**: the `.lrc` files that foobar2000's ESLyric component saves in the `lyrics` folder of the foobar2000 profile, named `Artist - Title.lrc`. On the development machine there were 57 `.lrc` files (timed) and 17 `.txt` files (untimed, could be shown statically). The tracks checked had no embedded lyrics, and no `.lrc` files sat next to the music files.
- **Server**: one endpoint that looks up the current track's artist and title in that folder and returns 404 when there is none. Matching must tolerate spacing differences (there are files such as `Alison Krauss  - Stay.lrc` with two spaces). The folder path should be an option, since it depends on the foobar2000 install.
- **Page**: parse the LRC timestamps, highlight the current line and keep it centred. Tracks without lyrics show nothing, and the rest of the layout must not move (see the "layout must not drift" rule).
- **Sync**: when listening on the device, the ear is about 3 seconds behind foobar2000's position. Subtract the measured stream delay (the stream's live edge minus the current playback time, plus one segment), the same value `streamDelay()` in `web/app.js` already uses for the lock screen. Do not hard-code it. When the sound is on the computer, subtract nothing.
- **Size**: about 100 lines.

## As built

- **Server** (`server.py`): `GET /lyrics?artist=…&title=…` returns `{"synced": true|false, "text": "…"}`, preferring `.lrc` over `.txt`, or 404. Names are compared after NFKC normalisation, case folding and collapsing runs of spaces, which also covers fullwidth brackets (`Raidas（Re-Mix）`). `--lyrics-dir` sets the folder; without it the server looks in `%APPDATA%\foobar2000-v2\lyrics` and `%APPDATA%\foobar2000\lyrics`. Finding the folder from the running `foobar2000.exe` was tried and dropped: the process path is not readable when foobar2000 runs elevated.
- **Files**: all 74 files were UTF-8 with BOM (read as `utf-8-sig`). Many `.lrc` files are bilingual, with the translation on its own line under the same timestamp; those lines are highlighted together and shown as a pair (translation smaller, closer). Some lines carry several timestamps, and some headers hide behind a timestamp (`[00:00.00][by:…]`); both are handled.
- **Page**: a lyrics icon at the bottom right (output pill at the bottom left, as in Spotify) swaps the artwork square for the lyrics, so nothing else moves. It is styled like the shuffle and repeat buttons: accent colour and a dot when on. The choice is remembered per device. The button is disabled for tracks without lyrics, and the artwork stays. Between the 1 second polls the position is advanced locally, so lines change on time. Scrolling the lyrics by hand pauses the auto-centring for 4 seconds.
