import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, fmtDate, fmtTime, uploadFile } from "../api";
import { Quiz, Rich, useDocs } from "../components";

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export default function Chat() {
  const [params, setParams] = useSearchParams();
  const [docs, reloadDocs] = useDocs();
  const [chatId, setChatId] = useState(params.get("id"));
  const [docId, setDocId] = useState(params.get("doc") || "");
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const end = useRef();
  const fresh = useRef(null);
  const fileInput = useRef();

  const load = async (id) => {
    if (!id) return setMsgs([]);
    const c = await api(`/chats/${id}/`);
    setMsgs(c.messages);
    if (c.document_id) setDocId(String(c.document_id));
  };
  useEffect(() => {
    if (fresh.current === chatId) { fresh.current = null; return; }
    load(chatId).catch((e) => setError(e.message));
  }, [chatId]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const onDocChange = (e) => {
    if (e.target.value === "__upload__") return fileInput.current.click();
    setDocId(e.target.value);
  };
  const onFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setError("");
    try { const d = await uploadFile(f); await reloadDocs(); setDocId(String(d.id)); }
    catch (er) { setError(er.message); }
    e.target.value = "";
  };

  const send = async (override) => {
    const q = (typeof override === "string" ? override : text).trim();
    if (!q || busy) return;
    setText(""); setError(""); setBusy(true);
    setMsgs((m) => [...m, { id: "tmp", role: "user", content: q, created: new Date().toISOString() }]);
    try {
      const r = await api("/ask/", { method: "POST", body: { question: q, chat_id: chatId, document_id: docId || null } });
      if (!chatId) { fresh.current = String(r.chat_id); setChatId(String(r.chat_id)); }
      setMsgs((m) => [...m.filter((x) => x.id !== "tmp"), r.user, r.assistant]);
    } catch (e) {
      setMsgs((m) => m.filter((x) => x.id !== "tmp"));
      setError(e.message);
    }
    setBusy(false);
  };

  const newChat = () => { setChatId(null); setMsgs([]); setParams({}); setError(""); };
  const clear = async () => {
    setConfirm(false);
    if (chatId) await api(`/chats/${chatId}/`, { method: "DELETE" }).catch(() => {});
    newChat();
  };
  const refresh = () => load(chatId).catch((e) => setError(e.message));

  const mic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return setError("Voice input is not supported in this browser. Try Chrome or Edge.");
    const r = new SR();
    r.lang = "en-US";
    r.onresult = (e) => setText((t) => (t + " " + e.results[0][0].transcript).trim());
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  return (
    <div className="chat">
      <div className="head">
        <h1>Chat</h1>
        <div className="row">
          <select value={docId} onChange={onDocChange} disabled={!!chatId} title={chatId ? "Start a new chat to change the document" : ""}>
            <option value="">All my documents</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="__upload__">+ Upload new document</option>
          </select>
          <input ref={fileInput} type="file" accept=".pdf,.txt,.docx" hidden onChange={onFile} />
          <button className="ghost" onClick={newChat}>New chat</button>
          <button className="ghost" onClick={refresh}>Refresh</button>
          <button className="ghost" onClick={() => (chatId || msgs.length) && setConfirm(true)}>Clear chat</button>
        </div>
      </div>

      <div className="thread panel">
        {msgs.length === 0 && <p className="muted">Pick a document, or choose + Upload, then ask your first question.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={"msg " + m.role + (m.meta?.quiz ? " quizmsg" : "")}>            <div className="bubble">
              {m.role === "assistant" ? <Rich text={m.content} /> : <p>{m.content}</p>}
              {m.meta?.quiz && (
                <Quiz questions={m.meta.quiz}
                  onWeak={(topics) => send(`give quiz on ${topics.join(", ")}`)} />
              )}
              {m.meta?.sources?.length > 0 && (
                <p className="src">From your notes: {m.meta.sources.map((s) => `${s.name}, page ${s.page}`).join(" | ")}</p>
              )}
              {m.meta?.web?.length > 0 && (
                <p className="src">Not found in your notes. Answer based on the web:
                  {m.meta.web.map((w) => <a key={w.url} href={w.url} target="_blank" rel="noreferrer">{w.title}</a>)}
                </p>
              )}
            </div>
            <span className="time">{fmtDate(m.created)}, {fmtTime(m.created)}</span>
          </div>
        ))}
        {busy && <p className="muted">Thinking...</p>}
        <div ref={end} />
      </div>

      {error && <p className="note">{error}</p>}
      <div className="composer">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={listening ? "Speak in English" : "Type your message"} />
        <button className={"ghost icon" + (listening ? " on" : "")} onClick={mic} title="Speak in English"><MicIcon /></button>
        <button className="primary" onClick={() => send()} disabled={busy}>Send</button>        
        </div>
      {confirm && (
        <div className="overlay">
          <div className="modal">
            <h3>Clear this chat?</h3>
            <p className="muted">This deletes the conversation and removes it from Chat History.</p>
            <div className="row">
              <button className="primary" onClick={clear}>Yes, clear</button>
              <button className="ghost" onClick={() => setConfirm(false)}>No</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}