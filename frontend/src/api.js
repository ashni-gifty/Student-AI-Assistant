const BASE = import.meta.env.VITE_API || "http://localhost:8000/api";

export async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  const token = localStorage.getItem("token");
  if (token) headers.Authorization = "Token " + token;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: form || (body && JSON.stringify(body)) });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (res.status === 401 && token) window.dispatchEvent(new Event("session-expired"));
  if (!res.ok) throw new Error(data?.error || data?.detail || "Something went wrong. Try again.");
  return data;
}

export function checkFile(f) {
  const ext = f.name.split(".").pop().toLowerCase();
  if (!["pdf", "txt", "docx"].includes(ext)) throw new Error("Only .pdf, .txt and .docx files are allowed.");
}

export async function uploadFile(f) {
  checkFile(f);
  const fd = new FormData();
  fd.append("file", f);
  return api("/documents/", { method: "POST", form: fd });
}

export const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
