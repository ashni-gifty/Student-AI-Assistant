import json
import re

from django.conf import settings
from openai import OpenAI

_client = None


def client():
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.OPENAI_API_KEY)
    return _client


def extra(model):
    """GPT-5/6 models need reasoning_effort set (required for tool calls). Older models reject it."""
    return {"reasoning_effort": "none"} if model.startswith(("gpt-6", "gpt-5")) else {}


def ask(system, prompt, max_tokens=700):
    r = client().chat.completions.create(
        model=settings.LLM_MODEL, max_completion_tokens=max_tokens, **extra(settings.LLM_MODEL),
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": prompt[:settings.MAX_PROMPT_CHARS]}],
    )
    return r.choices[0].message.content.strip()


def ask_json(system, prompt, max_tokens=2500):
    text = ask(system, prompt, max_tokens)
    match = re.search(r"\[.*\]", text, re.S)
    if not match:
        raise ValueError("The AI did not return valid JSON.")
    return json.loads(match.group(0))


def web_search(query, n=3):
    try:
        from ddgs import DDGS
        out = []
        for r in DDGS().text(query, max_results=n + 4):
            url = r.get("href", "")
            if "aclick" in url or "/y.js" in url or "ad_domain" in url:
                continue
            out.append({"title": r["title"], "url": url, "body": r["body"][:300]})
        return out[:n]
    except Exception:
        return []

def standalone(history, question):
    """Turn a follow-up like 'explain it' into a full question using the recent chat."""
    if not history:
        return question
    out = ask(
        "Rewrite the student's last question as one standalone question, using the chat to fill in "
        "what words like 'it' or 'that' refer to. Reply with the question only.",
        "Chat:\n" + "\n".join(history[-4:]) + f"\n\nLast question: {question}", 80)
    return out.strip().strip('"')[:300] or question
