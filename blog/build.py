#!/usr/bin/env python3
"""
8-bit Blog — Static Site Builder
Usage: python build.py
Reads .md files from posts/, generates index.html + individual post pages.
"""

import os
import re
import html
from pathlib import Path
from datetime import datetime

# ─── Config ────────────────────────────────────────────────────
BLOG_TITLE   = "BLOG"
BLOG_SUB     = "a minimal 8-bit journal"
POSTS_DIR    = Path("posts")
OUTPUT_DIR   = Path(".")         # index.html lives at root
POST_OUT_DIR = Path("posts")     # posts/slug.html alongside .md

# ─── Markdown → HTML (tiny built-in converter, no deps) ───────
def md_to_html(md: str) -> str:
    """Minimal markdown-to-HTML. Handles the basics."""
    lines = md.split('\n')
    out = []
    in_code = False
    in_list = False
    in_blockquote = False
    bq_lines = []

    def flush_bq():
        nonlocal in_blockquote, bq_lines
        if in_blockquote:
            content = inline('\n'.join(bq_lines))
            # handle line breaks within blockquote
            content = content.replace('\n', '<br>')
            out.append(f'<blockquote><p>{content}</p></blockquote>')
            in_blockquote = False
            bq_lines = []

    def flush_list():
        nonlocal in_list
        if in_list:
            out.append('</ul>')
            in_list = False

    for line in lines:
        # fenced code blocks
        if line.strip().startswith('```'):
            if in_code:
                out.append('</code></pre>')
                in_code = False
            else:
                flush_bq()
                flush_list()
                lang = line.strip()[3:]
                out.append(f'<pre><code>')
                in_code = True
            continue
        if in_code:
            out.append(html.escape(line))
            continue

        # blank line
        if line.strip() == '':
            flush_bq()
            flush_list()
            continue

        # blockquote
        if line.startswith('>'):
            flush_list()
            text = line[1:].strip()
            if text.startswith(' '): text = text
            in_blockquote = True
            bq_lines.append(text)
            continue
        else:
            flush_bq()

        # headings
        m = re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            flush_list()
            level = len(m.group(1))
            out.append(f'<h{level}>{inline(m.group(2))}</h{level}>')
            continue

        # horizontal rule
        if re.match(r'^(-{3,}|_{3,}|\*{3,})$', line.strip()):
            flush_list()
            out.append('<hr>')
            continue

        # unordered list
        m = re.match(r'^[\-\*]\s+(.*)', line)
        if m:
            if not in_list:
                out.append('<ul>')
                in_list = True
            out.append(f'<li>{inline(m.group(1))}</li>')
            continue

        # paragraph
        flush_list()
        out.append(f'<p>{inline(line)}</p>')

    flush_bq()
    flush_list()
    if in_code:
        out.append('</code></pre>')

    return '\n'.join(out)


def inline(text: str) -> str:
    """Handle bold, italic, code, links, images."""
    # images
    text = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'<img src="\2" alt="\1">', text)
    # links
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    # bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'__(.+?)__', r'<strong>\1</strong>', text)
    # italic
    text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
    text = re.sub(r'_(.+?)_', r'<em>\1</em>', text)
    # inline code
    text = re.sub(r'`(.+?)`', lambda m: f'<code>{html.escape(m.group(1))}</code>', text)
    return text


# ─── Frontmatter parser ──────────────────────────────────────
def parse_post(filepath: Path) -> dict | None:
    raw = filepath.read_text(encoding='utf-8')
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', raw, re.DOTALL)
    if not m:
        return None
    meta_raw, body = m.group(1), m.group(2)

    meta = {}
    for line in meta_raw.strip().split('\n'):
        k, _, v = line.partition(':')
        meta[k.strip()] = v.strip()

    slug = filepath.stem
    return {
        'title': meta.get('title', slug),
        'date':  meta.get('date', ''),
        'slug':  slug,
        'body':  body.strip(),
        'html':  md_to_html(body.strip()),
    }


# ─── Read CSS once ────────────────────────────────────────────
CSS_TEXT = Path("style.css").read_text(encoding='utf-8') if Path("style.css").exists() else ""

# ─── HTML Templates ──────────────────────────────────────────
def page_wrapper(title: str, body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
{CSS_TEXT}
</style>
</head>
<body>
{body_html}
</body>
</html>"""


def build_index(posts: list[dict]) -> str:
    items = ""
    for p in posts:
        items += f"""<li>
  <a href="posts/{p['slug']}.html">
    <span class="post-title">{html.escape(p['title'])}</span>
    <span class="post-date">{p['date']}</span>
  </a>
</li>\n"""

    body = f"""
<header>
  <h1><a href="index.html">{BLOG_TITLE}</a></h1>
  <div class="subtitle">{BLOG_SUB}</div>
</header>

<ul class="post-list">
{items}
</ul>

<footer>{BLOG_TITLE} &copy; {datetime.now().year} <span class="blink">_</span></footer>
"""
    return page_wrapper(BLOG_TITLE, body)


def build_post(p: dict) -> str:
    body = f"""
<a class="back" href="../index.html">BACK</a>

<article>
  <h1>{html.escape(p['title'])}</h1>
  <div class="post-meta">{p['date']}</div>
  {p['html']}
</article>

<footer>{BLOG_TITLE} <span class="blink">_</span></footer>
"""
    return page_wrapper(p['title'], body)


# ─── Build ────────────────────────────────────────────────────
def main():
    md_files = sorted(POSTS_DIR.glob("*.md"), reverse=True)
    posts = []
    for f in md_files:
        p = parse_post(f)
        if p:
            posts.append(p)

    # sort by date descending
    posts.sort(key=lambda p: p['date'], reverse=True)

    # write index
    (OUTPUT_DIR / "index.html").write_text(build_index(posts), encoding='utf-8')
    print(f"✓ index.html ({len(posts)} posts)")

    # write individual posts
    for p in posts:
        out = POST_OUT_DIR / f"{p['slug']}.html"
        out.write_text(build_post(p), encoding='utf-8')
        print(f"  ✓ posts/{p['slug']}.html")

    print("\nDone! Open index.html in your browser.")


if __name__ == "__main__":
    main()
