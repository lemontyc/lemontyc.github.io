#!/usr/bin/env python3
"""Pull media from Instagram into the site, at build time.

Why build time: this site is static on GitHub Pages, so there is nowhere
to keep a token at runtime. Calling the API from the browser would publish
it. So the token lives in repository Secrets, this runs in CI, and the
result is committed as ordinary files.

Why the files are downloaded rather than linked: Instagram's media_url
values are signed CDN links that expire. Hotlinking them gives you a
gallery full of dead images in a few days.

Usage
-----
  export IG_ACCESS_TOKEN=...            # long-lived token
  python scripts/sync_instagram.py --dry-run     # show what would happen
  python scripts/sync_instagram.py               # do it

Options
-------
  --dry-run       fetch and report; touch nothing on disk
  --limit N       how many posts to pull (default 24)
  --videos        include videos and reels (off by default; they are big)
  --prune         delete local files that are no longer in the feed
  --max-edge N    longest image edge in pixels (default 1600)

Exit codes: 0 fine, 1 something went wrong, 2 the token is bad or expired.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://graph.instagram.com"

# Field names are shared across Instagram's API generations. `children` is
# only meaningful on carousels; the API ignores it elsewhere.
FIELDS = (
    "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,"
    "children{id,media_type,media_url,thumbnail_url}"
)

ROOT = Path(__file__).resolve().parent.parent
MEDIA_DIR = ROOT / "assets" / "images" / "photos" / "instagram"
DATA_FILE = ROOT / "_data" / "instagram.yml"
SITE_PATH = "/assets/images/photos/instagram"


# ── HTTP ──────────────────────────────────────────────────────────────

def get_json(url, params):
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url + "?" + query,
        headers={"User-Agent": "lemontyc.com sync (+https://lemontyc.com)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        try:
            detail = json.loads(body)["error"]["message"]
        except Exception:
            detail = body[:400]
        if err.code in (400, 401, 403):
            print("Instagram rejected the request: " + detail, file=sys.stderr)
            print(
                "\nUsually this means the token has expired, or the account is "
                "not a Business/Creator account.\nSee docs/instagram.md.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        raise


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "lemontyc.com sync"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.read())
    return dest.stat().st_size


# ── Captions ──────────────────────────────────────────────────────────

HASHTAGS = re.compile(r"(?:^|\s)#[\wÀ-ɏ]+", re.UNICODE)
WHITESPACE = re.compile(r"\s+")


def clean_caption(raw, limit=110):
    """First sentence-ish of the caption, minus the hashtag wall."""
    if not raw:
        return ""
    text = HASHTAGS.sub(" ", raw)
    text = text.split("\n")[0]
    text = WHITESPACE.sub(" ", text).strip(" -–—·|")
    if len(text) > limit:
        cut = text[:limit].rsplit(" ", 1)[0]
        text = cut + "…"
    return text.strip()


def yaml_str(value):
    """Double-quoted YAML scalar, safely escaped."""
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    text = "".join(ch for ch in text if ch == "\t" or ord(ch) >= 32)
    return '"' + text + '"'


# ── Images ────────────────────────────────────────────────────────────

def shrink(path, max_edge):
    """Resize in place and strip metadata. Silently skipped without Pillow."""
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as img:
            img = img.convert("RGB")
            if max(img.size) <= max_edge:
                # Still re-save, to drop EXIF (which can carry GPS).
                img.save(path, "JPEG", quality=86, optimize=True)
                return img.size
            ratio = max_edge / float(max(img.size))
            size = (round(img.size[0] * ratio), round(img.size[1] * ratio))
            img = img.resize(size, Image.LANCZOS)
            img.save(path, "JPEG", quality=86, optimize=True)
            return size
    except Exception as err:  # a corrupt download should not kill the run
        print("  ! could not process %s: %s" % (path.name, err), file=sys.stderr)
        return None


# ── Fetch ─────────────────────────────────────────────────────────────

def fetch_media(token, limit):
    items, url = [], API + "/me/media"
    params = {"fields": FIELDS, "access_token": token, "limit": min(limit, 100)}

    while url and len(items) < limit:
        payload = get_json(url, params)
        items.extend(payload.get("data", []))
        nxt = payload.get("paging", {}).get("next")
        if not nxt:
            break
        # `next` is a complete URL; stop appending our own params to it.
        url, params = nxt.split("?")[0], dict(
            urllib.parse.parse_qsl(urllib.parse.urlparse(nxt).query)
        )

    return items[:limit]


def flatten(items, include_video):
    """One post can hold several files. Turn the tree into a flat list."""
    out = []
    for post in items:
        kind = post.get("media_type", "")
        stamp = post.get("timestamp", "")
        caption = clean_caption(post.get("caption"))
        link = post.get("permalink", "")

        if kind == "CAROUSEL_ALBUM":
            children = (post.get("children") or {}).get("data") or []
            for i, child in enumerate(children):
                out.append(make_entry(child, post["id"], i, caption, stamp, link,
                                      include_video))
        else:
            out.append(make_entry(post, post["id"], None, caption, stamp, link,
                                  include_video))

    return [e for e in out if e]


def make_entry(node, post_id, index, caption, stamp, link, include_video):
    kind = node.get("media_type", "IMAGE")
    is_video = kind in ("VIDEO", "REELS")

    if is_video and not include_video:
        return None

    url = node.get("media_url")
    if not url:
        return None  # copyrighted or flagged media comes back without a URL

    name = post_id if index is None else "%s-%d" % (post_id, index)
    return {
        "id": name,
        "video": is_video,
        "url": url,
        "poster_url": node.get("thumbnail_url") if is_video else None,
        "caption": caption,
        "timestamp": stamp,
        "permalink": link,
    }


# ── Writing ───────────────────────────────────────────────────────────

HEADER = """# ──────────────────────────────────────────────────────────────
#  GENERATED FILE — do not edit by hand.
#
#  Written by scripts/sync_instagram.py, which runs from
#  .github/workflows/instagram.yml. Anything you put here is lost on
#  the next sync.
#
#  Hand-picked photos go in _data/photos.yml instead. The gallery shows
#  those first, then these.
#
#  Last sync: %s
# ──────────────────────────────────────────────────────────────
"""


def write_data(entries):
    lines = [HEADER % datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")]

    for e in entries:
        year = (e["timestamp"] or "")[:4]
        alt = e["caption"] or "A photograph from Instagram"
        lines.append("")
        lines.append("- src       : %s/%s" % (SITE_PATH, e["file"]))
        if e["video"]:
            lines.append("  type      : video")
            lines.append("  video     : %s/%s" % (SITE_PATH, e["file"]))
            if e.get("poster_file"):
                lines.append("  poster    : %s/%s" % (SITE_PATH, e["poster_file"]))
        lines.append("  alt       : %s" % yaml_str(alt))
        if e["caption"]:
            lines.append("  caption   : %s" % yaml_str(e["caption"]))
        if year:
            lines.append("  year      : %s" % year)
        if e["permalink"]:
            lines.append("  permalink : %s" % yaml_str(e["permalink"]))

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


# ── Main ──────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Sync Instagram media into the site.")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and report, but write nothing")
    ap.add_argument("--limit", type=int, default=24)
    ap.add_argument("--videos", action="store_true",
                    help="include videos and reels (large files)")
    ap.add_argument("--prune", action="store_true",
                    help="delete local files no longer in the feed")
    ap.add_argument("--max-edge", type=int, default=1600)
    args = ap.parse_args()

    token = os.environ.get("IG_ACCESS_TOKEN", "").strip()
    if not token:
        print("IG_ACCESS_TOKEN is not set.", file=sys.stderr)
        print("Locally:  export IG_ACCESS_TOKEN=...", file=sys.stderr)
        print("In CI:    repository Secrets. See docs/instagram.md.", file=sys.stderr)
        return 1

    print("Fetching up to %d posts..." % args.limit)
    posts = fetch_media(token, args.limit)
    print("  %d posts returned" % len(posts))

    entries = flatten(posts, args.videos)
    images = sum(1 for e in entries if not e["video"])
    videos = sum(1 for e in entries if e["video"])
    print("  %d images, %d videos%s" %
          (images, videos, "" if args.videos else " (videos skipped; pass --videos)"))

    if not entries:
        print("Nothing to sync. Leaving everything alone.")
        return 0

    if args.dry_run:
        print("\n--- dry run: nothing written ---")
        for e in entries[:10]:
            print("  %-22s %-5s %s" % (
                e["id"], "video" if e["video"] else "image",
                e["caption"][:48] or "(no caption)"))
        if len(entries) > 10:
            print("  ... and %d more" % (len(entries) - 10))
        print("\nWould write %s" % DATA_FILE.relative_to(ROOT))
        print("Would store files in %s" % MEDIA_DIR.relative_to(ROOT))
        return 0

    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    keep, fresh, total_bytes = set(), 0, 0

    for e in entries:
        ext = ".mp4" if e["video"] else ".jpg"
        e["file"] = e["id"] + ext
        dest = MEDIA_DIR / e["file"]
        keep.add(e["file"])

        if not dest.exists():
            print("  + %s" % e["file"])
            size = download(e["url"], dest)
            if not e["video"]:
                shrink(dest, args.max_edge)
                size = dest.stat().st_size
            total_bytes += size
            fresh += 1

        if e["video"] and e.get("poster_url"):
            e["poster_file"] = e["id"] + "-poster.jpg"
            poster = MEDIA_DIR / e["poster_file"]
            keep.add(e["poster_file"])
            if not poster.exists():
                download(e["poster_url"], poster)
                shrink(poster, args.max_edge)

    if args.prune:
        for path in MEDIA_DIR.iterdir():
            if path.is_file() and path.name not in keep:
                print("  - %s" % path.name)
                path.unlink()

    write_data(entries)

    print("\n%d new file(s), %.1f MB downloaded" % (fresh, total_bytes / 1e6))
    print("Wrote %s (%d entries)" % (DATA_FILE.relative_to(ROOT), len(entries)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
