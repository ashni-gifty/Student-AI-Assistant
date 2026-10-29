import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";

export function useDocs() {
  const [docs, setDocs] = useState([]);
  const load = () => api("/documents/").then(setDocs).catch(() => {});
  useEffect(() => { load(); }, []);
  return [docs, load];
}

function WikiImage({ title }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
      .then((r) => r.json())
      .then((d) => d.thumbnail && setSrc(d.thumbnail.source))
      .catch(() => {});
  }, [title]);
  return src ? <figure><img src={src} alt={title} /><figcaption>{title}, via Wikipedia</figcaption></figure> : null;
}

// Markdown with tables. Bold terms turn blue through CSS. [[image: Title]] becomes a Wikipedia picture.
export function Rich({ text }) {
  return (
    <div className="md">
      {text.split(/(\[\[image:[^\]]+\]\])/g).map((part, i) => {
        const m = part.match(/^\[\[image:\s*([^\]]+)\]\]$/);
        return m ? <WikiImage key={i} title={m[1].trim()} />
          : <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{part}</ReactMarkdown>;
      })}
    </div>
  );
}

const QUOTES = [
  "Every mistake you fix now is one you will not make in the exam.",
  "Learning is built from small corrections, one question at a time.",
  "You are not behind. You are practising, and practice works.",
  "Hard topics become easy after the third honest try.",
];

export function Quiz({ questions, onWeak }) {
  const uid = useId();
  const [ans, setAns] = useState({});
  const [fix, setFix] = useState({});
  const [done, setDone] = useState(false);
  const [warn, setWarn] = useState(false);
  const n = questions.length;
  const answered = Object.keys(ans).length;
  const wrong = questions.map((_, i) => i).filter((i) => ans[i] !== questions[i].answer);
  const fixed = (i) => fix[i] === questions[i].answer;
  const allFixed = wrong.every(fixed);
  const score = n - wrong.length;
  const weak = [...new Set(wrong.map((i) => questions[i].topic))];
  const goto = (id) => setTimeout(() =>
    document.getElementById(`${uid}-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);

  const submit = () => {
    const missing = questions.findIndex((_, i) => ans[i] === undefined);
    if (missing !== -1) { setWarn(true); goto(`q${missing}`); return; }
    setDone(true); goto("result");
  };
  // The correct answer stays hidden on a wrong question until the student finds it.
  const cls = (i, j) => {
    const q = questions[i];
    if (!done) return ans[i] === j ? "opt picked" : "opt";
    if (ans[i] === j) return "opt " + (j === q.answer ? "right" : "wrong");
    if (j === q.answer && (ans[i] === q.answer || fixed(i))) return "opt right";
    return "opt";
  };

  return (
    <div className="quiz">
      {done && (
        <div className="panel" id={`${uid}-result`}>
          <h3>Score: {score} / {n}</h3>
          <p className="quote-line">{QUOTES[score % QUOTES.length]}</p>
          {wrong.length === 0 ? <p>Perfect score. You have mastered these topics.</p> : (
            <>
              <p>Topics to revise: <span className="term">{weak.join(", ")}</span></p>
              <p className="muted">
                Read the steps under each red question, then choose the correct answer. You finish only when every
                question is correct. {wrong.filter(fixed).length} of {wrong.length} corrected.
              </p>
              {allFixed && (
                <>
                  <p className="ok">Every mistake is corrected. That is exactly how learning works.</p>
                  {onWeak && <button className="primary" onClick={() => onWeak(weak)}>Take a new quiz on these topics</button>}
                </>
              )}
            </>
          )}
        </div>
      )}

      {questions.map((q, i) => (
        <div className={"panel" + (warn && !done && ans[i] === undefined ? " missing" : "")} id={`${uid}-q${i}`} key={i}>
          <p className="q"><strong>{i + 1}.</strong> {q.q}</p>
          {q.options.map((o, j) => (
            <button key={j} className={cls(i, j)} disabled={done}
              onClick={() => setAns({ ...ans, [i]: j })}>{o}</button>
          ))}
          {warn && !done && ans[i] === undefined && <p className="warnq">Please select an answer for this question.</p>}
          {done && ans[i] === q.answer && <p className="muted small">{q.explain}</p>}

          {done && ans[i] !== q.answer && (
            <div className="fixbox">
              <p className="term">Topic to revise: {q.topic}</p>
              {q.steps?.length > 0 && (
                <>
                  <p><strong>How to solve it</strong></p>
                  <ol>{q.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
                </>
              )}
              {q.ref && <p className="muted small">Reference: {q.ref}</p>}
              <p><strong>Now try again.</strong> Choose the correct answer to continue.</p>
              {q.options.map((o, j) => (
                <button key={j} disabled={fixed(i)}
                  className={"opt" + (fix[i] === j ? (j === q.answer ? " right" : " wrong") : "")}
                  onClick={() => setFix({ ...fix, [i]: j })}>{o}</button>
              ))}
              {fix[i] !== undefined && !fixed(i) && <p className="warnq">Not yet. Read the steps above and try again.</p>}
              {fixed(i) && <p className="ok">Correct. {q.explain}</p>}
            </div>
          )}
        </div>
      ))}

      {!done && (
        <>
          {warn && answered < n && <p className="warnq">Answer all {n} questions before submitting.</p>}
          <button className="primary" onClick={submit}>Submit answers ({answered}/{n} answered)</button>
        </>
      )}
    </div>
  );
}