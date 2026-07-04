"""
若手演歌歌手最新ニュース！ 用のデータ収集スクリプト。

RSSフィードを情報源として data.json を生成する。
サイト構造への依存を最小限にするため、HTMLスクレイピングではなく
公式に配信されているRSS/Atomフィードだけを使う方針にしている
（サイトのリニューアルで壊れにくく、規約上も安全なため）。
"""

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.request import Request, urlopen

OUTPUT_PATH = "data.json"
MAX_ITEMS = 20
TIMEOUT_SECONDS = 15
USER_AGENT = "Mozilla/5.0 (compatible; EnkaNewsBot/1.0; +personal use)"

# artist -> 表示名やキーワード（enka.workの記事タイトル絞り込みに使う）
ARTISTS = {
    "青山新": ["青山新"],
    "二見颯一": ["二見颯一"],
    "真田ナオキ": ["真田ナオキ"],
}

FEEDS = [
    # (artist_label_or_None, category, feed_url)
    ("二見颯一", "news", "http://rssblog.ameba.jp/futamisoichi1026/rss20.xml"),
    ("二見颯一", "news", "https://www.youtube.com/feeds/videos.xml?channel_id=UCtyckgoaOUloMfpnCKKW4Gg"),
    ("真田ナオキ", "news", "http://rssblog.ameba.jp/naoki0427sanada/rss20.xml"),
    (None, "news", "https://enka.work/feed/"),
]


def fetch(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=TIMEOUT_SECONDS) as res:
        return res.read()


def strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def parse_rss2(root, default_artist, category):
    items = []
    for item in root.iter():
        if strip_ns(item.tag) != "item":
            continue
        fields = {strip_ns(c.tag): (c.text or "").strip() for c in item}
        title = fields.get("title", "")
        link = fields.get("link", "")
        pub_date = fields.get("pubDate", "")
        date = parse_date_guess(pub_date)
        artist = default_artist or guess_artist(title)
        if not artist:
            continue
        items.append({
            "category": guess_category(title, category),
            "artist": artist,
            "headline": title,
            "url": link,
            "date": date,
        })
    return items


def parse_atom(root, default_artist, category):
    items = []
    for entry in root.iter():
        if strip_ns(entry.tag) != "entry":
            continue
        title, link, published = "", "", ""
        for child in entry:
            name = strip_ns(child.tag)
            if name == "title":
                title = (child.text or "").strip()
            elif name == "link":
                href = child.attrib.get("href")
                if href and (not link or child.attrib.get("rel") == "alternate"):
                    link = href
            elif name == "published":
                published = (child.text or "").strip()
        date = parse_date_guess(published)
        artist = default_artist or guess_artist(title)
        if not artist:
            continue
        items.append({
            "category": guess_category(title, category),
            "artist": artist,
            "headline": title,
            "url": link,
            "date": date,
        })
    return items


def guess_artist(title: str):
    for artist, keywords in ARTISTS.items():
        if any(kw in title for kw in keywords):
            return artist
    return None


SINGLE_KEYWORDS = ["新曲", "デビュー", "リリース", "発売", "アルバム", "配信開始"]
LIVE_KEYWORDS = ["ライブ", "コンサート", "ツアー", "公演", "ディナーショー", "リサイタル"]


def guess_category(title: str, fallback: str) -> str:
    """タイトルの言葉づかいから、新曲/ライブ/ニュースを判定する。
    フィード側で決め打ちにすると実態と合わないことが多いため、
    タイトルのキーワードを優先する。"""
    if any(kw in title for kw in SINGLE_KEYWORDS):
        return "single"
    if any(kw in title for kw in LIVE_KEYWORDS):
        return "live"
    return fallback


def parse_date_guess(raw: str) -> str:
    if not raw:
        return datetime.now(timezone.utc).date().isoformat()
    fmts = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%S%z",
    ]
    for fmt in fmts:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    return datetime.now(timezone.utc).date().isoformat()


def collect() -> list:
    all_items = []
    for artist, category, url in FEEDS:
        try:
            raw = fetch(url)
            root = ET.fromstring(raw)
        except Exception as exc:  # noqa: BLE001 - one broken source must not break the whole run
            print(f"[skip] {url}: {exc}")
            continue

        if strip_ns(root.tag) == "feed":
            all_items.extend(parse_atom(root, artist, category))
        else:
            all_items.extend(parse_rss2(root, artist, category))

    # 新しい順に並べ、上限件数に切り詰める
    all_items.sort(key=lambda x: x["date"], reverse=True)
    return all_items[:MAX_ITEMS]


def main():
    items = collect()
    data = {
        "updatedAt": datetime.now(timezone.utc).astimezone().isoformat(),
        "items": items,
    }

    if items:
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"OK: wrote {len(items)} items to {OUTPUT_PATH}")
    else:
        # 何も取れなかった時は data.json を壊さない（前回分をそのまま残す）
        print("WARN: no items collected — leaving existing data.json untouched")


if __name__ == "__main__":
    main()
