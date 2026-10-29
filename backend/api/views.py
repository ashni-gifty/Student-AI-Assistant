import random
import re

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.mail import send_mail
from django.shortcuts import get_object_or_404
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import agent, llm, rag, services
from .models import Chat, Chunk, Document, Message, Summary

ALLOWED = {"pdf", "txt", "docx"}
MAX_UPLOAD = 20 * 1024 * 1024


def err(msg, code=400):
    return Response({"error": msg}, status=code)


def ai_msg(e):
    t = str(e).lower()
    if "insufficient_quota" in t or "no credits" in t or "429" in t:
        return "The OpenAI account has no credits left. Add credits in OpenAI Billing, then try again."
    if "invalid_api_key" in t or "401" in t:
        return "The OpenAI API key is invalid. Check OPENAI_API_KEY in backend/.env."
    return str(e)[:150]


def auth_payload(u):
    return Response({"token": Token.objects.get_or_create(user=u)[0].key, "name": u.username})


# ---------- auth ----------
@api_view(["POST"])
@permission_classes([AllowAny])
def register(req):
    name, pw, email = req.data.get("username", "").strip(), req.data.get("password", ""), req.data.get("email", "").strip()
    if len(name) < 3 or len(pw) < 6 or "@" not in email:
        return err("Use a name of 3+ characters, a valid email and a password of 6+ characters.")
    if User.objects.filter(username__iexact=name).exists():
        return err("That name is already taken.")
    return auth_payload(User.objects.create_user(name, email, pw))


@api_view(["POST"])
@permission_classes([AllowAny])
def login(req):
    u = authenticate(username=req.data.get("username", "").strip(), password=req.data.get("password", ""))
    return auth_payload(u) if u else err("Wrong name or password.", 401)


@api_view(["POST"])
@permission_classes([AllowAny])
def forgot(req):
    u = User.objects.filter(username__iexact=req.data.get("username", "").strip()).first()
    if u and u.email:
        code = f"{random.randint(0, 999999):06d}"
        cache.set(f"reset:{u.id}", code, 600)
        send_mail("Your reset code", f"Your Student AI Assistant reset code is {code}. It expires in 10 minutes.", None, [u.email])
    return Response({"ok": True})  # same answer whether or not the user exists


@api_view(["POST"])
@permission_classes([AllowAny])
def reset(req):
    u = User.objects.filter(username__iexact=req.data.get("username", "").strip()).first()
    pw = req.data.get("password", "")
    if not u or len(pw) < 6 or cache.get(f"reset:{u.id}") != str(req.data.get("code", "")).strip():
        return err("That code is wrong or has expired.")
    u.set_password(pw)
    u.save()
    cache.delete(f"reset:{u.id}")
    return Response({"ok": True})


# ---------- documents ----------
def doc_json(req, d):
    return {"id": d.id, "name": d.name, "size_mb": round(d.size / 1048576, 2),
            "created": d.created.isoformat(), "url": req.build_absolute_uri(d.file.url)}


def owned_doc(user, pk):
    return Document.objects.filter(user=user, id=pk).first() if pk else None


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def documents(req):
    if req.method == "GET":
        return Response([doc_json(req, d) for d in Document.objects.filter(user=req.user).order_by("-created")])
    f = req.FILES.get("file")
    if not f:
        return err("Choose a file to upload.")
    ext = f.name.rsplit(".", 1)[-1].lower() if "." in f.name else ""
    if ext not in ALLOWED:
        return err("Only .pdf, .txt and .docx files are allowed.")
    if f.size > MAX_UPLOAD:
        return err("Files must be 20 MB or smaller.")
    d = Document.objects.create(user=req.user, name=f.name, file=f, size=f.size)
    try:
        if rag.ingest(d, ext) == 0:
            raise ValueError("No readable text found. Scanned PDFs are not supported.")
    except Exception as e:
        rag.remove(d.id)
        d.file.delete()
        d.delete()
        return err(f"Could not read that file: {str(e)[:120]}")
    return Response(doc_json(req, d), status=201)


@api_view(["DELETE"])
def document_detail(req, pk):
    d = get_object_or_404(Document, id=pk, user=req.user)
    rag.remove(d.id)
    d.file.delete()
    d.delete()
    return Response(status=204)


# ---------- chat ----------
def msg_json(m):
    return {"id": m.id, "role": m.role, "content": m.content, "meta": m.meta, "created": m.created.isoformat()}


@api_view(["GET"])
def chats(req):
    return Response([{"id": c.id, "title": c.title, "document": c.document.name if c.document else "All documents",
                      "updated": c.updated.isoformat()} for c in Chat.objects.filter(user=req.user).order_by("-updated")])


@api_view(["GET", "DELETE"])
def chat_detail(req, pk):
    c = get_object_or_404(Chat, id=pk, user=req.user)
    if req.method == "DELETE":
        c.delete()
        return Response(status=204)
    return Response({"id": c.id, "document_id": c.document_id, "messages": [msg_json(m) for m in c.messages.order_by("id")]})


CHAT_SYS = (
    "You are a friendly study assistant. Use the context and the recent chat. Explain like a good teacher, step by step: "
    "define the idea, give the formula if there is one, then a short worked example. "
    "GRADING RULE: if the student's message looks like an answer to a question you asked in the recent chat "
    "(for example just a number or a short phrase), first work the question out yourself, then begin your reply with "
    "'Correct.' or 'Not quite.' and explain why. Never begin with 'No' or 'Yes' unless the student asked a yes or no question. "
    "Write formulas on their own line inside a fenced code block, for example LCM(a, b) = (a x b) / HCF(a, b). "
    "If a diagram helps, draw a small text diagram inside a fenced code block, and when a real picture would help "
    "add one line [[image: Wikipedia article title]]. Use a markdown table when comparing things. "
    "Put the key terms to remember in **bold**. Mention page numbers like (Page 3) only for facts taken from the notes. "
    "If the notes do not cover the question, say so in one short sentence and answer from the web results. "
    "End with one short, easy, encouraging sentence containing one emoji."
)
SMALL_SYS = ("You are a friendly study assistant. Reply to the student's small talk in one or two short, warm sentences. "
             "Use the recent chat to offer to carry on where they left off. At most one emoji.")

QUIZ_WORDS = re.compile(r"\b(quiz|mcqs?|multiple choice|test me|practice questions?)\b", re.I)
FILLER = re.compile(r"\b(give|me|a|an|the|some|please|make|create|generate|take|quiz|quizzes|mcqs?|multiple|choice|"
                    r"questions?|test|practice|on|about|for|of|from|my|notes|document|\d+)\b", re.I)
GREETING = re.compile(r"^\s*(hi+|hello+|hey+|good\s+(morning|afternoon|evening|night)|thanks?( you)?|thank u|ok(ay)?|cool|nice|bye)\W*$", re.I)
SUMMARY_WORDS = re.compile(r"\b(summari[sz]e|summary|recap)\b", re.I)
PAGE_NUM = re.compile(r"\bpage\s*(?:no\.?|number)?\s*(\d{1,4})\b", re.I)
NEXT_PAGE = re.compile(r"^\s*(next|continue|go on|carry on|next one)\W*$|\bnext\s+(page|section|part)\b", re.I)
PREV_PAGE = re.compile(r"^\s*(previous|prev|go back)\W*$|\b(previous|prev)\s+(page|section|part)\b", re.I)


def quiz_request(q):
    """Returns (count, topic) if the message asks for a quiz, otherwise None."""
    if not QUIZ_WORDS.search(q):
        return None
    m = re.search(r"\b(\d{1,2})\b", q)
    count = max(1, min(int(m.group(1)), 50)) if m else 5
    topic = re.sub(r"\s+", " ", FILLER.sub(" ", q)).strip(" .,?!")
    return count, topic[:80]


def finish(chat, um, content, meta):
    am = Message.objects.create(chat=chat, role="assistant", content=content, meta=meta)
    chat.save()
    return Response({"chat_id": chat.id, "user": msg_json(um), "assistant": msg_json(am)})


def pick_doc(user, doc, chat):
    """The selected document, else the one this chat was last talking about, else the newest upload."""
    if doc:
        return doc
    for m in chat.messages.filter(role="assistant").order_by("-id")[:6]:
        d = owned_doc(user, m.meta.get("doc_id"))
        if d:
            return d
    return chat.document or Document.objects.filter(user=user).order_by("-created").first()


def current_page(chat):
    for m in chat.messages.filter(role="assistant").order_by("-id")[:6]:
        if m.meta.get("page"):
            return m.meta["page"]
        if m.meta.get("sources"):
            return m.meta["sources"][0]["page"]
    return 0


def page_reply(user, chat, um, doc, q):
    d = pick_doc(user, doc, chat)
    pages = sorted(set(Chunk.objects.filter(document=d).values_list("page", flat=True))) if d else []
    if not pages:
        um.delete()
        return err("Upload a document first, then ask about its pages.")
    cur, last = current_page(chat), pages[-1]
    m = PAGE_NUM.search(q)
    target = int(m.group(1)) if m else (cur - 1 if PREV_PAGE.search(q) else cur + 1)
    meta = {"page": target, "doc_id": d.id}
    if target < 1:
        meta["page"] = cur
        return finish(chat, um, f"You are already at the first page of **{d.name}**.", meta)
    if target > last:
        meta["page"] = cur
        return finish(chat, um, f"That was the last page. **{d.name}** has {last} page(s). Ask for any page number to revisit it.", meta)
    if target not in pages:
        return finish(chat, um, f"**Page {target} of {last}** has no readable text. Say **next page** to continue.", meta)
    body = "\n".join(Chunk.objects.filter(document=d, page=target).order_by("idx").values_list("text", flat=True))[:3500]
    verb = "Summarize this page in short bullet points" if SUMMARY_WORDS.search(q) else "Explain this page clearly, step by step"
    answer = llm.ask(CHAT_SYS, f"Context:\n[{d.name}, Page {target}]\n{body}\n\nStudent's message: {verb}. (Page {target} of {last}.)", 1200)
    meta["sources"] = [{"name": d.name, "page": target}]
    return finish(chat, um, f"**Page {target} of {last}**\n\n{answer}\n\nSay **next page** to continue.", meta)


@api_view(["POST"])
def ask(req):
    q = str(req.data.get("question", "")).strip()[:800]
    if not q:
        return err("Type a question first.")
    doc = owned_doc(req.user, req.data.get("document_id"))
    chat = get_object_or_404(Chat, id=req.data["chat_id"], user=req.user) if req.data.get("chat_id") else \
        Chat.objects.create(user=req.user, document=doc, title=q[:60])
    history = [f"{m.role}: {m.content[:600]}" for m in chat.messages.order_by("-id")[:6]][::-1]
    um = Message.objects.create(chat=chat, role="user", content=q)

    try:
        qr = quiz_request(q)
        if qr:
            count, topic = qr
            qdoc = pick_doc(req.user, doc, chat)
            if not qdoc:
                um.delete()
                return err("Upload a document first, then ask for a quiz.")
            questions = services.quiz(req.user, qdoc, count, [topic] if topic else None)
            about = f" on {topic}" if topic else ""
            intro = (f"Here is a {len(questions)} question quiz{about} from {qdoc.name}. Choose an answer for every question, "
                     "then press Submit. If you get any wrong, I will show you how to solve them. You can do this! 😊")
            return finish(chat, um, intro, {"quiz": questions, "doc_id": qdoc.id})
        if GREETING.match(q):
            reply = llm.ask(SMALL_SYS, f"Recent chat:\n{chr(10).join(history)}\n\nStudent: {q}", 120)
            return finish(chat, um, reply, {})
        if PAGE_NUM.search(q) or NEXT_PAGE.search(q) or PREV_PAGE.search(q):
            return page_reply(req.user, chat, um, doc, q)
        if SUMMARY_WORDS.search(q) and len(q.split()) <= 8:
            d = pick_doc(req.user, doc, chat)
            if not d:
                um.delete()
                return err("Upload a document first, then ask for a summary.")
            text = services.summarize(d)
            Summary.objects.create(user=req.user, document=d, doc_name=d.name, text=text)
            return finish(chat, um, f"Here is the summary of **{d.name}**. It is also saved in Chat History, under Summaries.\n\n{text}",                          {"doc_id": d.id})
    except Exception as e:
        um.delete()
        return err(ai_msg(e), 502)
    
    try:
        search_q = llm.standalone(history, q)
    except Exception:
        search_q = q
    hits = rag.search(req.user, search_q, [doc.id] if doc else None, k=5)
    good = [h for h in hits if h["dist"] < settings.RELEVANCE_MAX]
    web = [] if good else llm.web_search(search_q)
    if good:
        ctx = "\n\n".join(f"[{h['name']}, Page {h['page']}]\n{h['text']}" for h in good)
    else:
        ctx = "Not found in the student's notes. Web results:\n\n" + "\n\n".join(f"[{w['title']}] {w['url']}\n{w['body']}" for w in web)
    prompt = (f"Recent chat:\n{chr(10).join(history)}\n\nContext:\n{ctx}\n\n"
              f"Student's message: {q}\n(Full meaning of the message: {search_q})")
    if not good:
        prompt += "\n\nSay this was not in the notes and the answer comes from the web."
    try:
        answer = llm.ask(CHAT_SYS, prompt, 1200)
    except Exception as e:
        um.delete()
        return err(ai_msg(e), 502)
    
    seen, sources = set(), []
    for h in good:
        if (h["name"], h["page"]) not in seen:
            seen.add((h["name"], h["page"]))
            sources.append({"name": h["name"], "page": h["page"]})
    return finish(chat, um, answer, {"sources": sources, "web": [{"title": w["title"], "url": w["url"]} for w in web],
                                     "doc_id": good[0]["doc"] if good else (doc.id if doc else None)})

# ---------- summary, quiz, agent ----------
def need_doc(req):
    return owned_doc(req.user, req.data.get("document_id"))


def summary_json(s):
    return {"id": s.id, "summary": s.text, "document_id": s.document_id, "doc_name": s.doc_name,
            "created": s.created.isoformat()}


@api_view(["POST"])
def summarize(req):
    d = need_doc(req)
    if not d:
        return err("Select a document first.")
    try:
        text = services.summarize(d)
    except Exception as e:
        return err(ai_msg(e), 502)
    return Response(summary_json(Summary.objects.create(user=req.user, document=d, doc_name=d.name, text=text)))


@api_view(["GET"])
def summaries(req):
    return Response([summary_json(s) for s in Summary.objects.filter(user=req.user).order_by("-created")[:50]])


@api_view(["GET", "DELETE"])
def summary_detail(req, pk):
    s = get_object_or_404(Summary, id=pk, user=req.user)
    if req.method == "DELETE":
        s.delete()
        return Response(status=204)
    return Response(summary_json(s))

@api_view(["POST"])
def mcq(req):
    d = need_doc(req)
    if not d:
        return err("Select a document first.")
    try:
        topics = req.data.get("topics") if isinstance(req.data.get("topics"), list) else None
        web_query = str(req.data.get("web_query") or "")[:150] or None
        return Response({"questions": services.quiz(req.user, d, req.data.get("count", 10), topics, web_query)})
    except Exception as e:
        return err(ai_msg(e), 502)
    

@api_view(["POST"])
def agent_view(req):
    d = need_doc(req) or Document.objects.filter(user=req.user).order_by("-created").first()
    msg = str(req.data.get("message", "")).strip()
    if not d:
        return err("Upload a document first so I can work from your notes.")
    if not msg:
        return err("Tell me what you want to study.")
    try:
        result = agent.run(req.user, d, msg)
        result["doc_id"] = d.id
        return Response(result)
    except Exception as e:
        return err(ai_msg(e), 502)

