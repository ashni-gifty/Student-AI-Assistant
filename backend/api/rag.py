import collections
import re

import chromadb
from django.conf import settings
from docx import Document as Docx
from pypdf import PdfReader

from .models import Chunk

STOP = set("the and for that with this from are was were have has had not but you your can will which their there been into than then also such more most other some these those about when what where who how why".split())
_col = None


def collection():
    global _col
    if _col is None:
        client = chromadb.PersistentClient(path=str(settings.CHROMA_DIR))
        _col = client.get_or_create_collection("notes", metadata={"hnsw:space": "cosine"})
    return _col


def paginate(text, size=3000):
    return [(i + 1, text[s:s + size]) for i, s in enumerate(range(0, len(text), size))]


def extract(path, ext):
    if ext == "pdf":
        return [(i + 1, p.extract_text() or "") for i, p in enumerate(PdfReader(path).pages)]
    if ext == "docx":
        return paginate("\n".join(p.text for p in Docx(path).paragraphs))
    with open(path, encoding="utf-8", errors="ignore") as f:
        return paginate(f.read())


def split(text, size=900):
    parts, cur = [], ""
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        # very long lines (prose without line breaks) are cut at sentence ends
        pieces = re.split(r"(?<=[.!?])\s+", line) if len(line) > size else [line]
        for piece in pieces:
            if cur and len(cur) + len(piece) > size:
                parts.append(cur.strip())
                cur = ""
            cur += piece + "\n"
    if cur.strip():
        parts.append(cur.strip())
    return parts


def keywords(text, n=3):
    words = re.findall(r"[A-Za-z]{5,}", text.lower())
    return [w for w, _ in collections.Counter(w for w in words if w not in STOP).most_common(n)]


SEP = re.compile(r"^[\s\-=_*~#.]{3,}$")


def heading_lines(text, limit=6):
    """Real headings only: ALL CAPS lines, titles, lines before ----- and 'Label: values' lines."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    out = []
    for i, l in enumerate(lines):
        if SEP.match(l):
            continue
        prev = lines[i - 1] if i else ""
        under = i + 1 < len(lines) and bool(SEP.match(lines[i + 1]))
        starts = l[0].isupper() or l[0].isdigit() or l[0] in "[#"
        fresh = i == 0 or bool(SEP.match(prev)) or prev[-1] in ".!?:]"
        caps = l.isupper() and len(l) >= 3
        label = ":" in l[:30]
        if len(l) <= 100 and starts and l[-1] not in ".,;" and len(l.split()) <= 16 and (caps or under or fresh or label):
            out.append(l.lstrip("# ").strip()[:90])
        if len(out) == limit:
            break
    return out


def heading_full(text):
    hs = heading_lines(text) or [" ".join(text.split()[:10])]
    kw = keywords(text) if len(hs) < 2 else []
    return " / ".join(hs) + (f" [{', '.join(kw)}]" if kw else "")


def heading(text):
    return heading_full(text)[:200]


def ingest(doc, ext):
    ids, texts, metas, n = [], [], [], 0
    for page, text in extract(doc.file.path, ext):
        for piece in split(text):
            Chunk.objects.create(document=doc, page=page, idx=n, heading=heading(piece), text=piece)
            ids.append(f"{doc.id}-{n}")
            texts.append(piece)
            metas.append({"doc": doc.id, "user": doc.user_id, "page": page, "name": doc.name})
            n += 1
    for i in range(0, len(ids), 100):
        collection().add(ids=ids[i:i + 100], documents=texts[i:i + 100], metadatas=metas[i:i + 100])
    return n


def remove(doc_id):
    try:
        collection().delete(where={"doc": doc_id})
    except Exception:
        pass


def search(user, query, doc_ids=None, k=4):
    where = {"user": user.id}
    if doc_ids:
        where = {"$and": [{"user": user.id}, {"doc": {"$in": list(doc_ids)}}]}
    try:
        r = collection().query(query_texts=[query[:300]], n_results=k, where=where)
    except Exception:
        return []
    return [
        {"text": t[:settings.MAX_CHUNK_CHARS], "page": m["page"], "name": m["name"], "doc": m["doc"], "dist": d}
        for t, m, d in zip(r["documents"][0], r["metadatas"][0], r["distances"][0])
    ]
