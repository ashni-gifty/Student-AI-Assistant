"""Study agent: the LLM picks tools; we cap steps, validate inputs and keep tool output small."""
import json

from django.conf import settings

from . import llm, rag, services

MAX_STEPS = 6
TOOLS = [
    {"name": "search_notes",
     "description": "Check whether the student's notes cover a subject. ALWAYS call this first, with the subject the student named, for example 'Python'.",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "list_topics", "description": "List the topics (section headings) in the student's notes.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "web_research", "description": "Search the web for study material on a subject that is NOT in the notes.",
     "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"]}},
    {"name": "make_summary", "description": "Create revision notes from the notes document.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "make_quiz",
     "description": "Create multiple-choice practice questions. Only use when the student wants practice, a test or exam preparation. Set from_web to true when the subject is not in the notes.",
     "input_schema": {"type": "object", "properties": {"count": {"type": "integer"},
                      "topics": {"type": "array", "items": {"type": "string"}}, "from_web": {"type": "boolean"}}}},
]
SYSTEM = (
    "You are a friendly study agent. Follow these rules.\n"
    "1. Work out the subject the student named (for example Python) and call search_notes with it first.\n"
    "2. If search_notes says NOT IN NOTES, begin your reply by saying the selected document does not cover that subject, "
    "then call web_research and build the study help from the results and your own knowledge. "
    "Call make_quiz with from_web=true only if the student mentions an exam, test or practice.\n"
    "3. If the notes do cover it: call list_topics, make_summary, and make_quiz (10 questions) when an exam or practice is mentioned.\n"
    "4. Never summarize or quiz a document that does not cover the subject.\n"
    "5. Your final reply is a short study guide in markdown, 250 words at most, in this order: "
    "a '## ' title; one sentence saying what you used (the notes name, or the web); "
    "'### Your revision plan' with 4 to 6 numbered one-line steps; "
    "'### Study flow' with a fenced code block showing the topics in order joined by ' -> '; "
    "'### Key points' with a markdown table with columns Topic | What to remember | Example (4 to 6 rows); "
    "one short kind sentence to encourage. Put important terms in **bold**. No emoji. "
    "If a summary or quiz was created, say it appears below and do not repeat it."
)


def run_tool(user, doc, name, args, out):
    blocked = out["notes_ok"] is False
    no_notes = (f"Refused: the notes '{doc.name}' do not cover this subject. Use web_research instead.")
    try:
        if name == "search_notes":
            q = str(args.get("query", ""))[:200]
            good = [h for h in rag.search(user, q, [doc.id], k=3) if h["dist"] < settings.RELEVANCE_MAX]
            out["notes_ok"] = bool(good)
            if not good:
                return f"NOT IN NOTES. The document '{doc.name}' does not cover '{q}'. Do not summarize or quiz it. Use web_research."
            return "\n".join(f"p{h['page']}: {h['text'][:300]}" for h in good)
        if name == "list_topics":
            return no_notes if blocked else "\n".join(h for _, h in services.headings(doc, 25))[:1500]
        if name == "web_research":
            topic = str(args.get("topic", ""))[:150]
            res = llm.web_search(topic + " study guide", 5)
            out["web_query"] = topic
            out["web"] = [{"title": w["title"], "url": w["url"]} for w in res]
            return "\n".join(f"{w['title']}: {w['body']}" for w in res)[:2200] or "No web results. Use your own knowledge."
        if name == "make_summary":
            if blocked:
                return no_notes
            out["summary"] = services.summarize(doc)
            return "Summary created and shown to the student."
        if name == "make_quiz":
            topics = args.get("topics") if isinstance(args.get("topics"), list) else None
            if args.get("from_web"):
                if not out["web_query"]:
                    return "Call web_research first."
                out["quiz"] = services.quiz(user, doc, args.get("count", 10), topics, out["web_query"])
                out["quiz_web"] = True
            else:
                if blocked:
                    return no_notes
                out["quiz"] = services.quiz(user, doc, args.get("count", 10), topics)
            return f"Quiz of {len(out['quiz'])} questions created and shown to the student."
        return "Unknown tool."
    except Exception as e:
        return f"Tool failed: {str(e)[:150]}"


def run(user, doc, message):
    out = {"summary": None, "quiz": None, "quiz_web": False, "steps": [], "reply": "",
           "web": [], "web_query": None, "notes_ok": None}
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": message[:500]}]
    oai_tools = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                  "parameters": t["input_schema"]}} for t in TOOLS]
    for _ in range(MAX_STEPS):
        r = llm.client().chat.completions.create(
            model=settings.AGENT_MODEL, max_completion_tokens=1400, tools=oai_tools, messages=msgs,
            **llm.extra(settings.AGENT_MODEL))
        m = r.choices[0].message
        msgs.append(m.model_dump(exclude_none=True))
        if not m.tool_calls:
            out["reply"] = m.content or ""
            return out
        for tc in m.tool_calls:
            out["steps"].append(tc.function.name)
            try:
                args = json.loads(tc.function.arguments or "{}")
            except ValueError:
                args = {}
            msgs.append({"role": "tool", "tool_call_id": tc.id,
                         "content": run_tool(user, doc, tc.function.name, args, out)})
    out["reply"] = "I reached my step limit, so this is what I prepared so far."
    return out