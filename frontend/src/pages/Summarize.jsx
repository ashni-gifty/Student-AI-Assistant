import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, fmtDate, fmtTime, uploadFile } from "../api";
import { useDocs } from "../components";

// Turns the markdown summary into blocks of words, so each word can be highlighted while it is read aloud.
function parse(md) {
  const blocks = [];
  md.split("\n").forEach((raw) => {
    let line = raw.trim();
    if (!line) return;
    let type = "p";
    if (line.startsWith("### ")) { type = "h3"; line = line.slice(4); }
    else if (line.startsWith("## ")) { type = "h2"; line = line.slice(3); }
    else if (line.startsWith("# ")) { type = "h2"; line = line.slice(2); }
    else if (/^[-*] /.test(line)) line = line.slice(2);
    const tokens = [];
    line.split(/(\*+[^*]+\*+)/).forEach((seg) => {
      const m = seg.match(/^(\*+)([^*]+)\1$/);
      (m ? m[2] : seg).split(/\s+/).filter(Boolean).forEach((w) => tokens.push({ w: w.replace(/\*/g, ""), em: !!m }));
    });
    if (tokens.length) blocks.push({ type, tokens });
  });
  return blocks;
}

export default function Summarize() {
  const [params, setParams] = useSearchParams();
  const [docs, reload] = useDocs();
  const [docId, setDocId] = useState("");
  const [summary, setSummary] = useState("");
  const [info, setInfo] = useState(null); // { name, created } of the summary on screen
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [speech, setSpeech] = useState("idle"); // idle | playing | paused
  const [active, setActive] = useState(-1);
  const [copied, setCopied] = useState(false);
  const input = useRef();
  const run = useRef(0);
  const timer = useRef(null);
  const got = useRef(false);

  const model = useMemo(() => {
    const blocks = parse(summary);
    let text = "";
    const starts = [];
    let n = 0;
    blocks.forEach((b) => {
      b.tokens.forEach((t) => { t.i = n++; starts.push(text.length); text += t.w + " "; });
      text = text.trimEnd() + (b.type === "p" ? " " : ". ");
    });
    return { blocks, text, starts };
  }, [summary]);

  const stopTimer = () => { clearInterval(timer.current); timer.current = null; };
  const stopSpeech = () => { run.current++; speechSynthesis.cancel(); stopTimer(); setSpeech("idle"); setActive(-1); };
  useEffect(() => () => { run.current++; speechSynthesis.cancel(); stopTimer(); }, []);

  // Opens a saved summary when you arrive from Chat History (/summarize?id=5)
  const openId = params.get("id");
  useEffect(() => {
    if (!openId) return;
    api(`/summaries/${openId}/`).then((s) => {
      stopSpeech(); setSummary(s.summary); setInfo({ name: s.doc_name, created: s.created });
      if (s.document_id) setDocId(String(s.document_id));
    }).catch((e) => setError(e.message));
  }, [openId]);

  const onFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setError("");
    try { const d = await uploadFile(f); await reload(); setDocId(String(d.id)); } catch (er) { setError(er.message); }
    e.target.value = "";
  };
  const generate = async () => {
    if (!docId) return setError("Select a document first.");
    stopSpeech(); setBusy(true); setError("");
    try {
      const s = await api("/summarize/", { method: "POST", body: { document_id: docId } });
      setSummary(s.summary); setInfo({ name: s.doc_name, created: s.created }); setParams({});
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // Reads aloud and moves the blue highlight word by word. If the browser voice gives no word events,
  // a timer moves the highlight at about the speaking speed.
  const play = (from = 0) => {
    speechSynthesis.cancel(); stopTimer(); got.current = false;
    const id = ++run.current;
    const offset = model.starts[from] ?? 0;
    const u = new SpeechSynthesisUtterance(model.text.slice(offset));
    u.lang = "en-US"; u.rate = 0.9;
    u.onboundary = (e) => {
      if (id !== run.current || (e.name && e.name !== "word")) return;
      got.current = true; stopTimer();
      const pos = e.charIndex + offset;
      let k = 0;
      while (k + 1 < model.starts.length && model.starts[k + 1] <= pos) k++;
      setActive(k);
    };
    u.onend = () => { if (id === run.current) { stopTimer(); setSpeech("idle"); setActive(-1); } };
    speechSynthesis.speak(u);
    setSpeech("playing"); setActive(from);
    setTimeout(() => {
      if (id === run.current && !got.current && !speechSynthesis.paused) startTimer();
    }, 900);
  };
  const startTimer = () => {
    stopTimer();
    timer.current = setInterval(() => setActive((a) => Math.min(a + 1, model.starts.length - 1)), 420);
  };
  const pause = () => { speechSynthesis.pause(); stopTimer(); setSpeech("paused"); };
  const resume = () => { speechSynthesis.resume(); if (!got.current) startTimer(); setSpeech("playing"); };

  const copy = async () => {
    await navigator.clipboard.writeText(summary.replace(/[#*_`]/g, ""));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <h1>Summarize</h1>
      <div className="panel toolbar">
        <select value={docId} onChange={(e) => setDocId(e.target.value)}>
          <option value="">Select a document</option>
          {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input ref={input} type="file" accept=".pdf,.txt,.docx" hidden onChange={onFile} />
        <button className="ghost" onClick={() => input.current.click()}>+ Upload</button>
        <button className="primary" onClick={generate} disabled={busy}>{busy ? "Generating..." : "Generate summary"}</button>
      </div>
      {error && <p className="note">{error}</p>}

      {!summary && (
        <div className="panel muted">
          Choose a document and press Generate summary. Your saved summaries are in Chat History, under Summaries.
        </div>
      )}

      {summary && (
        <div className="panel">
          <div className="sumhead">
            <div>
              <h3>{info?.name}</h3>
              {info?.created && <span className="muted small">{fmtDate(info.created)}, {fmtTime(info.created)}</span>}
            </div>
            <div className="row tools">
              <button className="ghost" onClick={() => play(0)}>Listen</button>
              {speech === "playing" && <button className="ghost" onClick={pause}>Pause</button>}
              {speech === "paused" && <button className="ghost" onClick={resume}>Resume</button>}
              {speech !== "idle" && <button className="ghost" onClick={stopSpeech}>Stop</button>}
              <button className="ghost" onClick={copy}>{copied ? "Copied" : "Copy summary"}</button>
            </div>
          </div>
          <p className="muted small">Press Listen and follow the blue word. Click any word to start reading from it.</p>
          <div className="read">
            {model.blocks.map((b, bi) => {
              const Tag = b.type;
              return (
                <Tag key={bi}>
                  {b.tokens.map((t) => (
                    <span key={t.i} onClick={() => play(t.i)}
                      className={"w" + (t.em ? " em" : "") + (t.i === active ? " on" : "")}>{t.w} </span>
                  ))}
                </Tag>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}