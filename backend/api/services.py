from . import llm, rag
from .models import Chunk

SUMMARY_SYS = (
    "You write study summaries. You only see the section headings found in the student's document (titles, names, "
    "label lines), each tagged with its page. Base the summary strictly on those headings: use the exact names, tools, "
    "titles and topics that appear in them, and cover every major section. Ignore placeholders in square brackets. "
    "Never describe the document type or template; say what the document contains. "
    "Write 150 to 200 words. Start with a '## ' title, then 2 to 4 short '### ' subheadings, each followed by short "
    "sentences. Wrap the most important terms or sentences in single asterisks for italics. Do not invent details. No emoji."
)

MCQ_SYS = (
    "You write multiple-choice questions from study material. Return ONLY a JSON array. Each item: "
    '{"q": string, "options": [4 strings], "answer": index 0-3, "topic": short topic name, "explain": one sentence, '
    '"steps": [2 to 4 short strings showing how to solve it step by step], '
    '"ref": one short line from the material the question is based on, starting with its label, for example "Page 2: ..."}. No emoji.'
)


def headings(doc, limit=80, max_chars=8000):
    rows = list(Chunk.objects.filter(document=doc).order_by("idx").values_list("page", "text"))
    if len(rows) > limit:
        step = len(rows) / limit
        rows = [rows[int(i * step)] for i in range(limit)]
    out, used = [], 0
    for page, text in rows:
        h = rag.heading_full(text)
        if used + len(h) > max_chars:
            break
        out.append((page, h))
        used += len(h)
    return out


def summarize(doc):
    heads = "\n".join(f"- p{p}: {h}" for p, h in headings(doc))
    return llm.ask(SUMMARY_SYS, f"Document: {doc.name}\nHeadings:\n{heads}", 600)

def quiz(user, doc, count=10, topics=None, web_query=None):
    count = max(1, min(int(count), 50))    
    ctx = []
    if web_query:  # subject is not in the notes: use a few short web snippets
        q = (web_query + " " + " ".join(str(t) for t in (topics or [])[:3]))[:200]
        ctx = [{"label": w["title"][:40], "text": w["body"]} for w in llm.web_search(q, 5)]
    elif topics:
        seen = set()
        for t in [str(t)[:80] for t in topics[:5]]:
            for h in rag.search(user, t, [doc.id], k=2):
                if h["text"] not in seen:
                    seen.add(h["text"])
                    ctx.append({"label": f"Page {h['page']}", "text": h["text"]})
    else:
        chunks = list(Chunk.objects.filter(document=doc).order_by("idx"))
        n = max(8, min(count // 2 + 4, 20))   # bigger quizzes read a few more chunks, never the whole document
        step = max(1, len(chunks) // n)
        ctx = [{"label": f"Page {c.page}", "text": c.text} for c in chunks[::step][:n]]

    if not ctx:
        raise ValueError("No study material found for that topic.")
    notes = "\n\n".join(f"({h['label']}) {h['text'][:500]}" for h in ctx)
    extra = " The material may be short, so you may also use your own accurate knowledge of the subject." if web_query else ""
    raw = llm.ask_json(MCQ_SYS, f"Write {count} questions from this material.{extra}\n\n{notes}",
                       min(16000, 400 + 260 * count))
    out = []
    for q in raw:
        try:
            opts = [str(o) for o in q["options"]][:4]
            ans = int(q["answer"])
            if len(opts) == 4 and 0 <= ans < 4 and q["q"]:
                out.append({
                    "q": str(q["q"]), "options": opts, "answer": ans,
                    "topic": str(q.get("topic", "General"))[:60],
                    "explain": str(q.get("explain", ""))[:300],
                    "steps": [str(s)[:160] for s in (q.get("steps") or [])][:4],
                    "ref": str(q.get("ref", ""))[:220],
                })
        except (KeyError, TypeError, ValueError):
            continue
    if not out:
        raise ValueError("Could not build valid questions. Try again.")
    return out[:count]