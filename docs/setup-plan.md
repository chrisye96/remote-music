# Easier setup and download: plan

Decided 2026-10-28. Items 1 (`setup.ps1`) and 2 (diagnostics) implemented 2026-10-28; items 3 and 4 are still open. Builds on [autostart-plan.md](autostart-plan.md); the two are meant to ship together.

## Where it stands

Getting started today takes, by hand: install Python, install an ffmpeg build with libsoxr and put it on `PATH`, install VB-Audio Hi-Fi Cable and set both ends to 24 bit / 44100 Hz, install beefweb 0.10+ into foobar2000, install Tailscale and enable MagicDNS and HTTPS certificates, run `tailscale serve --bg --https=8090 …`, clone the repository with git, and keep a window open with `python server.py`. Each step is documented, but a mistake in one of them (above all the cable's sample rate) shows up later as a vague symptom.

## What cannot be bundled

- **foobar2000 and beefweb**: the whole design rests on them; the user installs them once.
- **VB-Audio Hi-Fi Cable**: a driver under VB-Audio's licence; it cannot be redistributed, only linked to.
- **Tailscale**: needs the user's own account; it also provides the HTTPS that Safari requires.

## Plan, in order of value

1. **`setup.ps1`, an installer and checker** (done) (English only, so Windows PowerShell 5.1 parses it):
   - Install what winget has and is missing: Python, ffmpeg (Gyan's full build includes libsoxr), Tailscale. Check whether winget offers the Hi-Fi Cable; if not, open its download page.
   - Check, and say exactly what to fix: ffmpeg is built with `--enable-libsoxr`; the capture device is listed by `ffmpeg -list_devices`; both cable ends run at 44100 Hz (read from `PKEY_AudioEngine_DeviceFormat` in the MMDevices registry keys: an 8 byte header, then WAVEFORMATEX); beefweb answers on `127.0.0.1:8880`; Tailscale is running with HTTPS certificates on.
   - Run `tailscale serve --bg --https=8090 http://127.0.0.1:8090`, after checking that port 8090 is not already served for something else. Never `tailscale serve reset`.
   - Register the logon tasks from the autostart plan only when asked (`-Autostart`; off by default), with a matching `-Uninstall`.
   - Safe to run again: every step checks first and skips what is already done.
2. **Diagnostics in the app** (done): a `/status` endpoint and a small panel that shows whether beefweb is reachable, the encoder is producing segments, the capture device exists and lyrics were found. A listener on the iPad then sees why nothing plays without going back to the PC.
   As built: the list sits in the sound pill's panel, under the output picker, and refreshes every 2 s only while open. Lines: foobar2000 (version and beefweb, or not running, or running without beefweb); capture and encoding (source, age of the newest segment, encoder restarts); lyrics folder; this device (listening and how far behind, idle, stream error, or the computer itself). If `server.py` itself does not answer, the first line says so. The red error banner opens Now Playing and this panel.
3. **Release zip**: a GitHub Release with the repository as a zip (for example `git archive`), so nobody needs git. Download, unzip, run `setup.ps1`.
4. **Single exe (optional, last)**: PyInstaller would remove the Python install, but once winget installs Python the gain is small and every release needs a rebuild.

## Lessons to build in (from 2026-10-28)

- Exactly one long-running copy of the server. `server.py` now claims its port exclusively and refuses to start a second copy, and each port has its own HLS folder. Before this, a preview started on the same port shared the requests and wiped the running server's stream, and the iPad could not connect.
- The server must not depend on a chat session or an open terminal; that is what the logon task is for.
- Previews (`.claude/launch.json`) use port 8091 and the test tone, so they never touch the real service or the capture device.
