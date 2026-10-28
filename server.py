"""Remote listening for foobar2000.

Captures foobar's output from a virtual audio cable, serves it as live HLS,
proxies the beefweb API for control, and serves the web client.
Stdlib only; needs ffmpeg on PATH.
"""
import argparse
import os
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BEEFWEB = "http://127.0.0.1:8880"
WEB_DIR = Path(__file__).parent / "web"
HLS_DIR = Path(tempfile.gettempdir()) / "remote-music-hls"
DEFAULT_DEVICE = "Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)"
SEGMENT_SECONDS = 1  # ponytail: ~3s end-to-end latency; raise to 2 if Wi-Fi stalls
# Where ESLyric saves lyrics in an installed (not portable) foobar2000 profile.
APPDATA = Path(os.environ.get("APPDATA", ""))
LYRICS_DIRS = [APPDATA / "foobar2000-v2" / "lyrics", APPDATA / "foobar2000" / "lyrics"]

CODECS = {
    # FLAC in fMP4: lossless, plays natively in Safari HLS and via hls.js elsewhere.
    "flac": ["-c:a", "flac"],
    # Fallback if a client refuses FLAC-in-HLS.
    "aac": ["-c:a", "aac", "-b:a", "320k"],
}


def ffmpeg_cmd(args):
    if args.test_tone:
        source = ["-re", "-f", "lavfi", "-i", "sine=f=440:r=48000", "-ac", "2"]
    else:
        source = ["-f", "dshow", "-audio_buffer_size", "50", "-i", f"audio={args.device}"]
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error", *source,
        # dshow tops out at 16 bit / 44.1 kHz. iOS and Bluetooth run at 48 kHz, so do
        # that conversion once here with soxr (this 48 kHz stream is what was verified on iPad).
        "-af", "aresample=48000:resampler=soxr",
        *CODECS[args.codec],
        "-f", "hls", "-hls_time", str(SEGMENT_SECONDS), "-hls_list_size", "6",
        "-hls_flags", "delete_segments+independent_segments",
        "-hls_segment_type", "fmp4",
        str(HLS_DIR / "live.m3u8"),
    ]


def run_encoder(args):
    """Keep ffmpeg alive; restart it if the device disappears or it crashes."""
    while True:
        shutil.rmtree(HLS_DIR, ignore_errors=True)
        HLS_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.run(ffmpeg_cmd(args), cwd=HLS_DIR)
        print("encoder: exited, restarting in 3s", file=sys.stderr)
        time.sleep(3)


def lyrics_key(name):
    """Compare names loosely: case, width (fullwidth brackets) and runs of spaces vary."""
    return " ".join(unicodedata.normalize("NFKC", name).casefold().split())


def find_lyrics(artist, title):
    """ESLyric names its files `Artist - Title.lrc` (timed) or `.txt` (plain); prefer timed."""
    wanted = lyrics_key(f"{artist} - {title}")
    found = {}
    for folder in LYRICS_DIRS:
        if folder.is_dir():
            for f in folder.iterdir():
                if f.suffix.lower() in (".lrc", ".txt") and lyrics_key(f.stem) == wanted:
                    found.setdefault(f.suffix.lower(), f)
    f = found.get(".lrc") or found.get(".txt")
    return f and {"synced": f.suffix.lower() == ".lrc", "text": f.read_text("utf-8-sig", errors="replace")}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".m3u8": "application/vnd.apple.mpegurl",
        ".m4s": "audio/mp4",
        ".mp4": "audio/mp4",
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB_DIR), **kw)

    def translate_path(self, path):
        if path.startswith("/hls/"):
            return str(HLS_DIR / os.path.basename(path.split("?")[0]))
        return super().translate_path(path)

    def end_headers(self):
        # Plain filenames, no bundler: always revalidate.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.proxy()
        if self.path.startswith("/lyrics?"):
            return self.lyrics()
        super().do_GET()

    def lyrics(self):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        found = find_lyrics(q.get("artist", [""])[0], q.get("title", [""])[0])
        if not found:
            return self.send_error(404, "no lyrics for this track")
        data = json.dumps(found, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self.proxy()
        self.send_error(404)

    def proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if self.command == "POST" else None
        req = urllib.request.Request(
            BEEFWEB + self.path, data=body, method=self.command,
            headers={"Content-Type": self.headers.get("Content-Type", "application/json")},
        )
        try:
            resp = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as e:
            resp = e
        except OSError:
            return self.send_error(502, "foobar2000 / beefweb is not reachable")
        data = resp.read()
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *a):
        pass  # HLS polling would flood the console


def tailnet_url(port):
    """https URL that `tailscale serve --https=<port>` publishes, or None if Tailscale is down."""
    try:
        out = subprocess.run(["tailscale", "status", "--json"], capture_output=True, timeout=5).stdout
        status = json.loads(out)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None
    name = (status.get("Self") or {}).get("DNSName", "").rstrip(".")
    return f"https://{name}:{port}" if status.get("BackendState") == "Running" and name else None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=8090)
    p.add_argument("--device", default=DEFAULT_DEVICE, help="DirectShow capture device name")
    p.add_argument("--codec", choices=CODECS, default="flac")
    p.add_argument("--test-tone", action="store_true", help="stream a 440 Hz tone instead of the device")
    p.add_argument("--lyrics-dir", type=Path, help="ESLyric's lyrics folder (default: the foobar2000 profile in %%APPDATA%%)")
    args = p.parse_args()
    if args.lyrics_dir:
        LYRICS_DIRS[:] = [args.lyrics_dir]

    threading.Thread(target=run_encoder, args=(args,), daemon=True).start()
    print(f"remote-music running (codec={args.codec}). Open on your iPad / phone:")
    print(f"    {tailnet_url(args.port) or 'Tailscale is not running; start it to connect other devices.'}")
    print("Leave this window open; press Ctrl+C to stop.")
    # Loopback only: other devices come in through `tailscale serve --https=8090`,
    # which gives Safari the HTTPS it insists on and keeps this off the open LAN.
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
