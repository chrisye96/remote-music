# Run in the background at logon: plan and what was built

Decided 2026-10-28; implemented 2026-10-28 in `setup.ps1` (see As built at the end).

## Goal

Listen on the iPad without opening foobar2000 by hand. After the PC starts and the user logs on, everything needed runs hidden in the background.

## Plan (option A, adopted)

- **foobar2000 hidden**: start it with `foobar2000.exe /hide`, so it lives in the notification area with no main window. beefweb runs inside foobar2000, so foobar2000 itself must run; it just never has to be opened.
- **Start at logon**: a Task Scheduler task, triggered at logon of this user, starts foobar2000 (`/hide`) and then `server.py` (with `--lyrics-dir` where needed), both without a visible window. Add a short wait or a retry so `server.py` does not race foobar2000's start-up (the page already shows "can't reach foobar2000" and recovers on the next poll).
- **Script, not hand setup**: one `.ps1` that registers (and can remove) the task, with the foobar2000 path and the server options as parameters. English only, so Windows PowerShell 5.1 parses it (see the global code language rule). Verify that the task really starts both processes; a hidden launcher can report success while the script failed.
- **Nothing to do for Tailscale**: `tailscale serve --bg --https=8090` already survives reboots.
- **README**: a "Start automatically" section in both languages.

## Limits to state in the README

- The user must be logged on (a locked screen is fine). foobar2000 is a desktop app and capturing the virtual cable needs the user's audio session, so this cannot be a real Windows service.
- The PC must not sleep, or the stream stops.
- ffmpeg encodes silence while nobody listens. Cheap, but it could later start only when a listener connects.

## Considered and set aside (option B)

Serve the music files directly instead of capturing foobar2000's output: no virtual cable, no 3 second delay, real seeking, and the files' own resolution instead of 16 bit / 44.1 kHz. Nothing in it is impossible, but every part foobar2000 does today has to be rebuilt with other tools:

- **SACD ISO**: ffmpeg decodes DSD (and DST) but cannot open the ISO container; `sacd_extract` can list and extract its tracks, which then go through ffmpeg. Extraction is large (hundreds of MB per track), so it needs caching or piping.
- **DSP chain**: foobar2000's DSP components only run inside foobar2000. Common ones have ffmpeg equivalents (`aresample` with soxr, `equalizer`/`firequalizer`, `afir` for convolution, `bs2b` crossfeed, ReplayGain from tags), so the chain in use would be rebuilt as an ffmpeg filter graph, not reused.
- **Library**: foobar2000's `.fpl` playlists are a binary format; the library would come from scanning folders and reading tags (a tag library breaks the "stdlib only" rule), plus cue sheets, artwork, and the lyrics search ESLyric does.

Worth revisiting as its own feature if the delay or the 44.1 kHz ceiling starts to matter. Ready-made servers (for example Navidrome with a Subsonic client on iOS) cover the library part but not SACD ISO or the DSP chain.

## As built

- **Off by default** (decided 2026-10-28): `setup.ps1` installs, checks and publishes, but registers the logon tasks only with `-Autostart`; `-Uninstall` removes them. Without it, the summary says autostart is off and how to start the server by hand.
- **Two tasks, not one task with two actions**: a task's actions run one after another, each waiting for the previous to end, and foobar2000 never ends. `Remote Music foobar2000` runs `foobar2000.exe /hide`; `Remote Music server` runs `pythonw.exe server.py`. Both at logon of the current user, not elevated, no time limit (the default stops a task after 3 days), the server restarted up to 3 times if it dies. No ordering is needed: the server already copes with foobar2000 starting later.
- **Not elevated**: the portable foobar2000 had no "run as administrator" setting and its profile folder is writable by the user, so it does not need elevation.
- **Windowless server**: under `pythonw` there is no stdout or stderr, so `server.py` writes to `%LOCALAPPDATA%\remote-music\server.log` (one older copy kept past 1 MB), and starts ffmpeg, `tasklist` and `tailscale` with `CREATE_NO_WINDOW` so no console windows flash up. ffmpeg's errors still reach the console or the log.
- **One copy per port**: `server.py` claims its port with `SO_EXCLUSIVEADDRUSE` and binds before it starts the encoder, so a second copy stops with a message instead of sharing the port and wiping the stream.
