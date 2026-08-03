#!/usr/bin/env python3
"""Build the printable File Handler API guide.

Reads the Markdown sources in this folder and writes a single PDF, using nothing
but the standard library — no reportlab, no wkhtmltopdf, no network. Run it from
anywhere:

    python3 make_api_pdf.py

Companion to ../Updatecancel-AS-API/make_api_pdf.py, which does the same job from
an HTML source. The PDF writer at the bottom is shared logic; only the parser
differs.
"""

from pathlib import Path
import re

HERE = Path(__file__).parent
SOURCES = [
    HERE / 'README.md',
    HERE / 'FileHandler-API.md',
    HERE / 'Integration-Notes.md',
]
OUT = HERE / 'FileHandler-API-Integration-Guide.pdf'
FOOTER = 'OPS File Handler API - Integration Guide'


# ── Markdown → blocks ────────────────────────────────────────────────────────

def parse(md: str):
    """Yield (kind, lines) where kind is title | h2 | h3 | code | body."""
    blocks = []
    in_code = False
    code: list[str] = []
    para: list[str] = []

    def flush_para():
        if para:
            blocks.append(('body', [' '.join(para)]))
            para.clear()

    for line in md.split('\n'):
        if line.startswith('```'):
            if in_code:
                blocks.append(('code', code[:]))
                code.clear()
            else:
                flush_para()
            in_code = not in_code
            continue
        if in_code:
            code.append(line)
            continue

        stripped = line.strip()
        if not stripped:
            flush_para()
        elif stripped.startswith('# '):
            flush_para()
            blocks.append(('title', [stripped[2:]]))
        elif stripped.startswith('## '):
            flush_para()
            blocks.append(('h2', [stripped[3:]]))
        elif stripped.startswith('### '):
            flush_para()
            blocks.append(('h3', [stripped[4:]]))
        elif set(stripped) <= set('-|: ') and stripped.startswith('|'):
            pass                                    # table rule row
        elif stripped.startswith('|'):
            flush_para()
            cells = [c.strip() for c in stripped.strip('|').split('|')]
            blocks.append(('body', ['  '.join(cells)]))
        elif stripped.startswith(('- ', '* ', '> ')) or re.match(r'^\d+\. ', stripped):
            flush_para()
            blocks.append(('body', ['- ' + re.sub(r'^([-*>]|\d+\.)\s+', '', stripped)]))
        elif set(stripped) <= set('-=') and len(stripped) > 2:
            flush_para()                            # horizontal rule
        else:
            para.append(stripped)
    flush_para()
    if code:
        blocks.append(('code', code))
    return blocks


def demark(s: str) -> str:
    """Strip the inline Markdown that would only be noise in print."""
    s = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', s)
    s = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', s)
    s = s.replace('**', '').replace('`', '')
    return s


# ── Text helpers ─────────────────────────────────────────────────────────────

SUBS = {
    '→': '->', '←': '<-', '—': '-', '–': '-', '≥': '>=', '≤': '<=', '·': '-',
    '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...', '□': '[ ]', '✅': '[x]',
    '⚠️': '[!]', '×': 'x',
}


def clean(s: str) -> str:
    for a, b in SUBS.items():
        s = s.replace(a, b)
    return s.encode('latin-1', 'replace').decode('latin-1')


def wrap(text: str, width: int):
    out, line = [], ''
    for word in text.split(' '):
        while len(word) > width:
            if line:
                out.append(line)
                line = ''
            out.append(word[:width])
            word = word[width:]
        if word and len(line) + len(word) + (1 if line else 0) <= width:
            line += (' ' if line else '') + word
        elif word:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out or ['']


def esc(s: str) -> str:
    return '(' + clean(s).replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)') + ')'


# ── Layout ───────────────────────────────────────────────────────────────────

items = []
for src in SOURCES:
    if not src.exists():
        raise SystemExit(f'missing source: {src}')
    items += parse(src.read_text(encoding='utf-8'))

W, H, left, top, bottom = 595, 842, 45, 790, 48
pages: list[list] = []
current: list = []
y = top
page_no = 1


def new_page():
    global current, y, page_no
    if current:
        current.append(('Helvetica', 7, left, 27, f'{FOOTER}    Page {page_no}'))
        pages.append(current)
        page_no += 1
    current = []
    y = top


def put(font, size, text, leading):
    global y
    if y - leading < bottom:
        new_page()
    current.append((font, size, left, y, text))
    y -= leading


for kind, raw in items:
    if kind == 'title':
        if current:
            new_page()
        for line in raw:
            for part in wrap(clean(demark(line)), 42):
                put('Helvetica-Bold', 21, part, 25)
        y -= 8
    elif kind == 'h2':
        if y < 150:
            new_page()
        y -= 8
        for line in raw:
            for part in wrap(clean(demark(line)), 62):
                put('Helvetica-Bold', 14, part, 18)
    elif kind == 'h3':
        y -= 4
        for line in raw:
            for part in wrap(clean(demark(line)), 78):
                put('Helvetica-Bold', 10.5, part, 14)
    elif kind == 'code':
        y -= 2
        for rawline in raw:
            line = clean(rawline.expandtabs(2))
            chunks = [line[i:i + 90] for i in range(0, len(line), 90)] or ['']
            for part in chunks:
                put('Courier', 7.1, part, 9)
        y -= 3
    else:
        for line in raw:
            for part in wrap(clean(demark(line)), 88):
                put('Helvetica', 8.8, part, 12)
        y += 1
new_page()


# ── PDF writer ───────────────────────────────────────────────────────────────

objects: list[str] = []


def obj(data: str) -> int:
    objects.append(data)
    return len(objects)


font_body = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
font_bold = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
font_code = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')

page_ids, content_ids = [], []
for page in pages:
    stream = ['q', '0.12 0.18 0.24 rg']
    for font, size, x, yy, text in page:
        f = '/F2' if 'Bold' in font else '/F3' if font == 'Courier' else '/F1'
        stream += ['BT', f'{f} {size} Tf', f'{x} {yy} Td', f'{esc(text)} Tj', 'ET']
    stream.append('Q')
    body = '\n'.join(stream).encode('latin-1', 'replace')
    content_ids.append(obj(f'<< /Length {len(body)} >>\nstream\n{body.decode("latin-1")}\nendstream'))
    page_ids.append(obj(''))

pages_id = obj('')
for pid, cid in zip(page_ids, content_ids):
    objects[pid - 1] = (
        f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {W} {H}] '
        f'/Resources << /Font << /F1 {font_body} 0 R /F2 {font_bold} 0 R /F3 {font_code} 0 R >> >> '
        f'/Contents {cid} 0 R >>'
    )
objects[pages_id - 1] = (
    f'<< /Type /Pages /Kids [{" ".join(str(x) + " 0 R" for x in page_ids)}] /Count {len(page_ids)} >>'
)
catalog_id = obj(f'<< /Type /Catalog /Pages {pages_id} 0 R >>')

out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
offsets = [0]
for i, data in enumerate(objects, 1):
    offsets.append(len(out))
    out += f'{i} 0 obj\n{data}\nendobj\n'.encode('latin-1', 'replace')
xref = len(out)
out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
for off in offsets[1:]:
    out += f'{off:010d} 00000 n \n'.encode()
out += f'trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()

OUT.write_bytes(out)
print(f'created {OUT} ({len(pages)} pages)')
