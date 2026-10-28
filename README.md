<p align="center">
  <img src="web/icon.svg" alt="Remote Music" width="112">
</p>

# Remote Music

English | [简体中文](README.zh-CN.md)

Listen on your iPad, phone or another computer to whatever foobar2000 is playing on your Windows PC, and control it from there: browse playlists and albums, pick a song, skip, seek.

foobar2000 keeps doing the decoding, so anything it can play still works: SACD ISO, DSD, cue sheets, and your whole DSP chain. The server captures foobar2000's output from a virtual audio cable, streams it as lossless FLAC over HLS, and serves a small web app that also drives foobar2000 through its beefweb plugin.

## Features

- **Play here, hear it here.** Press play, pick a song or skip on the iPad, and the sound moves to the iPad by itself. A small pill at the bottom left shows where the sound is; open it to send the sound back to the PC speakers.
- **Lossless stream**, 16 bit / 48 kHz FLAC (AAC 320k as a fallback), about 3 seconds behind the PC.
- **Scrolling lyrics** from foobar2000's ESLyric `.lrc` files, synced to what you actually hear (the stream delay is taken off), with bilingual files shown as line pairs. Untimed `.txt` lyrics are shown as plain text.
- **Shuffle and repeat** (off, all, one), mapped onto foobar2000's playback order.
- **Lock screen controls** with the real track position and length, play / pause, skip and scrubbing.
- **Search the whole library** from the home page: artists, albums and songs across all playlists. A song in several playlists shows once and plays from the copy you played last; the other playlists fold out under it.
- **Playlists and albums**: filter, page through large playlists, an album view grouped by folder (works for compilations and untagged rips), artwork.
- **Home screen app** (PWA) for iPad and iPhone, light and dark mode, English and Simplified Chinese.

## How it works

```
foobar2000 ──output──▶ VB-Audio Hi-Fi Cable ──dshow──▶ ffmpeg (FLAC, fMP4 HLS) ──┐
     ▲                                                                         ├─ server.py 127.0.0.1:8090
     └──────────────── beefweb :8880 (local only) ◀── /api proxy ──────────────┘        │
                                                           tailscale serve --https=8090 │ HTTPS
                                                                                        ▼
                                                                  iPad / phone / another computer
```

`server.py` listens on 127.0.0.1 only. Other devices reach it through `tailscale serve`, which also provides the HTTPS that Safari requires. The same address works at home (Tailscale connects directly over the LAN) and away.

## Requirements

- Windows with [foobar2000](https://www.foobar2000.org/)
- [beefweb](https://github.com/hyperblast/beefweb) 0.10 or later (the foobar2000 web API plugin; 0.10 adds output device switching)
- [VB-Audio Hi-Fi Cable](https://vb-audio.com/Cable/)
- [ffmpeg](https://ffmpeg.org/) on `PATH`, built with libsoxr (the gyan.dev "full" build is)
- Python 3.8 or later (standard library only)
- [Tailscale](https://tailscale.com/) on the PC and on every device, with MagicDNS and HTTPS certificates enabled in the admin console

## Setup

Install foobar2000 and the [VB-Audio Hi-Fi Cable](https://vb-audio.com/Cable/) first, and the beefweb component in foobar2000 (open the `.fb2k-component` file, confirm, restart foobar2000). Then, with foobar2000 open, run in this folder:

```bash
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

The script installs Python, ffmpeg and Tailscale with winget if they are missing, and checks the cable's sample rate, ffmpeg's libsoxr, beefweb and Tailscale. It also publishes the server on your tailnet. Anything it cannot fix, it lists with what to do. It is safe to run again; finished steps are skipped. `-NoInstall` only reports. Starting at logon stays off unless you add `-Autostart` (see [Start automatically](#start-automatically)).

The same steps by hand:

1. **Enable the virtual cable.** Sound settings → More sound settings: enable *Hi-Fi Cable Input* on the Playback tab and *Hi-Fi Cable Output* on the Recording tab. On both, Properties → Advanced, set the format to **24 bit, 44100 Hz**.

   Both ends must match the cable driver's internal sample rate. If they don't, Windows reads the data at the wrong rate and the stream sounds high pitched and drops out about half the time. The capture tops out at 44.1 kHz anyway, so a higher setting gains nothing.
2. **Install beefweb 0.10+** in foobar2000 (open the `.fb2k-component` file, confirm, restart foobar2000). Keep foobar2000's volume at 0 dB; set the volume on the listening device.
3. **Publish the server over HTTPS on your tailnet.** Once; it survives reboots:

   ```bash
   tailscale serve --bg --https=8090 http://127.0.0.1:8090
   ```

   Keep `--https=8090`. Plain `tailscale serve --bg 8090` takes the root address (port 443) and replaces anything else already served there. Never run `tailscale serve reset` on a machine where other apps use `tailscale serve`.

## Run

```bash
python server.py
```

The server prints the address to open, such as `https://<your-pc>.<your-tailnet>.ts.net:8090`. To look it up again:

```bash
tailscale serve status
```

On the iPad or phone, switch Tailscale on, open that address in Safari, and use **Add to Home Screen**. On the PC itself, use `http://localhost:8090`.

### Start automatically

Off by default. To have nothing to open before listening, turn it on:

```bash
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Autostart
```

This registers two tasks for your user, run at logon: **Remote Music foobar2000** starts foobar2000 hidden in the notification area (`/hide`), and **Remote Music server** runs `server.py` with `pythonw`, without a window. Its output goes to `%LOCALAPPDATA%\remote-music\server.log`. You stay logged on (a locked screen is fine) and the PC must not sleep. To turn it off again:

```bash
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Uninstall
```

Only one server runs per port: a second `server.py` on the same port stops with a message instead of taking over the stream.

### Options

| Option | What it does |
|---|---|
| `--codec aac` | Stream AAC 320k instead of FLAC, for a client that cannot play the FLAC stream |
| `--device "name"` | Capture device, default `Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)` |
| `--port 8090` | Local port |
| `--test-tone` | Stream a 440 Hz tone instead of the capture, for troubleshooting |
| `--lyrics-dir "path"` | ESLyric's lyrics folder. Usually not needed: by default the server finds the running foobar2000 and looks in `profile\lyrics` next to it (portable install), then in `%APPDATA%\foobar2000-v2\lyrics` and `%APPDATA%\foobar2000\lyrics` |

List the capture devices ffmpeg can see:

```bash
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
```

### Language

The app follows the browser language (English or Simplified Chinese). Add `?lang=en` or `?lang=zh-CN` to the address once to override it; the choice is remembered on that device.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| High pitched sound, stutters, about half silence | The cable's sample rate does not match on both ends and the driver. Set both to 44100 Hz (Setup step 1) |
| Safari: "HTTPS-Only enabled" | Open the `https://…ts.net:8090` address from `tailscale serve status`, not the LAN IP |
| The `ts.net` address times out on the PC itself | Windows may not resolve MagicDNS names locally. Use `http://localhost:8090` there |
| A device cannot connect at all | Tailscale must be on for that device. VPN clients with a "hide on LAN" feature (for example NordVPN's Invisibility on LAN) can block it |
| No sound after pressing play | The output pill should say the sound is on this device. If foobar2000 plays to the PC speakers, open the pill and pick Hi-Fi Cable |

## Limitations

- About 3 seconds of delay: after skipping, the change is heard a few seconds later. The lock screen position is corrected for it.
- The capture is 16 bit / 44.1 kHz (DirectShow's limit), resampled with soxr to the 48 kHz that iOS and Bluetooth use. Every track, whatever its sample rate, is converted to the cable's format by Windows first.
- Shuffle and repeat cannot both be on: foobar2000 has a single playback order, so turning one on turns the other off.
- No login. Access is limited by your tailnet; do not expose it with `tailscale funnel` or port forwarding.
- Windows only (DirectShow capture, VB-Audio cable).

## Roadmap

- Diagnostics in the app (is foobar2000 reachable, is the encoder running) and a release zip, so nobody needs git. See [docs/setup-plan.md](docs/setup-plan.md).

## License

MIT; see [LICENSE](LICENSE).

foobar2000 is a trademark of its respective owner. This project is not affiliated with or endorsed by foobar2000, beefweb, VB-Audio or Tailscale.
