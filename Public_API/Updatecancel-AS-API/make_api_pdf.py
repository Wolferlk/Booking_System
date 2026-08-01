from html.parser import HTMLParser
from pathlib import Path
import re

SRC = Path(__file__).with_name('AS-Quotation-API-Integration-Guide.html')
OUT = Path(__file__).with_name('AS-Quotation-API-Integration-Guide.pdf')

class Extractor(HTMLParser):
    def __init__(self):
        super().__init__(); self.blocks=[]; self.buf=[]; self.tag=''; self.skip=0; self.pre=False
    def handle_starttag(self, tag, attrs):
        if tag in ('style','script'): self.skip += 1
        if tag == 'pre': self.flush(); self.tag='pre'; self.pre=True
        elif tag in ('h1','h2','h3','p','li','tr'): self.flush(); self.tag=tag
        elif tag in ('th','td') and self.tag == 'tr' and self.buf: self.buf.append(' | ')
    def handle_endtag(self, tag):
        if tag in ('style','script'): self.skip=max(0,self.skip-1)
        if tag == 'pre' and self.pre: self.flush(); self.pre=False
        elif tag in ('h1','h2','h3','p','li','tr'): self.flush()
    def handle_data(self, data):
        if not self.skip: self.buf.append(data)
    def flush(self):
        if not self.buf or self.skip: self.buf=[]; return
        text=''.join(self.buf); self.buf=[]
        if self.pre:
            self.blocks.append(('pre', text.replace('\r','').split('\n'))); return
        text=re.sub(r'\s+',' ',text).strip()
        if text:
            if self.tag == 'li': text='• '+text
            self.blocks.append((self.tag or 'p',[text]))

def clean(s):
    for a,b in {'→':'->','—':'-','–':'-','≥':'>=','□':'[ ]','✅':'[x]','⚠️':'[!]','…':'...'}.items(): s=s.replace(a,b)
    return s.encode('latin-1','replace').decode('latin-1')

def wrap(text, width):
    out=[]; line=''
    for word in text.split(' '):
        while len(word)>width:
            if line: out.append(line); line=''
            out.append(word[:width]); word=word[width:]
        if word and len(line)+len(word)+(1 if line else 0)<=width: line += (' ' if line else '')+word
        elif word: out.append(line); line=word
    if line: out.append(line)
    return out or ['']

def esc(s): return '('+clean(s).replace('\\','\\\\').replace('(','\\(').replace(')','\\)')+')'

ex=Extractor(); ex.feed(SRC.read_text(encoding='utf-8'))
items=[]
for kind, lines in ex.blocks:
    items.append(('code' if kind=='pre' else 'title' if kind=='h1' else kind if kind in ('h2','h3') else 'body', lines))

W,H,left,top,bottom=595,842,45,790,48
pages=[]; current=[]; y=top; page_no=1
def new_page():
    global current,y,page_no
    if current:
        current.append(('Helvetica',7,left,27,f'AppleSystem - OPS Quotation API Integration Guide    Page {page_no}')); pages.append(current); page_no+=1
    current=[]; y=top
def put(font,size,text,leading):
    global y
    if y-leading<bottom: new_page()
    current.append((font,size,left,y,text)); y-=leading

for kind,raw in items:
    if kind=='title':
        if current: new_page()
        for line in raw:
            for part in wrap(clean(line),42): put('Helvetica-Bold',21,part,25)
        y-=8
    elif kind=='h2':
        if y<150: new_page()
        y-=8
        for line in raw:
            for part in wrap(clean(line),62): put('Helvetica-Bold',14,part,18)
    elif kind=='h3':
        y-=4
        for line in raw:
            for part in wrap(clean(line),78): put('Helvetica-Bold',10.5,part,14)
    elif kind=='code':
        y-=2
        for rawline in raw:
            line=clean(rawline.expandtabs(2))
            chunks=[line[i:i+90] for i in range(0,len(line),90)] or ['']
            for part in chunks: put('Courier',7.1,part,9)
        y-=3
    else:
        for line in raw:
            for part in wrap(clean(line),88): put('Helvetica',8.8,part,12)
        y+=1
new_page()

objects=[]
def obj(data): objects.append(data); return len(objects)
font_body=obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
font_bold=obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
font_code=obj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')
page_ids=[]; content_ids=[]
for page in pages:
    stream=['q','0.12 0.18 0.24 rg']
    for font,size,x,yy,text in page:
        f='/F2' if 'Bold' in font else '/F3' if font=='Courier' else '/F1'
        stream += ['BT',f'{f} {size} Tf',f'{x} {yy} Td',f'{esc(text)} Tj','ET']
    stream.append('Q'); raw='\n'.join(stream).encode('latin-1','replace')
    content_ids.append(obj(f'<< /Length {len(raw)} >>\nstream\n{raw.decode("latin-1")}\nendstream')); page_ids.append(obj(''))
pages_id=obj('')
for pid,cid in zip(page_ids,content_ids):
    objects[pid-1]=f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 {font_body} 0 R /F2 {font_bold} 0 R /F3 {font_code} 0 R >> >> /Contents {cid} 0 R >>'
objects[pages_id-1]=f'<< /Type /Pages /Kids [{" ".join(str(x)+" 0 R" for x in page_ids)}] /Count {len(page_ids)} >>'
catalog_id=obj(f'<< /Type /Catalog /Pages {pages_id} 0 R >>')
out=bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offsets=[0]
for i,data in enumerate(objects,1):
    offsets.append(len(out)); out+=f'{i} 0 obj\n{data}\nendobj\n'.encode('latin-1','replace')
xref=len(out); out+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
for off in offsets[1:]: out+=f'{off:010d} 00000 n \n'.encode()
out+=f'trailer\n<< /Size {len(objects)+1} /Root {catalog_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
OUT.write_bytes(out); print(f'created {OUT} ({len(pages)} pages)')
