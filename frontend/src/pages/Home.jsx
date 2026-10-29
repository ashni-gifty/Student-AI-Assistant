import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Quiz, Rich, useDocs } from "../components";

const QUOTES = {
  morning: [
    "A calm hour of focus now is worth three tired ones tonight.",
    "Start with the topic you like least. The rest of the day gets easier.",
    "You do not need a perfect plan, only a first page.",
  ],
  afternoon: [
    "Keep going. Small sessions add up faster than you think.",
    "Review what you learned this morning and it will stay with you.",
    "One more chapter, then a proper break. You have earned both.",
  ],
  evening: [
    "Finish the day by revising one thing you found hard.",
    "Steady effort tonight makes tomorrow lighter.",
    "A short review before dinner beats a long panic later.",
  ],
  night: [
    "Revise lightly, then sleep. Your memory sorts things out while you rest.",
    "Ten focused minutes tonight is still progress.",
    "Close the books on time. A rested mind remembers more.",
  ],
};
const CARDS = [
  ["/documents", "Upload Documents", "Add your PDF, text or Word notes."],
  ["/chat", "Ask Questions", "Chat with your notes and get page references."],
  ["/summarize", "Summarize", "Get short revision notes in seconds."],
  ["/mcqs", "Generate MCQS", "Test yourself and find weak topics."],
];

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return ["Good morning", "morning"];
  if (h >= 12 && h < 17) return ["Good afternoon", "afternoon"];
  if (h >= 17 && h < 21) return ["Good evening", "evening"];
  return ["Good night", "night"];
}
const STEP_NAMES = {
  search_notes: "Searched your notes", list_topics: "Checked your topics", web_research: "Searched the web",
  make_summary: "Wrote revision notes", make_quiz: "Built a quiz",
};

export default function Home({ user }) {
  const [hello, period] = greeting();
  const list = QUOTES[period];
  const quote = list[new Date().getDate() % list.length];
  const [docs] = useDocs();
  const [docId, setDocId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(""); setRes(null);
    try {
      setRes(await api("/agent/", { method: "POST", body: { message: text, document_id: docId || null } }));
      setRound((n) => n + 1);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const practice = async (topics) => {
    setError("");
    try {
      const r = await api("/mcq/", { method: "POST", body: {
        document_id: res.doc_id, count: 10, topics, web_query: res.quiz_web ? res.web_query : null } });
      setRes((p) => ({ ...p, quiz: r.questions }));
      setRound((n) => n + 1);
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <section className="hero">
        <h1>{hello}, {user}</h1>
        <p className="quote">{quote}</p>
      </section>
      <div className="grid4">
        {CARDS.map(([to, title, text]) => (
          <Link className="panel card" to={to} key={to}><h3>{title}</h3><p className="muted">{text}</p></Link>
        ))}
      </div>
      <section className="panel">
        <h3>Study with your assistant</h3>
        <p className="muted small"><br></br>Try: "I have a Python exam tomorrow. Prepare me." If the subject is not in your selected document, the assistant says so and uses the web.</p>
        <div className="row">
          <select value={docId} onChange={(e) => setDocId(e.target.value)}>
            <option value="">Latest document</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Type your message" />
          <button className="primary" onClick={send} disabled={busy}>{busy ? "Working..." : "Send"}</button>
        </div>
        {error && <p className="note">{error}</p>}
        {res && (
          <div className="result">
            {res.steps.length > 0 && (
              <p className="muted small">What I did: {[...new Set(res.steps)].map((s) => STEP_NAMES[s] || s).join(", then ")}</p>
            )}
            <Rich text={res.reply} />
            {res.web?.length > 0 && (
              <p className="src">Web sources:
                {res.web.map((w) => <a key={w.url} href={w.url} target="_blank" rel="noreferrer">{w.title}</a>)}
              </p>
            )}
            {res.summary && <div className="panel"><Rich text={res.summary} /></div>}
            {res.quiz && <Quiz key={round} questions={res.quiz} onWeak={practice} />}
          </div>
        )}
      </section>
    </>
  );
}