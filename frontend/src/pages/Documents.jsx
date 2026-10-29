import { useRef, useState } from "react";
import { api, fmtDate, uploadFile } from "../api";
import { useDocs } from "../components";

export default function Documents() {
  const [docs, reload] = useDocs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState(null); // the document waiting for delete confirmation
  const input = useRef();

  const onFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setBusy(true); setError("");
    try { await uploadFile(f); await reload(); } catch (er) { setError(er.message); }
    setBusy(false); e.target.value = "";
  };

  const confirmDelete = async () => {
    const d = ask;
    setAsk(null); setError("");
    try {
      await api(`/documents/${d.id}/`, { method: "DELETE" });
      await reload();
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <div className="head">
        <h1>My Documents</h1>
        <div>
          <input ref={input} type="file" accept=".pdf,.txt,.docx" hidden onChange={onFile} />
          <button className="primary" disabled={busy} onClick={() => input.current.click()}>
            {busy ? "Reading file..." : "Upload new document"}
          </button>
        </div>
      </div>
      <p className="muted small">Allowed formats: .pdf, .txt, .docx. Up to 20 MB each.</p>
      {error && <p className="note">{error}</p>}
      {docs.length === 0 ? <div className="panel muted">No documents yet. Upload your first set of notes to begin.</div> : (
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td><td>{d.size_mb} MB</td><td>{fmtDate(d.created)}</td>
                  <td className="actions">
                    <a className="ghost btn" href={d.url} target="_blank" rel="noreferrer">View</a>
                    <button className="ghost" onClick={() => setAsk(d)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ask && (
        <div className="overlay">
          <div className="modal">
            <h3>Delete this document?</h3>
            <p className="muted">{ask.name}. Its summaries and chat answers will no longer be able to use it.</p>
            <div className="row">
              <button className="primary" onClick={confirmDelete}>Yes, delete</button>
              <button className="ghost" onClick={() => setAsk(null)}>No</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}