import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate, fmtTime } from "../api";

const preview = (md) =>
  (md.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "").replace(/\*/g, "").slice(0, 110);

function groupByDate(list) {
  const g = {};
  list.forEach((x) => { (g[fmtDate(x.updated || x.created)] ||= []).push(x); });
  return Object.entries(g);
}

export default function History() {
  const [tab, setTab] = useState("chats");
  const [chats, setChats] = useState(null);
  const [sums, setSums] = useState(null);
  const [ask, setAsk] = useState(null); // { kind: "chat" | "sum", item }
  const [error, setError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    api("/chats/").then(setChats).catch(() => setChats([]));
    api("/summaries/").then(setSums).catch(() => setSums([]));
  }, []);

  const confirmDelete = async () => {
    const { kind, item } = ask;
    setAsk(null); setError("");
    try {
      if (kind === "chat") {
        await api(`/chats/${item.id}/`, { method: "DELETE" });
        setChats((l) => l.filter((x) => x.id !== item.id));
      } else {
        await api(`/summaries/${item.id}/`, { method: "DELETE" });
        setSums((l) => l.filter((x) => x.id !== item.id));
      }
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <h1>Chat History</h1>
      <div className="tabs">
        <button className={tab === "chats" ? "on" : ""} onClick={() => setTab("chats")}>Chats</button>
        <button className={tab === "sums" ? "on" : ""} onClick={() => setTab("sums")}>Summaries</button>
      </div>
      {error && <p className="note">{error}</p>}

      {tab === "chats" && (
        <>
          {chats && chats.length === 0 && <div className="panel muted">No chats yet. Your conversations will appear here.</div>}
          {groupByDate(chats || []).map(([date, list]) => (
            <section key={date}>
              <h3 className="date">{date}</h3>
              {list.map((c) => (
                <div key={c.id} className="panel histitem">
                  <button className="histmain" onClick={() => nav(`/chat?id=${c.id}`)}>
                    <span>{c.title}</span>
                    <span className="muted small">{c.document}, {fmtTime(c.updated)}</span>
                  </button>
                  <button className="ghost" onClick={() => setAsk({ kind: "chat", item: c })}>Delete</button>
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      {tab === "sums" && (
        <>
          {sums && sums.length === 0 && <div className="panel muted">No summaries yet. Generate one on the Summarize page and it will be saved here.</div>}
          {groupByDate(sums || []).map(([date, list]) => (
            <section key={date}>
              <h3 className="date">{date}</h3>
              {list.map((s) => (
                <div key={s.id} className="panel histitem">
                  <button className="histmain" onClick={() => nav(`/summarize?id=${s.id}`)}>
                    <span>{s.doc_name}</span>
                    <span className="muted small">{fmtTime(s.created)}. {preview(s.summary)}</span>
                  </button>
                  <button className="ghost" onClick={() => setAsk({ kind: "sum", item: s })}>Delete</button>
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      {ask && (
        <div className="overlay">
          <div className="modal">
            <h3>{ask.kind === "chat" ? "Do you want to Delete this chat?" : "Do you want to Delete this summary?"}</h3>
            <p className="muted">
              {ask.kind === "chat" ? ask.item.title : ask.item.doc_name}. <br></br>
            </p>
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