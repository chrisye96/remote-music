# Scrolling lyrics: plan (not implemented)

Decided 2026-10-28, left for later.

- **Source**: the `.lrc` files that foobar2000's ESLyric component saves in the `lyrics` folder of the foobar2000 profile, named `Artist - Title.lrc`. On the development machine there were 57 `.lrc` files (timed) and 17 `.txt` files (untimed, could be shown statically). The tracks checked had no embedded lyrics, and no `.lrc` files sat next to the music files.
- **Server**: one endpoint that looks up the current track's artist and title in that folder and returns 404 when there is none. Matching must tolerate spacing differences (there are files such as `Alison Krauss  - Stay.lrc` with two spaces). The folder path should be an option, since it depends on the foobar2000 install.
- **Page**: parse the LRC timestamps, highlight the current line and keep it centred. Tracks without lyrics show nothing, and the rest of the layout must not move (see the "layout must not drift" rule).
- **Sync**: when listening on the device, the ear is about 3 seconds behind foobar2000's position. Subtract the measured stream delay (the stream's live edge minus the current playback time, plus one segment), the same value `streamDelay()` in `web/app.js` already uses for the lock screen. Do not hard-code it. When the sound is on the computer, subtract nothing.
- **Size**: about 100 lines.
