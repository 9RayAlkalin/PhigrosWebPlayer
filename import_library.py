# -*- coding: utf-8 -*-
r"""谱面库导入：把 devcharts/*.pez 解包成 webplayer 可直接 load_chart 的目录树。

用法: py import_library.py [--no-clean]      （路径基于本文件，不依赖 cwd）

产物（**按歌曲共享资源**，不再每难度各存一份曲绘+音乐）:
  res/library/index.json                <- 清单
  res/library/<song>/music.ogg          <- 音频，每首歌只存一份（实测每歌内逐难度完全一致）
  res/library/<song>/image.png          <- 曲绘；仅当该歌所有难度曲绘一致时才有
  res/library/<song>/<DIFF>/chart.json  <- 谱面 JSON
  res/library/<song>/<DIFF>/info.json   <- info.yml 重整（name/level/music + 原字段）
  res/library/<song>/<DIFF>/postfx.json <- 内容 null（见下）
  res/library/<song>/<DIFF>/image.png   <- 仅当该歌曲绘不一致时才逐难度各存一份

清单条目:
  path   谱面目录（chart.json / info.json 在这里）
  asset  共享资源目录（music.ogg / image.png 在这里）；等于 path 时表示该谱自带资源
  cover  库卡片封面 URL（已按曲绘是否共享算好）

为什么这么分：同一首歌的 4 个难度以前各存一份 image.png + music.ogg，
29 个谱共 335 MB，其中约 90 MB 是纯重复（Petrichor 21 MB / Ametrine 17 MB ...）。
共享后曲绘+音乐只存一份；而且切难度时曲绘 URL 不变，浏览器直接命中缓存。

关于曲绘：实测**只有** WhatdoyouwantmorethanaHappyending 一个歌的 4 个难度曲绘各不相同
（鸽游给不同难度配了不同封面），所以那种情况退回逐难度各存一份，不丢东西、也不额外浪费。

.pez 就是 zip：info.yml + <song>.json + <song>.png + <song>.ogg（见 AGENTS.md devcharts 一节）。
postfx.json 内容写 `null`：load_json_or_null 走 200->null 而非 404->null，取值相同
（main.js fx_render 对 postfx==null 走 copy 早退），控制台不留 404 红字。
"""
import argparse
import collections
import glob
import hashlib
import io
import json
import os
import re
import shutil
import unicodedata
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
DEVCHARTS = os.path.join(ROOT, "devcharts")
RES = os.path.join(ROOT, "res")
LIB = os.path.join(RES, "library")
INDEX = os.path.join(LIB, "index.json")

DIFF_RANK = {"EZ": 0, "HD": 1, "IN": 2, "AT": 3, "SP": 4}
BUILTIN_S6 = os.path.join(RES, "s6")


def parse_yml(text):
    """info.yml 是扁平 key: value（值多为引号字符串），不用引第三方 yaml 库。"""
    out = {}
    for line in text.splitlines():
        if not line or line.lstrip().startswith("#") or ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
            v = v[1:-1]
        out[k] = v
    return out


def norm(s):
    """分组用的归一化键：NFC + 去空白。

    实测 devcharts 里 'Message.くるぶっこちゃん' 有两个长度不同的写法（16 / 17 字符，
    肉眼一样），不归一化就会把同一首歌拆成两组、共享不到资源。
    """
    return unicodedata.normalize("NFC", (s or "").strip())


def slugify(stem, used):
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", stem)
    s = re.sub(r"-{2,}", "-", s).strip(".-_")
    base = s or "chart"
    slug, n = base, 1
    while slug in used:
        n += 1
        slug = "%s-%d" % (base, n)
    used.add(slug)
    return slug


def split_stem(stem):
    """文件名 <song>-<DIFF> -> (song, DIFF)；对不上就整体当 song、难度从 level 里猜。"""
    if "-" in stem:
        song, _, diff = stem.rpartition("-")
        if diff.upper() in DIFF_RANK and song:
            return song, diff.upper()
    return stem, ""


def md5(data):
    return hashlib.md5(data).hexdigest()


def clean(force):
    """res/library 是纯派生物（AGENTS.md 明确写了「删了重跑导入即可」）。

    只在它带着我们自己的 index.json 标记时才删，否则拒绝（防手滑删错东西）。
    """
    if not os.path.isdir(LIB):
        return
    entries = set(os.listdir(LIB))
    looks_ours = "index.json" in entries
    if not looks_ours and not force:
        raise SystemExit(
            "res/library 里没有 index.json，不像本脚本的产物，已拒绝删除。\n"
            "确认无误就加 --force 重跑。")
    shutil.rmtree(LIB)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-clean", action="store_true",
                    help="不先删 res/library（会残留旧布局的目录）")
    ap.add_argument("--force", action="store_true",
                    help="即使 res/library 没有 index.json 也允许删除")
    args = ap.parse_args()

    pez = sorted(glob.glob(os.path.join(DEVCHARTS, "*.pez")))
    if not pez:
        raise SystemExit("no *.pez in %s" % DEVCHARTS)

    if not args.no_clean:
        clean(args.force)
    os.makedirs(LIB, exist_ok=True)

    # ---- 第一遍：解包到内存，按归一化后的 song 分组 ----
    groups = collections.OrderedDict()   # song_key -> {meta, [difficulty entries]}
    skipped = []
    for p in pez:
        stem = os.path.splitext(os.path.basename(p))[0]
        song_raw, diff = split_stem(stem)
        with zipfile.ZipFile(p) as z:
            names = z.namelist()
            jn = [n for n in names if n.endswith(".json")]
            pn = [n for n in names if n.endswith(".png")]
            on = [n for n in names if n.endswith(".ogg")]
            yn = [n for n in names if n.endswith((".yml", ".yaml"))]
            if not (jn and pn and on and yn):
                skipped.append((stem, "missing in zip: %s" % names))
                continue
            blob = {
                "chart": z.read(jn[0]),
                "image": z.read(pn[0]),
                "music": z.read(on[0]),
                "info": parse_yml(z.read(yn[0]).decode("utf-8")),
            }

        info = blob["info"]
        if not diff:
            m = re.match(r"\s*([A-Za-z]{2})\b", info.get("level", ""))
            diff = m.group(1).upper() if m else "?"
        if diff == "?":
            skipped.append((stem, "cannot tell difficulty"))
            continue

        key = norm(song_raw)
        g = groups.setdefault(key, {"song": song_raw, "items": []})
        g["items"].append({
            "diff": diff,
            "stem": stem,
            "chart": blob["chart"],
            "image": blob["image"],
            "music": blob["music"],
            "info": info,
            # 一歌多难度时曲绘可能不同（实测只有 HappyEnding），交给下面统一判定
            "image_md5": md5(blob["image"]),
        })
        g["items"].sort(key=lambda e: DIFF_RANK.get(e["diff"], 9))

    report = io.StringIO()
    entries = []
    used_slugs = set()

    # ---- 第二遍：落盘，一首歌一个目录 ----
    for key, g in groups.items():
        items = g["items"]
        song_slug = slugify(g["song"], used_slugs)
        song_dir = os.path.join(LIB, song_slug)
        os.makedirs(song_dir, exist_ok=True)

        # 音乐：实测每歌内逐难度字节一致，直接共享第一份
        musics = {md5(e["music"]) for e in items}
        if len(musics) > 1:
            report.write("WARN %s: music.ogg 逐难度不一致，退回逐难度各存一份\n"
                         % song_slug)
            share_music = False
        else:
            share_music = True
            with open(os.path.join(song_dir, "music.ogg"), "wb") as f:
                f.write(items[0]["music"])

        # 曲绘：只有全部一致才共享
        images = {e["image_md5"] for e in items}
        share_image = len(images) == 1
        if share_image:
            with open(os.path.join(song_dir, "image.png"), "wb") as f:
                f.write(items[0]["image"])
        else:
            report.write("NOTE %s: image.png 逐难度不同（%d 种），各存一份\n"
                         % (song_slug, len(images)))

        report.write("\n== %s  (%d 难度)  -> res/library/%s\n"
                     % (g["song"], len(items), song_slug))
        for e in items:
            dslug = slugify(e["diff"], set())          # DIFF 本身已安全
            cdir = os.path.join(song_dir, dslug)
            os.makedirs(cdir, exist_ok=True)
            with open(os.path.join(cdir, "chart.json"), "wb") as f:
                f.write(e["chart"])
            info = dict(e["info"])
            info["music"] = "music.ogg"                # 音频在 asset 目录，名字固定
            with open(os.path.join(cdir, "info.json"), "w", encoding="utf-8") as f:
                json.dump(info, f, ensure_ascii=False, indent=4)
            # 内容 null：让 load_json_or_null 走 200->null 而不是 404->null，
            # 结果值一样（fx_render !pf 早退），但控制台不留 404 红字。
            with open(os.path.join(cdir, "postfx.json"), "w", encoding="utf-8") as f:
                f.write("null\n")
            if not share_image:
                with open(os.path.join(cdir, "image.png"), "wb") as f:
                    f.write(e["image"])

            asset = "/res/library/" + song_slug
            if not share_music:
                with open(os.path.join(cdir, "music.ogg"), "wb") as f:
                    f.write(e["music"])
                asset = "/res/library/%s/%s" % (song_slug, dslug)
            entries.append({
                "path": "/res/library/%s/%s" % (song_slug, dslug),
                "asset": asset,
                "cover": ("%s/image.png" % asset) if (share_image or not share_music)
                         else ("%s/%s/image.png" % (song_slug, dslug)),
                "name": e["info"].get("name") or g["song"],
                "song": g["song"],
                "difficulty": e["diff"],
                "level": e["info"].get("level", ""),
                "composer": e["info"].get("composer", ""),
                "charter": e["info"].get("charter", ""),
            })
            report.write("   OK %-4s -> %s\n" % (e["diff"], cdir.replace(ROOT + os.sep, "")))

    for stem, why in skipped:
        report.write("SKIP %s  (%s)\n" % (stem, why))

    # ---- 内置演示谱（block shader 收工版用的那份）也进库 ----
    s6_info_path = os.path.join(BUILTIN_S6, "info.json")
    if os.path.isfile(s6_info_path):
        s6 = json.load(open(s6_info_path, encoding="utf-8"))
        m = re.match(r"\s*([A-Za-z]{2})\b", s6.get("level", ""))
        entries.append({
            "path": "/res/s6",
            "asset": "/res/s6",
            "cover": "/res/s6/image.png",
            "name": s6.get("name", "s6"),
            "song": "s6 (built-in)",
            "difficulty": m.group(1).upper() if m else "?",
            "level": s6.get("level", ""),
            "composer": "",
            "charter": "",
        })
        report.write("\nOK   built-in /res/s6\n")

    entries.sort(key=lambda e: (e["name"].lower(), DIFF_RANK.get(e["difficulty"], 9),
                                e["path"]))
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump({"charts": entries}, f, ensure_ascii=False, indent=2)

    def tree_bytes(p):
        t = 0
        for dp, _dn, fn in os.walk(p):
            for f in fn:
                t += os.path.getsize(os.path.join(dp, f))
        return t

    report.write("\ntotal=%d  index=%s\n" % (len(entries), INDEX))
    report.write("res/library total = %.1f MB\n" % (tree_bytes(LIB) / 1048576.0))
    with open(os.path.join(ROOT, "_import_report.txt"), "w", encoding="utf-8") as f:
        f.write(report.getvalue())
    print("imported %d charts -> res/library (%.1f MB)"
          % (len(entries), tree_bytes(LIB) / 1048576.0))


if __name__ == "__main__":
    main()