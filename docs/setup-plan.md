# Easier setup and download: plan (not implemented)

Decided 2026-10-28, left for later. Builds on [autostart-plan.md](autostart-plan.md); the two are meant to ship together.

## Where it stands

Getting started today takes, by hand: install Python, install an ffmpeg build with libsoxr and put it on `PATH`, install VB-Audio Hi-Fi Cable and set both ends to 24 bit / 44100 Hz, install beefweb 0.10+ into foobar2000, install Tailscale and enable MagicDNS and HTTPS certificates, run `tailscale serve --bg --https=8090 …`, clone the repository with git, and keep a window open with `python server.py`. Each step is documented, but a mistake in one of them (above all the cable's sample rate) shows up later as a vague symptom.

## What cannot be bundled

- **foobar2000 and beefweb**: the whole design rests on them; the user installs them once.
- **VB-Audio Hi-Fi Cable**: a driver under VB-Audio's licence; it cannot be redistributed, only linked to.
- **Tailscale**: needs the user's own account; it also provides the HTTPS that Safari requires.

## Plan, in order of value

1. **`setup.ps1`, an installer and checker** (English only, so Windows PowerShell 5.1 parses it):
   - Install what winget has and is missing: Python, ffmpeg (Gyan's full build includes libsoxr), Tailscale. Check whether winget offers the Hi-Fi Cable; if not, open its download page.
   - Check, and say exactly what to fix: ffmpeg is built with `--enable-libsoxr`; the capture device is listed by `ffmpeg -list_devices`; both cable ends run at 44100 Hz (the endpoint format is in the MMDevices registry keys; confirm this while implementing); beefweb answers on `127.0.0.1:8880`; Tailscale is running with HTTPS certificates on.
   - Run `tailscale serve --bg --https=8090 http://127.0.0.1:8090`, after checking that port 8090 is not already served for something else. Never `tailscale serve reset`.
   - Register the logon task from the autostart plan, with a matching `-Uninstall`.
   - Safe to run again: every step checks first and skips what is already done.
2. **Diagnostics in the app**: a `/status` endpoint and a small panel that shows whether beefweb is reachable, the encoder is producing segments, the capture device exists and lyrics were found. A listener on the iPad then sees why nothing plays without going back to the PC.
3. **Release zip**: a GitHub Release with the repository as a zip (for example `git archive`), so nobody needs git. Download, unzip, run `setup.ps1`.
4. **Single exe (optional, last)**: PyInstaller would remove the Python install, but once winget installs Python the gain is small and every release needs a rebuild.

## Lessons to build in (from 2026-10-28)

- Exactly one long-running copy of the server. `server.py` now claims its port exclusively and refuses to start a second copy, and each port has its own HLS folder. Before this, a preview started on the same port shared the requests and wiped the running server's stream, and the iPad could not connect.
- The server must not depend on a chat session or an open terminal; that is what the logon task is for.
- Previews (`.claude/launch.json`) use port 8091 and the test tone, so they never touch the real service or the capture device.
