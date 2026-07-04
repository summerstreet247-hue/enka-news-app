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
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen

OUTPUT_PATH = "data.json"
MAX_ITEMS = 200
TIMEOUT_SECONDS = 15
USER_AGENT = "Mozilla/5.0 (compatible; EnkaNewsBot/1.0; +personal use)"

# artist -> 表示名やキーワード（タイトルから該当アーティストを判定するのに使う）
ARTISTS = {
    "青山新": ["青山新"],
    "二見颯一": ["二見颯一"],
    "真田ナオキ": ["真田ナオキ"],
}

# 上記3名の専用フィードは artist を決め打ち、
# enka.work のような一般ポータルは None にして
# タイトルから自動判定（分からなければ汎用ラベル）にする
FEEDS = [
    # (artist_label_or_None, category, feed_url)
    ("青山新", "news", "http://rssblog.ameba.jp/aoyamashin2020/rss20.xml"),
    ("二見颯一", "news", "http://rssblog.ameba.jp/futamisoichi1026/rss20.xml"),
    ("二見颯一", "news", "https://www.youtube.com/feeds/videos.xml?channel_id=UCtyckgoaOUloMfpnCKKW4Gg"),
    ("真田ナオキ", "news", "http://rssblog.ameba.jp/naoki0427sanada/rss20.xml"),
    (None, "news", "https://enka.work/feed/"),
]

GENERIC_ARTIST_LABEL = "演歌ニュース"

# これより古い情報は基本的に載せない（ただし件数のためではなく、
# 明らかに無関係な過去の情報が混ざるのを防ぐための緩やかな上限）
MAX_AGE_DAYS = 365


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
        artist = default_artist or guess_artist(title, allow_generic=True)
        html_body = fields.get("encoded") or fields.get("description") or ""
        items.append({
            "category": guess_category(title, category),
            "artist": artist,
            "headline": title,
            "url": link,
            "date": date,
            "image": extract_image(html_body),
        })
    return items


def parse_atom(root, default_artist, category):
    items = []
    for entry in root.iter():
        if strip_ns(entry.tag) != "entry":
            continue
        title, link, published, image = "", "", "", None
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
        for descendant in entry.iter():
            if strip_ns(descendant.tag) == "thumbnail":
                image = descendant.attrib.get("url")
                break
        date = parse_date_guess(published)
        artist = default_artist or guess_artist(title, allow_generic=True)
        items.append({
            "category": guess_category(title, category),
            "artist": artist,
            "headline": title,
            "url": link,
            "date": date,
            "image": image,
        })
    return items


IMG_TAG_PATTERN = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
IMG_SRC_PATTERN = re.compile(r'src=["\']([^"\']+)["\']', re.IGNORECASE)
IMG_SIZE_PATTERN = re.compile(r'(width|height)=["\']?(\d+)', re.IGNORECASE)
BAD_IMAGE_HINTS = ("icon", "editor_link", ".svg", "avatar", "emoji", "banner")


def extract_image(html: str):
    """本文HTMLから、記事内容を表す実写真らしき画像のURLを1つ抜き出す。
    アイコンや小さな装飾画像（絵文字・リンクアイコン等）は除外する。
    見つからなければ None を返し、その記事は画像なしで表示される。"""
    if not html:
        return None
    for tag in IMG_TAG_PATTERN.findall(html):
        src_match = IMG_SRC_PATTERN.search(tag)
        if not src_match:
            continue
        src = src_match.group(1)
        if any(hint in src.lower() for hint in BAD_IMAGE_HINTS):
            continue
        sizes = {key.lower(): int(value) for key, value in IMG_SIZE_PATTERN.findall(tag)}
        if sizes.get("width", 999) < 60 or sizes.get("height", 999) < 60:
            continue
        return src
    return None


BRACKET_PATTERN = re.compile(r"^[【\[](.{1,12}?)[】\]]")
DASH_PATTERN = re.compile(r"^(.{1,12}?)\s*[－–—-]\s*")


def guess_artist(title: str, allow_generic: bool = False):
    """タイトル文字列からアーティスト名を判定する。

    既知の3名（青山新・二見颯一・真田ナオキ）に一致すればその名前を返す。
    一般ポータル（enka.work等）由来で誰の記事か分からない場合、
    allow_generic=True なら「【名前】」「名前 – 」のような表記から
    それっぽい名前を抜き出すか、汎用ラベルにフォールバックする
    （＝対象を3名に限定せず、若手演歌の情報を広く拾うため）。
    """
    for artist, keywords in ARTISTS.items():
        if any(kw in title for kw in keywords):
            return artist

    if not allow_generic:
        return None

    match = BRACKET_PATTERN.match(title) or DASH_PATTERN.match(title)
    if match:
        candidate = match.group(1).strip()
        if candidate:
            return candidate

    return GENERIC_ARTIST_LABEL


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

    # 一定期間より古いものは「新着」として不自然なので除外してから、
    # 新しい順に並べて上限件数に切り詰める
    cutoff = (datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)).date().isoformat()
    recent_items = [it for it in all_items if it["date"] >= cutoff]
    recent_items.sort(key=lambda x: x["date"], reverse=True)
    return recent_items[:MAX_ITEMS]


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
