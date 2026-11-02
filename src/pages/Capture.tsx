import { useCallback, useEffect, useRef, useState } from "react";
import { CATS, TIMES, LABEL, sc, type Thought, type Update } from "../types";
import { myThoughts, myUpdates, submitThought, subscribe } from "../data";
const SUG: Record<string, [string, string]> = { idea: ["An idea I’m exploring: ", "Idea"], rem: ["Something I need to remember: ", "Reminder"], hand: ["Something someone needs to handle: ", "Task"], dec: ["A decision I’m thinking through: ", "Decision"] };
const fmt = (s: string) => new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
export default function Capture() {
  const [f, setF] = useState({ text: "", cat: "", time: "", people: "", deadline: "", deps: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(""); const [saved, setSaved] = useState("");
  const [mine, setMine] = useState<Thought[]>([]); const [ups, setUps] = useState<Map<string, Update>>(new Map());
  const ta = useRef<HTMLTextAreaElement>(null); const inflight = useRef(false);
  const load = useCallback(async () => { try { setMine(await myThoughts()); setUps(new Map((await myUpdates()).map(u => [u.thought_id, u]))); } catch { /* list is optional */ } }, []);
  useEffect(() => { void load(); return subscribe(["thoughts", "executive_updates"], () => void load()); }, [load]);
  async function submit() {
    if (inflight.current) return;
    if (!f.text.trim()) { setErr("Write something first — only the main thought is required."); return; }
    inflight.current = true; setSaving(true); setErr("");
    try { const t = await submitThought({ text: f.text, category: f.cat, timing: f.time, people: f.people, deadline: f.deadline, deps: f.deps });
      setF({ text: "", cat: "", time: "", people: "", deadline: "", deps: "" }); setSaved(fmt(t.created_at)); void load();
    } catch (e) { setErr("Not saved — " + (e as Error).message + ". Your text is still here; please try again."); }
    finally { setSaving(false); inflight.current = false; }
  }
  function sug(k: string) {
    const [p, c] = SUG[k];
    setF(s => ({ ...s, text: s.text + (s.text && !/\s$/.test(s.text) ? "\n\n" : "") + p, cat: s.cat || c }));
    setTimeout(() => { ta.current?.focus(); const n = ta.current?.value.length ?? 0; ta.current?.setSelectionRange(n, n); }, 0);
  }
  const chips = (k: "cat" | "time", arr: string[]) => <div className="chips">{arr.map(x => <button key={x} type="button" className={"chip" + (f[k] === x ? " on" : "")} onClick={() => setF({ ...f, [k]: f[k] === x ? "" : x })}>{x}</button>)}</div>;
  const rows = mine.filter(t => !(ups.get(t.id)?.trashed));
  return (<>
    {saved ? (<div className="card ok-box" role="status"><svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true"><circle className="okring" cx="48" cy="48" r="40" fill="none" stroke="var(--sage)" strokeWidth="2" /><circle cx="48" cy="48" r="26" fill="none" stroke="var(--sage)" opacity=".5" /><g className="settle"><circle cx="48" cy="22" r="6" fill="var(--green)" /></g></svg>
      <h2>Captured. It’s safe here.</h2><p className="lead">Saved {saved}. Your assistant will take it from here.</p><button className="p" onClick={() => setSaved("")}>Capture another thought</button></div>) : (<>
      <h1>Get it out of your head.</h1><p className="lead">Big ideas, little reminders, unfinished thoughts. Drop them here. You don’t have to organize anything yet.</p>
      <div className="card"><div className="chips" style={{ marginBottom: 12 }}>{Object.entries(SUG).map(([k, v]) => <button key={k} type="button" className="chip" onClick={() => sug(k)}>{v[0].replace(/[:\s]+$/, "")}</button>)}</div>
        <textarea ref={ta} className="big" aria-label="Your thought" placeholder="What’s on your mind? One thought or ten — just let it out." value={f.text} onChange={e => setF({ ...f, text: e.target.value })} />
        {err && <div className="msg err" role="alert">{err}</div>}
        <details open={!!(f.cat || f.time || f.people || f.deadline || f.deps)}><summary>Add details (optional)</summary>
          <label>Category</label>{chips("cat", CATS)}<label>Timing</label>{chips("time", TIMES)}
          <label htmlFor="pp">People or teams involved</label><input id="pp" value={f.people} onChange={e => setF({ ...f, people: e.target.value })} />
          <label htmlFor="dl">Deadline</label><input id="dl" type="date" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} />
          <label htmlFor="dp">Dependencies or prerequisites</label><input id="dp" value={f.deps} onChange={e => setF({ ...f, deps: e.target.value })} /></details>
        <button className="p lg" disabled={saving} onClick={() => void submit()}>{saving ? "Saving…" : err ? "Try again" : "Capture Thought"}</button></div>
      <p className="small" style={{ marginTop: 14 }}>Ideas, reminders, decisions, random thoughts — drop them here. We’ll find their place.<br />Only you and your assistant can see what you submit.</p></>)}
    {rows.length > 0 && <section><h2 style={{ margin: "28px 0 8px", fontSize: 20 }}>Your thoughts</h2>{rows.map(t => { const u = ups.get(t.id); return (
      <div key={t.id} className="row" style={{ cursor: "default" }}><div className="t">{t.text.slice(0, 120)}</div>
        <div className="m"><span className={"tag s-" + sc(u?.status ?? "New")}>{u ? LABEL[u.status] ?? u.status : "Received"}</span>{u?.needs_decision && <span className="tag s-Blocked">Awaiting your decision</span>}<span>{fmt(t.created_at)}</span></div>
        {u?.share_next && <div className="small" style={{ marginTop: 4 }}>{u.share_next}</div>}</div>); })}</section>}
  </>);
}
