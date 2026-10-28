"""Remote listening for foobar2000.

Captures foobar's output from a virtual audio cable, serves it as live HLS,
proxies the beefweb API for control, and serves the web client.
Stdlib only; needs ffmpeg on PATH.
"""
import argparse
import csv
import ctypes
import io
import os
import json
import shutil
import socket
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
PROFILE_LYRICS_DIRS = [APPDATA / "foobar2000-v2" / "lyrics", APPDATA / "foobar2000" / "lyrics"]
LYRICS_DIR = None  # --lyrics-dir: use only this folder

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


def loose_key(name):
    """Compare names loosely: case, width (fullwidth brackets) and runs of spaces vary."""
    return " ".join(unicodedata.normalize("NFKC", name).casefold().split())


def foobar_dir():
    """Folder of the running foobar2000.exe, or None. Asks only for limited query rights,
    which still works when foobar2000 runs elevated (Get-Process cannot read it then)."""
    try:
        out = subprocess.run(["tasklist", "/fi", "imagename eq foobar2000.exe", "/fo", "csv", "/nh"],
                             capture_output=True, text=True, timeout=5).stdout
        pid = int(next(csv.reader(io.StringIO(out)))[1])
    except (OSError, ValueError, IndexError, StopIteration, subprocess.TimeoutExpired):
        return None  # not running ("INFO: No tasks…" has no PID column)
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return None
    try:
        buf, size = ctypes.create_unicode_buffer(1024), ctypes.c_ulong(1024)
        ok = kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size))
        return Path(buf.value).parent if ok else None
    finally:
        kernel32.CloseHandle(handle)


def lyrics_dirs():
    """--lyrics-dir if given; else a portable foobar2000's `profile\\lyrics` next to its exe,
    then the installed profile in %APPDATA%. Looked up each time, so the server can start
    before foobar2000."""
    if LYRICS_DIR:
        return [LYRICS_DIR]
    exe_dir = foobar_dir()
    portable = [exe_dir / "profile" / "lyrics"] if exe_dir else []
    return portable + PROFILE_LYRICS_DIRS


def find_lyrics(artist, title):
    """ESLyric names its files `Artist - Title.lrc` (timed) or `.txt` (plain); prefer timed."""
    wanted = loose_key(f"{artist} - {title}")
    found = {}
    for folder in lyrics_dirs():
        if folder.is_dir():
            for f in folder.iterdir():
                if f.suffix.lower() in (".lrc", ".txt") and loose_key(f.stem) == wanted:
                    found.setdefault(f.suffix.lower(), f)
    f = found.get(".lrc") or found.get(".txt")
    return f and {"synced": f.suffix.lower() == ".lrc", "text": f.read_text("utf-8-sig", errors="replace")}


# ---------- Library search (beefweb only lists playlists, it cannot search) ----------

LIBRARY_COLS = ["%title%", "%artist%", "%album artist%", "%album%", "%length%", "%tracknumber%",
                "$directory_path(%path%)", "%play_count%", "%last_played%"]
TRACK_FIELDS = ("index", "title", "artist", "albumArtist", "album", "length", "number", "folder")


def beefweb(path):
    with urllib.request.urlopen(BEEFWEB + "/api" + path, timeout=10) as r:
        return json.load(r)


class Library:
    """Every playlist's items in memory. Reading all 44k takes about 0.5 s, so the index is
    simply rebuilt when a playlist changes size, and at least once a minute so the play
    statistics stay fresh."""

    def __init__(self):
        self.lock = threading.Lock()
        self.signature, self.built_at, self.tracks = None, 0.0, []

    def current(self):
        playlists = beefweb("/playlists")["playlists"]
        signature = [(p["id"], p["itemCount"]) for p in playlists]
        with self.lock:
            if signature != self.signature or time.monotonic() - self.built_at > 60:
                self.tracks = self.load(playlists)
                self.signature, self.built_at = signature, time.monotonic()
            return self.tracks

    @staticmethod
    def load(playlists):
        cols = urllib.parse.quote(",".join(LIBRARY_COLS))
        tracks = []
        for order, p in enumerate(playlists):
            if not p["itemCount"]:
                continue
            items = beefweb(f"/playlists/{p['id']}/items/0:{p['itemCount']}?columns={cols}")["playlistItems"]["items"]
            for index, item in enumerate(items):
                # foobar renders a missing field as "?"
                title, artist, album_artist, album, length, number, folder, plays, last = (
                    "" if c == "?" else c for c in item["columns"])
                tracks.append({
                    "index": index, "title": title, "artist": artist, "albumArtist": album_artist,
                    "album": album, "length": length, "number": number, "folder": folder,
                    "playlistId": p["id"], "playlistTitle": p["title"], "order": order,
                    "plays": int(plays) if plays.isdigit() else 0, "lastPlayed": last,
                    "titleKey": loose_key(title), "artistKey": loose_key(artist),
                    "albumKey": loose_key(f"{album} {album_artist}"),
                    "text": loose_key(" ".join((title, artist, album_artist, album))),
                })
        return tracks


LIBRARY = Library()


def rank_places(copies, active):
    """Where to play a song from: the copy played most recently, then the others by play
    count. foobar keeps statistics per file, so one file in two playlists ties; then the
    playlist playing now wins, then foobar's playlist order. One entry per playlist."""
    first = max(copies, key=lambda t: (t["lastPlayed"], t["playlistId"] == active, -t["order"]))
    rest = sorted((t for t in copies if t is not first), reverse=True,
                  key=lambda t: (t["plays"], t["lastPlayed"], t["playlistId"] == active, -t["order"]))
    places = {}
    for t in (first, *rest):
        places.setdefault(t["playlistId"], t)
    return list(places.values())


def song_rows(tracks, active):
    """One row per song (artist + title), with every playlist it can be played from."""
    songs = {}
    for t in tracks:
        songs.setdefault((t["artistKey"], t["titleKey"]), []).append(t)
    rows = []
    for copies in songs.values():
        places = rank_places(copies, active)
        rows.append({
            **{k: places[0][k] for k in TRACK_FIELDS},
            "plays": sum(t["plays"] for t in places),
            "places": [{"playlistId": t["playlistId"], "playlistTitle": t["playlistTitle"],
                        "index": t["index"]} for t in places],
        })
    return rows


def search_library(tracks, query, active, limit=50):
    words = loose_key(query).split()
    if not words:
        return {"artists": [], "albums": [], "songs": [], "songsTotal": 0}
    phrase = " ".join(words)
    has = lambda key: all(w in key for w in words)
    hits = [t for t in tracks if has(t["text"])]

    artists = {}
    for t in hits:
        if has(t["artistKey"]):
            artists.setdefault(t["artistKey"], []).append(t)
    artist_rows = sorted(({
        "name": max({t["artist"] for t in g}, key=[t["artist"] for t in g].count),  # most common spelling
        "songs": len({t["titleKey"] for t in g}),
        "starts": g[0]["artistKey"].startswith(phrase),
    } for g in artists.values()), key=lambda a: (not a.pop("starts"), -a["songs"]))

    # An album is a folder plus album tag (as on the page); it opens from its best playlist
    albums = {}
    for t in hits:
        if has(t["albumKey"]):
            albums.setdefault((t["folder"], t["albumKey"]), []).append(t)
    album_rows = []
    for g in albums.values():
        per_playlist = {}
        for t in g:
            per_playlist.setdefault(t["playlistId"], []).append(t)
        best = rank_places([{**ts[0], "lastPlayed": max(t["lastPlayed"] for t in ts),
                             "plays": sum(t["plays"] for t in ts)} for ts in per_playlist.values()], active)[0]
        album_tracks = sorted(per_playlist[best["playlistId"]], key=lambda t: t["index"])
        album_rows.append({
            "playlistId": best["playlistId"], "playlistTitle": best["playlistTitle"],
            "tracks": [{k: t[k] for k in TRACK_FIELDS} for t in album_tracks],
            "_sort": (not g[0]["albumKey"].startswith(phrase), -sum(t["plays"] for t in g)),
        })
    album_rows.sort(key=lambda a: a.pop("_sort"))

    # Songs whose title matches come first, then by artist, then album; popular ones first
    def tier(s):
        title, artist = loose_key(s["title"]), loose_key(s["artist"])
        return 0 if title.startswith(phrase) else 1 if has(title) else 2 if has(artist) else 3
    songs = sorted(song_rows(hits, active), key=lambda s: (tier(s), -s["plays"], s["title"]))
    return {"artists": artist_rows[:8], "albums": album_rows[:8], "songs": songs[:limit],
            "songsTotal": len(songs)}


def artist_songs(tracks, name, active):
    key = loose_key(name)
    songs = song_rows([t for t in tracks if t["artistKey"] == key], active)
    number = lambda s: int(s["number"]) if s["number"].isdigit() else 0
    return {"songs": sorted(songs, key=lambda s: (s["album"], number(s), s["title"]))}


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
        if self.path.startswith("/search?"):
            return self.search()
        super().do_GET()

    def query(self, name):
        return urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get(name, [""])[0]

    def lyrics(self):
        found = find_lyrics(self.query("artist"), self.query("title"))
        if not found:
            return self.send_error(404, "no lyrics for this track")
        self.send_json(found)

    # /search?q=… searches everything; /search?artist=… lists one artist's songs
    def search(self):
        try:
            tracks = LIBRARY.current()
            active = beefweb("/player")["player"]["activeItem"]["playlistId"]
        except (OSError, ValueError, KeyError):
            return self.send_error(502, "foobar2000 / beefweb is not reachable")
        artist = self.query("artist")
        self.send_json(artist_songs(tracks, artist, active) if artist
                       else search_library(tracks, self.query("q"), active))

    def send_json(self, value):
        data = json.dumps(value, ensure_ascii=False).encode()
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


class ExclusiveServer(ThreadingHTTPServer):
    """On Windows, SO_REUSEADDR (http.server's default) lets a second server bind the same
    port and silently share its requests. Claim the port exclusively, so that fails."""
    allow_reuse_address = False

    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


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
    p.add_argument("--lyrics-dir", type=Path,
                   help="ESLyric's lyrics folder (default: found from the running foobar2000)")
    args = p.parse_args()
    global LYRICS_DIR, HLS_DIR
    LYRICS_DIR = args.lyrics_dir
    # One folder per port: the encoder empties it on start, which must not hit another server's stream
    HLS_DIR = HLS_DIR.with_name(f"{HLS_DIR.name}-{args.port}")

    # Loopback only: other devices come in through `tailscale serve --https=8090`,
    # which gives Safari the HTTPS it insists on and keeps this off the open LAN.
    # Bind before starting the encoder, so a second copy stops here instead of
    # restarting the capture under the running one.
    try:
        server = ExclusiveServer(("127.0.0.1", args.port), Handler)
    except OSError:
        sys.exit(f"Port {args.port} is already in use: is server.py already running? "
                 "Stop it first, or pick another port with --port.")
    threading.Thread(target=run_encoder, args=(args,), daemon=True).start()
    print(f"remote-music running (codec={args.codec}). Open on your iPad / phone:")
    print(f"    {tailnet_url(args.port) or 'Tailscale is not running; start it to connect other devices.'}")
    print("Leave this window open; press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
