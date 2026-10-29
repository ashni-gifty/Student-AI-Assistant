import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Quiz, useDocs } from "../components";

const MAX_Q = 50;
const PRESETS = [5, 10, 15];

export default function MCQs() {
  const [docs] = useDocs();
  const [docId, setDocId] = useState("");
  const [count, setCount] = useState(10);
  const [qs, setQs] = useState(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState(false); // popup open
  const [val, setVal] = useState("");
  const [valErr, setValErr] = useState("");
  const field = useRef();

  useEffect(() => { if (custom) setTimeout(() => field.current?.focus(), 50); }, [custom]);

  const onCount = (e) => {
    if (e.target.value === "__custom__") { setVal(PRESETS.includes(count) ? "" : String(count)); setValErr(""); setCustom(true); }
    else setCount(+e.target.value);
  };
  const applyCustom = () => {
    const n = Number(val);
    if (!val.trim() || !Number.isInteger(n)) return setValErr("Enter a whole number.");
    if (n < 1) return setValErr("Enter at least 1 question.");
    if (n > MAX_Q) return setValErr(`The limit is ${MAX_Q} questions. Enter ${MAX_Q} or less.`);
    setCount(n); setCustom(false);
  };

  const make = async (topics) => {
    if (!docId) return setError("Select a document first.");
    setBusy(true); setError("");
    try {
      const r = await api("/mcq/", { method: "POST", body: { document_id: docId, count, topics } });
      setQs(r.questions); setRound((n) => n + 1);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <>
      <h1>MCQS</h1>
      <div className="row">
        <select value={docId} onChange={(e) => setDocId(e.target.value)}>
          <option value="">Select a document</option>
          {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={count} onChange={onCount}>
          {PRESETS.map((n) => <option key={n} value={n}>{n} questions</option>)}
          {!PRESETS.includes(count) && <option value={count}>{count} questions (custom)</option>}
          <option value="__custom__">+ Custom</option>
        </select>
        <button className="primary" onClick={() => make()} disabled={busy}>{busy ? "Generating..." : "Generate MCQS"}</button>
      </div>
      {busy && count > 20 && <p className="muted small">Large quizzes can take up to a minute. Please wait.</p>}
      {error && <p className="note">{error}</p>}
      {qs && <Quiz key={round} questions={qs} onWeak={(t) => make(t)} />}

      {custom && (
        <div className="overlay" onKeyDown={(e) => e.key === "Escape" && setCustom(false)}>
          <div className="modal">
            <h3>Custom number of questions</h3>
            <p className="muted small">Choose between 1 and {MAX_Q} questions.</p>
            <input ref={field} type="number" min="1" max={MAX_Q} value={val} placeholder={`1 to ${MAX_Q}`}
              onChange={(e) => { setVal(e.target.value); setValErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && applyCustom()} style={{ width: "100%" }} />
            {valErr && <p className="warnq">{valErr}</p>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="primary" onClick={applyCustom}>Set</button>
              <button className="ghost" onClick={() => setCustom(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}