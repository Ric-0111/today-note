#!/usr/bin/env python3
"""TODAY NOTE ニュース収集プログラム

RSSフィードからニュースを集めて、読みやすく整理し、data/ フォルダにJSONで保存します。
標準ライブラリだけで動くので、追加のインストールは要りません。APIキーも使いません。

やっていること
  1. 各RSSを取得して、記事（タイトル・概要・日時・リンク・画像）を取り出す
  2. 古い記事、スポーツ・芸能の記事を除く
  3. カテゴリを決める
  4. 同じ出来事を報じた記事を1つにまとめる（重複排除）
  5. 概要文を短く整え、むずかしい言葉には説明を付ける
  6. 重要度（★1〜3）をルールで決める
  7. data/ に保存する

注意：AIは使っていません。記事の全文も読んでいません。RSSに書かれている
タイトルと概要文だけを使い、書かれていないことは付け足しません。
"""

import argparse
import datetime as dt
import email.utils
import hashlib
import html
import json
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib.parse import urljoin
from pathlib import Path

JST = dt.timezone(dt.timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
UA = "TodayNoteBot/1.0 (+https://github.com/Ric-0111/today-note)"
CATEGORY_KEYS = [
    "domestic", "world", "politics", "economy", "society",
    "science", "tech", "business", "environment",
]

# ----------------------------------------------------------------------
# 1. 取得とXMLの読み取り
# ----------------------------------------------------------------------


def fetch(url, timeout=20, limit=3_000_000, truncate=False, want_type=False):
    if not re.match(r"^https?://", url):
        raise ValueError("http(s) 以外のアドレスは使えません")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/rss+xml, application/xml, text/xml, text/html, */*",
            "Accept-Language": "ja,en;q=0.5",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        data = res.read(limit + 1)
        ctype = res.headers.get("Content-Type", "")
    if len(data) > limit:
        if not truncate:
            raise ValueError("データが大きすぎます")
        data = data[:limit]
    return (data, ctype) if want_type else data


def to_utf8(data):
    """Shift_JIS や EUC-JP などで配信されるRSSも読めるように、UTF-8へそろえる"""
    head = data[:300].decode("ascii", errors="ignore")
    m = re.search(r'encoding=["\']([A-Za-z0-9_\-]+)["\']', head)
    enc = m.group(1).lower() if m else "utf-8"
    if enc in ("utf-8", "utf8", "us-ascii", "iso-8859-1"):
        return data
    try:
        text = data.decode(enc, errors="replace")
    except LookupError:
        return data
    text = re.sub(r'encoding=["\'][^"\']+["\']', 'encoding="utf-8"', text, count=1)
    return text.encode("utf-8")


def parse_xml(data):
    data = to_utf8(data)
    # 危険な「外部エンティティ」を含むXMLは読まない（安全のため）
    if b"<!ENTITY" in data:
        raise ValueError("安全でないXMLのため読み込みません")
    return ET.fromstring(data)


def local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def children(e, name):
    return [c for c in e if local(c.tag) == name]


def first_text(e, *names):
    for n in names:
        for c in children(e, n):
            t = "".join(c.itertext()).strip()
            if t:
                return t
    return ""


def entry_link(e):
    fallback = ""
    for c in children(e, "link"):
        href = (c.get("href") or "").strip()
        txt = (c.text or "").strip()
        if href and c.get("rel", "alternate") == "alternate":
            return href
        if txt:
            fallback = fallback or txt
    if fallback:
        return fallback
    g = first_text(e, "guid", "id")
    return g if g.startswith("http") else ""


def clean_image_url(u):
    u = (u or "").strip()
    if u.startswith("//"):
        u = "https:" + u
    if u.startswith("http://"):
        u = "https://" + u[len("http://"):]
    if not u.startswith("https://"):
        return ""
    if re.search(r"(1x1|pixel|spacer|blank)\.", u, re.I):
        return ""
    return u


def entry_image(e, raw_html):
    for c in e.iter():
        if local(c.tag) == "thumbnail" and c.get("url"):
            u = clean_image_url(c.get("url"))
            if u:
                return u
    for c in e.iter():
        n = local(c.tag)
        url = c.get("url") or ""
        if n == "content" and url:
            looks_image = (
                c.get("medium") == "image"
                or "image" in (c.get("type") or "")
                or re.search(r"\.(jpe?g|png|webp|gif)(\?|$)", url, re.I)
            )
            if looks_image:
                u = clean_image_url(url)
                if u:
                    return u
        if n == "enclosure" and "image" in (c.get("type") or ""):
            u = clean_image_url(url)
            if u:
                return u
    m = re.search(r"<img[^>]+src=[\"']([^\"']+)", raw_html or "", re.I)
    return clean_image_url(m.group(1)) if m else ""


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = email.utils.parsedate_to_datetime(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=JST)
        return d
    except Exception:
        pass
    s2 = s.replace("Z", "+00:00")
    if re.match(r"\d{4}-\d{2}-\d{2} \d", s2):
        s2 = s2.replace(" ", "T", 1)
    s2 = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", s2)
    try:
        d = dt.datetime.fromisoformat(s2)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=JST)
    return d


def strip_html(s):
    s = re.sub(r"(?is)<(script|style).*?</\1>", "", s or "")
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = s.replace("　", " ")
    return re.sub(r"[ \t\r\n]+", " ", s).strip()


def read_feed(feed):
    """1つのRSSから記事の一覧を取り出す（失敗したら例外）"""
    if feed.get("file"):  # テスト用：手元のファイルを読む
        data = Path(feed["file"]).read_bytes()
    else:
        data = fetch(feed["url"])
    root = parse_xml(data)
    entries = [e for e in root.iter() if local(e.tag) in ("item", "entry")]
    out = []
    for e in entries:
        title = strip_html(first_text(e, "title"))
        link = entry_link(e)
        raw_desc = first_text(e, "description", "summary", "encoded", "content")
        # Atom/RSS どちらでも「本文っぽいもの」があれば画像探しに使う
        pub = parse_date(first_text(e, "pubDate", "date", "published", "updated", "issued"))
        if not title or not link.startswith("http"):
            continue
        out.append(
            {
                "title": title,
                "url": link,
                "raw_desc": raw_desc,
                "published": pub,
                "image": entry_image(e, raw_desc),
            }
        )
    return out


# ----------------------------------------------------------------------
# 1.5 記事ページの「紹介文」と「画像」を読む
#     RSSに概要がない記事のために、記事ページに書かれている紹介文（og:description など）を使う。
#     配信元が自分で書いた文章を、そのまま短く整えるだけで、こちらで文章を作ることはしない。
# ----------------------------------------------------------------------


class MetaParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        a = dict(attrs)
        key = (a.get("property") or a.get("name") or "").lower()
        content = a.get("content")
        if key and content and key not in self.meta:
            self.meta[key] = content


def decode_html(data, ctype):
    m = re.search(r"charset=([\w\-]+)", ctype or "", re.I)
    enc = m.group(1) if m else None
    if not enc:
        m2 = re.search(rb"<meta[^>]+charset=[\"']?([\w\-]+)", data[:3000], re.I)
        enc = m2.group(1).decode("ascii", "ignore") if m2 else "utf-8"
    try:
        return data.decode(enc, errors="replace")
    except LookupError:
        return data.decode("utf-8", errors="replace")


def fetch_page_meta(url):
    data, ctype = fetch(url, timeout=10, limit=400_000, truncate=True, want_type=True)
    text = decode_html(data, ctype)
    head = text.split("</head>", 1)[0]
    parser = MetaParser()
    try:
        parser.feed(head)
    except Exception:
        pass
    meta = parser.meta
    desc = meta.get("og:description") or meta.get("description") or meta.get("twitter:description") or ""
    img = meta.get("og:image") or meta.get("twitter:image") or ""
    return {"description": strip_html(desc), "image": clean_image_url(urljoin(url, img)) if img else ""}


def enrich(items, budget=80, workers=6):
    """概要や画像がない記事について、記事ページから補う（1回の実行で最大 budget 件）"""
    targets = [i for i in items if not i.get("checked") and (not i.get("summary") or not i.get("image"))]
    targets.sort(key=lambda i: (bool(i.get("summary")), -int(i.get("importance", 1))))
    targets = targets[:budget]
    if not targets:
        return

    def work(it):
        try:
            return it, fetch_page_meta(it["url"])
        except Exception as ex:
            return it, {"error": type(ex).__name__}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(work, targets))

    # どの記事でも同じ紹介文・同じ画像（サイト全体の説明やロゴ）は、記事の内容ではないので使わない
    dcount = Counter(norm(r.get("description", "")) for _, r in results if r.get("description"))
    icount = Counter(r.get("image", "") for _, r in results if r.get("image"))
    got_s = got_i = errors = 0
    for it, r in results:
        it["checked"] = True
        if "error" in r:
            errors += 1
            continue
        d = r.get("description", "")
        # 紹介文が、その記事のタイトルと言葉をほとんど共有していなければ、記事の内容とは言えないので使わない
        related = len(bigrams(norm_title(it["title"])) & bigrams(norm_title(d))) >= 3
        if d and related and dcount[norm(d)] < 2 and not it.get("summary"):
            s = make_summary(d, it["title"])
            if s:
                it["summary"] = s
                got_s += 1
        im = r.get("image", "")
        if im and icount[im] < 2 and not it.get("image") and not re.search(r"logo|default|noimage|no_image|dummy", im, re.I):
            it["image"] = im
            got_i += 1
    print(f"記事ページから補完：{len(targets)}件を確認 → 概要 {got_s}件 / 画像 {got_i}件 を追加（開けなかった記事 {errors}件）")


# ----------------------------------------------------------------------
# 2. 文章を整える
# ----------------------------------------------------------------------

CREDIT_RE = re.compile(
    r"[（(](共同通信|時事通信|ロイター|AFP|AP|読売新聞|朝日新聞|毎日新聞|産経新聞|日本経済新聞|NHK)[^）)]*[）)]"
)
NOISE = ["続きを読む", "記事全文", "全文を読む", "詳細はこちら", "[続きを読む]", "…続き"]

# 意味が変わらない、安全な言いかえだけを使います
EASY = [
    ("更に", "さらに"), ("既に", "すでに"),
    ("概ね", "おおむね"), ("凡そ", "およそ"), ("但し", "ただし"), ("予め", "あらかじめ"),
    ("敢えて", "あえて"), ("暫く", "しばらく"), ("極めて", "とても"),
]


def norm(s):
    return unicodedata.normalize("NFKC", s or "").lower()


def clean_title(t):
    t = strip_html(t)
    t = re.sub(r"\s*[-－|｜]\s*(朝日新聞デジタル|毎日新聞|産経ニュース|時事ドットコム|NHK.*|Yahoo!ニュース)$", "", t)
    return t[:120]


def make_summary(desc, title, max_chars=110, max_sentences=3):
    text = strip_html(desc)
    text = CREDIT_RE.sub("", text)
    for n in NOISE:
        text = text.replace(n, "")
    text = re.sub(r"^【[^】]{1,12}】", "", text).strip()
    nt, ns = norm(title), norm(text)
    if ns.startswith(nt) and nt:
        text = text[len(title):].lstrip(" 　、。:：-")
    if not text:
        return ""
    sentences = re.findall(r"[^。！？!?]+[。！？!?]?", text)
    out, total = [], 0
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if out and total + len(s) > max_chars:
            break
        out.append(s)
        total += len(s)
        if len(out) >= max_sentences:
            break
    summary = "".join(out).strip()
    if len(summary) > 150:
        cut = summary[:150]
        pos = max(cut.rfind("、"), cut.rfind("。"))
        summary = (cut[: pos + 1] if pos > 60 else cut) + ("" if cut.endswith("。") else "…")
    for a, b in EASY:
        summary = summary.replace(a, b)
    # タイトルとほぼ同じ内容や、極端に短いものは「概要なし」として扱う
    if len(summary) < 15 or norm(summary) in nt or nt in norm(summary) and len(summary) < len(title) + 10:
        return ""
    return summary


GLOSSARY = [
    ("政策金利", "日本銀行が決める、金利のもとになる基準の金利。上がると、ローンや預金の金利も動きやすくなります。"),
    ("利上げ", "金利を上げること。預金の利息は増えやすい一方、ローンの返済は増えやすくなります。"),
    ("利下げ", "金利を下げること。ローンの返済は軽くなりやすい一方、預金の利息は減りやすくなります。"),
    ("日銀", "日本銀行のこと。国の中央銀行で、お金の量や金利を調整して、物価の安定を目指します。"),
    ("円安", "円の価値が、外国のお金より低くなること。輸入品の値段が上がりやすくなります。"),
    ("円高", "円の価値が、外国のお金より高くなること。輸入品は安くなりやすい一方、輸出する企業には不利になりやすいです。"),
    ("インフレ", "物やサービスの値段が、全体的に上がり続けること。"),
    ("デフレ", "物やサービスの値段が、全体的に下がり続けること。"),
    ("GDP", "国内総生産。国の中で、一定の期間に新しく生み出された物やサービスの合計で、景気を見る目安です。"),
    ("日経平均", "日本を代表する225社の株価をもとにした、株価の平均の目安。"),
    ("関税", "外国から入ってくる品物にかかる税金。"),
    ("国債", "国が、お金を借りるために出す債券。"),
    ("補正予算", "すでに決まっている予算に、あとから付け足す予算。"),
    ("閣議決定", "内閣（首相と大臣たち）が会議を開いて、正式に決めること。"),
    ("内閣不信任", "国会が、内閣を信頼しないという意思を示すこと。可決されると、内閣は総辞職するか、衆議院を解散するかを選びます。"),
    ("解散", "衆議院の議員全員の任期を途中で終わらせて、選挙をやり直すこと。"),
    ("停戦", "戦っている双方が、戦いをいったん止めること。"),
    ("制裁", "国際的なルールに反した国などに対して、貿易やお金のやり取りを制限する対応。"),
    ("安保理", "国連安全保障理事会。世界の平和と安全に責任を持つ、国連の機関。"),
    ("NATO", "北大西洋条約機構。欧米などの国が、お互いを守るためにつくっている軍事同盟。"),
    ("G7", "日本、アメリカ、イギリス、フランス、ドイツ、イタリア、カナダの7か国。主要7か国とも呼ばれます。"),
    ("生成AI", "文章や画像などを、指示に応じてつくり出すAI（人工知能）。"),
    ("半導体", "スマホ、家電、車などの中で、計算や記憶を担う電子部品の材料や部品。"),
    ("サイバー攻撃", "ネットワークを通じて、コンピューターやシステムに侵入したり、止めたりする攻撃。"),
    ("ランサムウェア", "データを勝手に暗号化して、元に戻す代わりにお金を要求する、不正なプログラム。"),
    ("量子コンピューター", "量子の性質を使い、特別な計算を速く行えると期待されている、新しい種類のコンピューター。"),
    ("ワクチン", "病気にかかりにくくしたり、重くなるのを防いだりするために、あらかじめ接種する薬。"),
    ("iPS細胞", "体のいろいろな細胞に変わることができる、人工的につくられた細胞。"),
    ("線状降水帯", "発達した雨雲が列のように連なり、同じ場所に長い時間、強い雨を降らせる現象。"),
    ("特別警報", "数十年に一度の、重大な災害が起こるおそれが非常に高いときに出る、最も警戒すべき情報。"),
    ("津波警報", "津波で被害が出るおそれがあるときに出る警報。津波注意報より重い情報です。"),
    ("マグニチュード", "地震そのものの規模（大きさ）を表す数字。"),
    ("震度", "ある場所での、地震の揺れの強さ。0から7まであり、5と6には「弱」と「強」があります。"),
    ("温室効果ガス", "二酸化炭素など、地球を温める働きをする気体。"),
    ("脱炭素", "二酸化炭素の排出を、実質ゼロに近づけようという取り組み。"),
    ("COP", "気候変動への対策を話し合う、国連の国際会議。"),
    ("春闘", "毎年春に、労働組合が会社と、賃上げなどを話し合う交渉。"),
    ("最低賃金", "法律で決められた、これより低い時給で働かせてはいけない、というライン。"),
    ("M&A", "企業の合併や買収のこと。"),
    ("TOB", "株式公開買い付け。株を買い集めて、企業の経営権を得ようとする方法。"),
    ("IPO", "企業が初めて株式を公開して、株式市場で売買できるようにすること。"),
    ("少子化", "生まれる子どもの数が、減り続けること。"),
    ("AI", "人工知能。人のように学んだり、判断したりするコンピューターの技術。"),
]


# 別の意味でも使われる言葉は、文脈の言葉がそろったときだけ説明を付ける
GLOSSARY_CONTEXT = {
    "解散": ["衆議院", "衆院", "首相", "総選挙", "国会"],
    "制裁": ["国連", "経済制裁", "制裁措置", "ロシア", "北朝鮮", "イラン", "米国", "中国"],
}


def pick_glossary(text, limit=2):
    found, taken = [], []
    for term, expl in GLOSSARY:
        need = GLOSSARY_CONTEXT.get(term)
        if need and not any(w in text for w in need):
            continue
        if re.fullmatch(r"[A-Za-z0-9&]+", term):
            pat = r"(?<![A-Za-z0-9])" + re.escape(term) + r"(?![A-Za-z0-9])"
        else:
            pat = re.escape(term)
        m = re.search(pat, text)
        if not m:
            continue
        if any(term in t or t in term for t in taken):
            continue
        found.append(f"{term}：{expl}")
        taken.append(term)
        if len(found) >= limit:
            break
    return " ／ ".join(found)


# ----------------------------------------------------------------------
# 3. カテゴリ・除外・重要度（すべてルールベース）
# ----------------------------------------------------------------------

CAT_WORDS = {
    "environment": ["地震", "津波", "台風", "大雨", "豪雨", "噴火", "警報", "気象", "気候", "温暖化", "猛暑", "大雪", "洪水", "土砂", "避難", "脱炭素", "COP", "災害"],
    "politics": ["首相", "政府", "国会", "内閣", "与党", "野党", "議員", "大臣", "法案", "閣議", "選挙", "自民", "立憲", "維新", "公明", "国民民主", "知事", "官房長官"],
    "economy": ["株価", "日経平均", "円安", "円高", "為替", "金利", "日銀", "物価", "GDP", "景気", "賃上げ", "関税", "国債", "貿易", "インフレ", "利上げ", "利下げ", "財務"],
    "tech": ["AI", "人工知能", "生成AI", "半導体", "アプリ", "サイバー", "スマホ", "ロボット", "量子", "ChatGPT", "OpenAI", "ソフトウェア", "データセンター"],
    "science": ["研究", "実験", "医療", "病院", "ワクチン", "がん", "治療", "薬", "感染", "宇宙", "探査機", "ノーベル", "iPS", "ロケット"],
    "business": ["企業", "決算", "買収", "M&A", "新製品", "発売", "提携", "業績", "上場", "社長", "工場", "経営"],
    "world": ["米国", "アメリカ", "中国", "ロシア", "ウクライナ", "ガザ", "イスラエル", "韓国", "北朝鮮", "欧州", "EU", "NATO", "国連", "大統領", "首脳会談", "トランプ", "中東", "イラン", "台湾"],
    "society": ["逮捕", "容疑", "事件", "事故", "殺人", "裁判", "判決", "地裁", "高裁", "最高裁", "送検", "火災", "行方不明", "詐欺", "死亡"],
}

DROP_WORDS = [
    "プロ野球", "Jリーグ", "サッカー", "五輪", "オリンピック", "ドラフト", "優勝", "芸能", "俳優", "女優",
    "歌手", "ドラマ", "映画", "アイドル", "熱愛", "W杯", "ワールドカップ", "大相撲", "ゴルフ", "競馬", "箱根駅伝",
    "NBA", "MLB", "大谷", "テニス", "バスケ", "ラグビー", "紅白",
]

HIGH_WORDS = [
    "速報", "緊急", "震度", "津波", "ミサイル", "死者", "首相", "予算", "利上げ", "利下げ", "解散",
    "選挙", "停戦", "戦争", "大規模", "台風", "噴火", "物価", "賃金", "年金", "増税", "減税", "値上げ",
    "感染拡大", "サイバー攻撃", "辞任", "特別警報", "全国",
]


def has_word(text, w):
    if re.fullmatch(r"[A-Za-z0-9&]+", w):
        return re.search(r"(?<![A-Za-z0-9])" + re.escape(w) + r"(?![A-Za-z0-9])", text) is not None
    return w in text


def classify(title, summary, feed_cat):
    if feed_cat in CATEGORY_KEYS:
        return feed_cat
    scores = {}
    for cat, words in CAT_WORDS.items():
        s = 0
        for w in words:
            if has_word(title, w):
                s += 2
            elif has_word(summary, w):
                s += 1
        if s:
            scores[cat] = s
    if not scores:
        return "domestic"
    # 災害は、ほかの分類より優先する
    best = max(scores, key=lambda c: (scores[c] + (1 if c == "environment" else 0), c))
    return best


def importance_score(item, n_sources):
    text = item["title"] + " " + item.get("summary", "")
    score = 0
    if n_sources >= 3:
        score += 3
    elif n_sources == 2:
        score += 2
    hits = sum(1 for w in HIGH_WORDS if has_word(text, w))
    score += min(hits, 2)
    if item.get("_main"):
        score += 1
    return score


# ----------------------------------------------------------------------
# 4. 重複のまとめ
# ----------------------------------------------------------------------


def norm_title(t):
    t = norm(t)
    t = re.sub(r"【[^】]*】|\[[^\]]*\]|［[^］]*］", "", t)
    return re.sub(r"[\s\W_]+", "", t)


def bigrams(s):
    return {s[i: i + 2] for i in range(len(s) - 1)}


def tokens(s):
    return set(re.findall(r"[一-龥]{2,}|[ァ-ヶー]{3,}|[a-z0-9]{3,}", s))


def is_duplicate(a, b):
    """a, b は {'_nt': 正規化したタイトル, '_bg': bigram集合, '_tk': 語の集合}"""
    if not a["_nt"] or not b["_nt"]:
        return False
    inter = len(a["_bg"] & b["_bg"])
    dice = 2 * inter / (len(a["_bg"]) + len(b["_bg"]) or 1)
    if dice >= 0.55:
        return True
    shared = a["_tk"] & b["_tk"]
    return dice >= 0.3 and sum(len(t) for t in shared) >= 6


def prepare(item):
    nt = norm_title(item["title"])
    item["_nt"] = nt
    item["_bg"] = bigrams(nt)
    item["_tk"] = tokens(nt)
    return item


def cluster(items):
    clusters = []
    for it in items:
        for c in clusters:
            if any(it["url"] == m["url"] or is_duplicate(it, m) for m in c):
                c.append(it)
                break
        else:
            clusters.append([it])
    return clusters


# ----------------------------------------------------------------------
# 5. 保存済みデータ
# ----------------------------------------------------------------------


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def make_id(url):
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def public_item(it):
    return {k: v for k, v in it.items() if not k.startswith("_")}


# ----------------------------------------------------------------------
# メイン
# ----------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--feeds", default=str(ROOT / "scripts" / "feeds.json"))
    ap.add_argument("--data", default=str(ROOT / "data"))
    ap.add_argument("--now", help="テスト用：現在時刻を指定（例 2026-11-22T06:00:00+09:00）")
    ap.add_argument("--dry-run", action="store_true", help="保存せずに結果だけ表示する")
    ap.add_argument("--no-fetch", action="store_true", help="記事ページの確認をしない（テスト用）")
    args = ap.parse_args()

    conf = load_json(args.feeds, None)
    if not conf:
        print("feeds.json を読み込めませんでした", file=sys.stderr)
        return 1
    st = conf.get("settings", {})
    fresh_hours = float(st.get("fresh_hours", 30))
    max_items = int(st.get("max_items_per_day", 60))
    max_per_source = int(st.get("max_items_per_source_per_day", 12))
    max_three = int(st.get("max_three_star_per_day", 5))

    now = dt.datetime.fromisoformat(args.now) if args.now else dt.datetime.now(JST)
    today = now.astimezone(JST).date().isoformat()
    data_dir = Path(args.data)
    days_dir = data_dir / "days"

    # --- 取得 ---
    report, raw = [], []
    for feed in conf["feeds"]:
        name = feed["name"]
        entry = {"name": name, "url": feed.get("url", feed.get("file", "")), "ok": False, "items": 0, "error": ""}
        try:
            items = read_feed(feed)
            entry["ok"] = True
            entry["items"] = len(items)
            for it in items:
                it["_feed"] = feed
                raw.append(it)
        except Exception as ex:  # 1つのRSSが失敗しても、ほかは続ける
            entry["error"] = f"{type(ex).__name__}: {str(ex)[:120]}"
            print(f"::warning::{name} を取得できませんでした：{entry['error']}")
        report.append(entry)

    ok_count = sum(1 for r in report if r["ok"])
    print(f"取得できたRSS：{ok_count} / {len(report)}")
    for r in report:
        mark = "OK " if r["ok"] else "NG "
        print(f"  {mark}{r['name']:<14} {r['items']:>3}件  {r['error']}")
    if ok_count == 0:
        print("すべてのRSSを取得できなかったため、データは更新しません。", file=sys.stderr)
        return 1

    # --- すでに保存してある記事 ---
    existing_today = load_json(days_dir / f"{today}.json", {})
    existing_items = [i for i in existing_today.get("items", []) if isinstance(i, dict)]
    seen_ids = {i.get("id") for i in existing_items}
    prior = []  # 昨日・一昨日の記事（同じ話題を翌日に繰り返さないため）
    for d in range(1, 3):
        day = (dt.date.fromisoformat(today) - dt.timedelta(days=d)).isoformat()
        for i in load_json(days_dir / f"{day}.json", {}).get("items", []):
            if isinstance(i, dict) and not i.get("sample"):
                seen_ids.add(i.get("id"))
                prior.append(prepare({"title": i.get("title", ""), "url": i.get("url", "")}))
    existing_prepared = [prepare({"title": i.get("title", ""), "url": i.get("url", "")}) for i in existing_items]
    skip_against = prior + existing_prepared

    # --- 古い記事・対象外の記事を除く ---
    oldest = now - dt.timedelta(hours=fresh_hours)
    newest = now + dt.timedelta(minutes=15)
    candidates = []
    stats = {"no_date": 0, "old": 0, "dropped": 0, "seen": 0}
    for it in raw:
        feed = it["_feed"]
        pub = it["published"]
        if pub is None:
            stats["no_date"] += 1  # 日時が分からない記事は、新しさを保証できないので使わない
            continue
        if pub < oldest or pub > newest:
            stats["old"] += 1
            continue
        title = clean_title(it["title"])
        if any(w in title for w in DROP_WORDS):
            stats["dropped"] += 1
            continue
        item_id = make_id(it["url"])
        if item_id in seen_ids:
            stats["seen"] += 1
            continue
        summary = make_summary(it["raw_desc"], title)
        cand = {
            "id": item_id,
            "title": title,
            "summary": summary,
            "category": classify(title, summary, feed.get("category", "auto")),
            "source": feed["name"],
            "published": pub.astimezone(JST).isoformat(timespec="seconds"),
            "url": it["url"],
            "_main": bool(feed.get("main")),
            "_priority": int(feed.get("priority", 1)),
        }
        if it["image"]:
            cand["image"] = it["image"]
        prepare(cand)
        if any(is_duplicate(cand, p) for p in skip_against):
            stats["seen"] += 1
            continue
        candidates.append(cand)
    print(f"対象外：日時なし {stats['no_date']} / 古い {stats['old']} / スポーツ・芸能 {stats['dropped']} / 既出 {stats['seen']}")

    # --- 重複をまとめ、代表を選び、重要度を付ける ---
    new_items = []
    for group in cluster(candidates):
        group.sort(key=lambda m: (bool(m["summary"]), m["_priority"], len(m["summary"]), m["published"]), reverse=True)
        rep = dict(group[0])
        sources = {m["source"] for m in group}
        others, seen_src = [], {rep["source"]}
        for m in group[1:]:
            if m["source"] not in seen_src:
                seen_src.add(m["source"])
                others.append({"source": m["source"], "url": m["url"]})
        if others:
            rep["others"] = others
        if not rep.get("image"):  # 代表に画像がなければ、仲間の記事の画像を借りる
            for m in group:
                if m.get("image"):
                    rep["image"] = m["image"]
                    break
        rep["_main"] = any(m["_main"] for m in group)
        rep["_score"] = importance_score(rep, len(sources))
        new_items.append(rep)

    # 重要度：★★★は 5点以上、★★は 3点以上、それ以外は★。★★★は1日に最大 max_three 件まで
    new_items.sort(key=lambda m: (m["_score"], m["published"]), reverse=True)
    three = sum(1 for i in existing_items if i.get("importance") == 3)
    for it in new_items:
        s = it["_score"]
        imp = 3 if s >= 5 else 2 if s >= 3 else 1
        if imp == 3:
            if three >= max_three:
                imp = 2
            else:
                three += 1
        it["importance"] = imp

    # --- 概要や画像がない記事を、記事ページから補う。そのあとで用語の説明を付ける ---
    if not args.no_fetch:
        enrich(existing_items + new_items)
    for it in existing_items + new_items:
        gl = pick_glossary(it.get("title", "") + " " + it.get("summary", ""))
        if gl:
            it["glossary"] = gl
        else:
            it.pop("glossary", None)

    # --- 今日の分とまとめる ---
    merged = existing_items + [public_item(i) for i in new_items]
    merged.sort(key=lambda i: (i.get("importance", 1), i.get("published", "")), reverse=True)
    per_source, final = {}, []
    for it in merged:
        n = per_source.get(it.get("source"), 0)
        if n >= max_per_source:
            continue
        per_source[it.get("source")] = n + 1
        final.append(it)
        if len(final) >= max_items:
            break

    day_obj = {"date": today, "generated_at": now.astimezone(JST).isoformat(timespec="seconds"), "items": final}
    print(f"今日（{today}）のニュース：{len(final)}件（今回の追加 {len(new_items)}件）")

    if args.dry_run:
        for it in final[:15]:
            print(f"  {'★' * it['importance']:<3} [{it['category']}] {it['title']}  ({it['source']})")
        return 0

    # --- 保存 ---
    days_dir.mkdir(parents=True, exist_ok=True)
    if final:
        # 画面確認用のサンプルは、本物のデータができたら消す
        for p in days_dir.glob("*.json"):
            if load_json(p, {}).get("sample"):
                p.unlink()
        write_json(days_dir / f"{today}.json", day_obj)
        write_json(data_dir / "latest.json", day_obj)
    dates = []
    for p in sorted(days_dir.glob("*.json"), reverse=True):
        day = load_json(p, {})
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem) and day.get("items"):
            dates.append({"date": p.stem, "count": len(day["items"])})
    write_json(data_dir / "index.json", {"updated": day_obj["generated_at"], "dates": dates})
    write_json(data_dir / "status.json", {"generated_at": day_obj["generated_at"], "feeds": report})
    return 0


if __name__ == "__main__":
    sys.exit(main())
