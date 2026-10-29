import { useEffect, useState } from "react";
import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import Auth from "./pages/Auth";
import Home from "./pages/Home";
import Documents from "./pages/Documents";
import Chat from "./pages/Chat";
import Summarize from "./pages/Summarize";
import MCQs from "./pages/MCQs";
import History from "./pages/History";

const LINKS = [
  ["/", "Home"], ["/documents", "My Documents"], ["/chat", "Chat"],
  ["/summarize", "Summarize"], ["/mcqs", "MCQS"], ["/history", "Chat History"],
];

function Layout({ user, onLogout }) {
  return (
    <div className="app">
      <header className="top">
        <div className="brand">Student AI Assistant</div>
        <nav>
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <main><div className="page"><Outlet /></div></main>      <footer>
        <span>Signed in as <strong>{user}</strong></span>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </footer>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(localStorage.getItem("name"));
  const logout = () => { localStorage.clear(); setUser(null); };
  const login = (d) => { localStorage.setItem("token", d.token); localStorage.setItem("name", d.name); setUser(d.name); };
  useEffect(() => {
    window.addEventListener("session-expired", logout);
    return () => window.removeEventListener("session-expired", logout);
  }, []);

  if (!user) return <Auth onLogin={login} />;
  return (
    <Routes>
      <Route element={<Layout user={user} onLogout={logout} />}>
        <Route path="/" element={<Home user={user} />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/summarize" element={<Summarize />} />
        <Route path="/mcqs" element={<MCQs />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<Home user={user} />} />
      </Route>
    </Routes>
  );
}
