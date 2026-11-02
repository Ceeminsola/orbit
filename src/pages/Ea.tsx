import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EA_CATS, TIMES, STATUSES, sc, original, type Entry, type Status } from "../types";
import { allEntries, allLinks, linkEntries, purge, saveEntry, splitEntry, subscribe } from "../data";
import { download, toCsv } from "../lib/csv";
const today = () => new Date().toISOString().slice(0, 10);
const isOpen = (e: Entry) => !e.trashed_at && !["Completed", "Archived", "Transferred to Execution"].includes(e.status);
const overdue = (e: Entry) => isOpen(e) && !!e.deadline && e.deadline < today();
const label = (e: Entry) => e.title || original(e).slice(0, 90);
const when = (s: string) => new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
type Msg = { k: "ok" | "err" | "warn"; t: string } | null;

export default function Ea() {
  const [entries, setEntries] = useState<Entry[]>([]); const [links, setLinks] = useState<{ a: string; b: string }[]>([]);
  const [err, setErr] = useState(""); const [loaded, setLoaded] = useState(false); const [sel, setSel] = useState<string | null>(null); const [rev, setRev] = useState(0);
  const [f, setF] = useState({ q: "", status: "", cat: "", time: "", from: "", project: "", sort: "new", sp: "" });
  const load = useCallback(async () => { try { setEntries(await allEntries()); setLinks(await allLinks()); setErr(""); } catch (e) { setErr("Could not load the inbox: " + (e as Error).message); } setLoaded(true); }, []);
  useEffect(() => { void load(); return subscribe(["entries", "thoughts", "entry_links"], () => void load()); }, [load]);
  const live = entries.filter(e => !e.trashed_at);
  const c = (s: string) => live.filter(e => e.status === s).length;
  const projects = useMemo(() => [...new Set(entries.map(e => e.project).filter(Boolean))].sort(), [entries]);
  const view = useMemo(() => {
    const q = f.q.toLowerCase();
    const spec = (e: Entry) => f.sp === "blocked" ? e.blocked && isOpen(e) : f.sp === "overdue" ? overdue(e) : ["Transferred to Execution", "Completed", "Archived"].includes(e.status);
    const l = entries.filter(e => (f.status === "Trash" ? !!e.trashed_at : !e.trashed_at && (!f.status || e.status === f.status)) && (!f.cat || e.category === f.cat) && (!f.time || e.timing === f.time) && (!f.project || e.project === f.project) && (!f.from || e.created_at >= f.from) && (!f.sp || spec(e)) &&
      (!q || JSON.stringify([original(e), e.title, e.private_notes, e.project, e.owner, e.collab, e.next_action, e.share_next, e.deps, e.dest]).toLowerCase().includes(q)));
    const t = (e: Entry) => { const i = TIMES.indexOf(e.timing); return i < 0 ? 9 : i; };
    const by: Record<string, (a: Entry, b: Entry) => number> = { urgency: (a, b) => t(a) - t(b), deadline: (a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"), status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) };
    return [...l].sort(by[f.sort] ?? (() => 0));
  }, [entries, f]);
  const cur = entries.find(e => e.id === sel) ?? null;
  const tiles: [string, number, string, string][] = [["Total", live.length, "", ""], ["New", c("New"), "New", ""], ["Needs clarification", c("Needs Clarification"), "Needs Clarification", ""], ["Structured · ready", c("Structured"), "Structured", ""], ["Blocked", live.filter(e => e.blocked && isOpen(e)).length, "", "blocked"], ["Overdue", live.filter(overdue).length, "", "overdue"], ["Done / archived", live.filter(e => ["Transferred to Execution", "Completed", "Archived"].includes(e.status)).length, "", "done"]];
  const cols = ["id", "created_at", "status", "category", "timing", "title", "original", "deadline", "deps", "next_action", "owner", "collab", "dest", "project", "exec_link", "clarify", "blocked", "private_notes", "share_next", "needs_decision", "trashed_at", "parent_id", "executive_id"];
  const exp = (kind: "csv" | "json") => {
    if (kind === "json") return download("orbit-export.json", JSON.stringify(entries, null, 2), "application/json");
    download("orbit-export.csv", toCsv(entries.map(e => ({ ...e, original: original(e) })), cols), "text/csv");
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (<><h1>EA Command Inbox</h1>
    {err && <div className="msg err" role="alert">{err}</div>}
    <div className="stats">{tiles.map(([l, n, st, sp]) => <button key={l} className="stat" onClick={() => setF({ ...f, status: st, sp })}><b>{n}</b><span>{l}</span></button>)}</div>
    <div className="grid cols"><div>
      <div className="filters"><input aria-label="Search" placeholder="Search text, people, notes…" value={f.q} onChange={set("q")} />
        <select aria-label="Status" value={f.status} onChange={set("status")}><option value="">All statuses</option><option>Trash</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
        <select aria-label="Category" value={f.cat} onChange={set("cat")}><option value="">All categories</option>{EA_CATS.map(s => <option key={s}>{s}</option>)}</select>
        <select aria-label="Timing" value={f.time} onChange={set("time")}><option value="">All timing</option>{TIMES.map(s => <option key={s}>{s}</option>)}</select>
        <input type="date" aria-label="Submitted since" value={f.from} onChange={set("from")} />
        <select aria-label="Project" value={f.project} onChange={set("project")}><option value="">All projects</option>{projects.map(p => <option key={p}>{p}</option>)}</select>
        <select aria-label="Sort" value={f.sort} onChange={set("sort")}><option value="new">Newest first</option><option value="urgency">Sort: urgency</option><option value="deadline">Sort: deadline</option><option value="status">Sort: status</option></select></div>
      <div className="btns" style={{ margin: "10px 0" }}><button onClick={() => exp("csv")}>Export CSV</button><button onClick={() => exp("json")}>Export JSON</button></div>
      {!loaded ? <div className="empty">Loading…</div> : !entries.length ? <div className="empty">No submissions yet. When your executive captures a thought it will appear here.</div> : !view.length ? <div className="empty">Nothing matches these filters.</div> :
        view.map(e => <div key={e.id} className={"row" + (sel === e.id ? " sel" : "")} tabIndex={0} role="button" onClick={() => { setSel(e.id); setRev(r => r + 1); }} onKeyDown={k => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), setSel(e.id), setRev(r => r + 1))}>
          <div className="t">{label(e)}</div><div className="m"><span className={"tag s-" + sc(e.status)}>{e.status}</span>{e.blocked && <span className="tag s-Blocked">Blocked</span>}{overdue(e) && <span className="tag s-Overdue">Overdue</span>}{e.project && <span>{e.project}</span>}{(e.category || e.timing) && <span>{[e.category, e.timing].filter(Boolean).join(" · ")}</span>}<span>{when(e.created_at)}</span></div></div>)}
    </div>
    <div>{cur && <Detail key={cur.id + ":" + rev} entry={cur} entries={entries} links={links} reload={load} onGone={() => setSel(null)} onOpen={id => { setSel(id); setRev(r => r + 1); }} />}</div></div></>);
}

function Detail({ entry, entries, links, reload, onGone, onOpen }: { entry: Entry; entries: Entry[]; links: { a: string; b: string }[]; reload: () => Promise<void>; onGone: () => void; onOpen: (id: string) => void }) {
  const pick = (e: Entry) => ({ title: e.title, category: e.category, timing: e.timing, next_action: e.next_action, owner: e.owner, collab: e.collab, deadline: e.deadline ?? "", deps: e.deps, dest: e.dest, project: e.project, exec_link: e.exec_link, clarify: e.clarify, blocked: e.blocked, private_notes: e.private_notes, share_next: e.share_next, needs_decision: e.needs_decision });
  const [d, setD] = useState(() => pick(entry)); const [ver, setVer] = useState(entry.version); const [msg, setMsg] = useState<Msg>(null);
  const [ask, setAsk] = useState<"" | "trash" | "purge">(""); const [splitTxt, setSplitTxt] = useState(original(entry)); const [lk, setLk] = useState(""); const busy = useRef(false);
  const orig = original(entry); const trashed = !!entry.trashed_at;
  const mine = links.filter(l => l.a === entry.id || l.b === entry.id).map(l => entries.find(e => e.id === (l.a === entry.id ? l.b : l.a))).filter((e): e is Entry => !!e);
  const kids = entries.filter(e => e.parent_id === entry.id); const parent = entries.find(e => e.id === entry.parent_id);
  const others = entries.filter(e => e.id !== entry.id && !e.trashed_at && !mine.some(m => m.id === e.id));
  const patchOf = (extra: Partial<Entry> = {}): Partial<Entry> => ({ ...d, deadline: d.deadline || null, ...extra });
  async function run(fn: () => Promise<string>, after?: () => void) {
    if (busy.current) return; busy.current = true;
    try { const t = await fn(); setMsg({ k: "ok", t }); await reload(); after?.(); } catch (e) { setMsg({ k: "err", t: "Not saved — " + (e as Error).message + ". Your edits are still on screen; press the button again to retry." }); } finally { busy.current = false; }
  }
  const stamp = () => new Date().toLocaleTimeString([], { timeStyle: "short" });
  const save = (extra: Partial<Entry> = {}, text = "Saved") => run(async () => { const n = await saveEntry(entry, ver, patchOf(extra)); setVer(n.version); return `${text} ${stamp()}`; });
  const stale = entry.version !== ver;
  const inp = (k: keyof typeof d, lab: string, type = "text") => <div><label htmlFor={"d-" + k}>{lab}</label><input id={"d-" + k} type={type} value={String(d[k] ?? "")} onChange={e => setD({ ...d, [k]: e.target.value })} /></div>;
  return (<div className="card"><h2>Submission</h2>
    <p className="small">ID {entry.id}{entry.parent_id ? " · split entry" : ""}<br />Received {when(entry.created_at)} · Status: <b>{entry.status}</b></p>
    {stale && <div className="msg warn" role="alert">This entry changed elsewhere. Saving is blocked so nothing is overwritten. Reload it to see the latest.</div>}
    <label>Original text (unedited)</label><div className="orig">{orig}</div>
    {entry.thoughts && (entry.thoughts.people || entry.thoughts.deps || entry.thoughts.deadline) && <p className="small">From executive — people: {entry.thoughts.people || "—"} · deadline: {entry.thoughts.deadline || "—"} · dependencies: {entry.thoughts.deps || "—"}</p>}
    {parent && <p className="small">Split from original: <a href="#ea" onClick={e => { e.preventDefault(); onOpen(parent.id); }}>{label(parent)}</a></p>}
    {kids.length > 0 && <p className="small">Split into {kids.length}: {kids.map(k => <a key={k.id} href="#ea" onClick={e => { e.preventDefault(); onOpen(k.id); }} style={{ marginRight: 8 }}>{label(k)}</a>)}</p>}
    {inp("title", "Structured title")}
    <div className="grid two"><div><label htmlFor="d-category">Category</label><select id="d-category" value={d.category} onChange={e => setD({ ...d, category: e.target.value })}><option value="">—</option>{EA_CATS.map(x => <option key={x}>{x}</option>)}</select></div>
      <div><label htmlFor="d-timing">Timing</label><select id="d-timing" value={d.timing} onChange={e => setD({ ...d, timing: e.target.value })}><option value="">—</option>{TIMES.map(x => <option key={x}>{x}</option>)}</select></div></div>
    {inp("next_action", "Next action")}
    <div className="grid two">{inp("owner", "Proposed owner")}{inp("collab", "Collaborators")}{inp("deadline", "Deadline", "date")}{inp("dest", "Destination project / tool")}</div>
    {inp("deps", "Dependencies")}
    <div className="grid two">{inp("project", "Related project")}{inp("exec_link", "Execution link")}</div>
    {inp("clarify", "Clarification question")}
    <label style={{ textTransform: "none", letterSpacing: 0, fontSize: 14 }}><input type="checkbox" style={{ width: "auto" }} checked={d.blocked} onChange={e => setD({ ...d, blocked: e.target.checked })} /> Blocked</label>
    <label htmlFor="d-share">Update your boss will see (not private)</label><input id="d-share" value={d.share_next} placeholder="e.g. Booked for Friday; need your OK on budget" onChange={e => setD({ ...d, share_next: e.target.value })} />
    <label style={{ textTransform: "none", letterSpacing: 0, fontSize: 14 }}><input type="checkbox" style={{ width: "auto" }} checked={d.needs_decision} onChange={e => setD({ ...d, needs_decision: e.target.checked })} /> Awaiting his decision</label>
    <label htmlFor="d-notes">Private processing notes</label><textarea id="d-notes" rows={4} value={d.private_notes} onChange={e => setD({ ...d, private_notes: e.target.value })} />
    <label>Set status</label><p className="small">Status changes only when you press a button. “Transferred to Execution” means you moved it yourself; Orbit has no connection to other tools.</p>
    <div className="btns">{STATUSES.slice(1).map(s => <button key={s} className={entry.status === s ? "p" : ""} onClick={() => void save({ status: s as Status }, "Status saved")}>{s}</button>)}</div>
    <div className="btns" style={{ marginTop: 12 }}><button className="p" onClick={() => void save()}>Save changes</button></div>
    {msg && <div className={"msg " + msg.k} role={msg.k === "err" ? "alert" : "status"}>{msg.t}</div>}
    {trashed ? <><div className="msg warn">This entry is in Trash. It is hidden from the inbox and from your boss.</div><div className="btns"><button onClick={() => void save({ trashed_at: null }, "Restored")}>Restore</button><button onClick={() => setAsk("purge")}>Delete permanently…</button></div></> : <div className="btns" style={{ marginTop: 12 }}><button onClick={() => setAsk("trash")}>Move to trash…</button></div>}
    {ask === "trash" && <div className="msg warn">Move to Trash? It disappears from the inbox and from your boss’s list. The original text, your notes, links and any split entries are kept, and you can restore it from Trash.<div className="btns"><button className="p" onClick={() => void save({ trashed_at: new Date().toISOString() }, "Moved to Trash").then(() => setAsk(""))}>Yes, move to trash</button><button onClick={() => setAsk("")}>Cancel</button></div></div>}
    {ask === "purge" && <div className="msg err">Delete permanently? This erases the original submission, your notes and fields, and the copy your boss sees. {mine.length} linked entr{mine.length === 1 ? "y loses its link" : "ies lose their links"}{kids.length ? ` and ${kids.length} split entr${kids.length === 1 ? "y is" : "ies are"} kept as separate entries` : ""}. This cannot be undone.<div className="btns"><button className="p" onClick={() => void run(async () => { await purge(entry.id); return "Deleted."; }, onGone)}>Yes, delete forever</button><button onClick={() => setAsk("")}>Cancel</button></div></div>}
    <details><summary>Split into separate entries</summary><p className="small">Separate thoughts with a blank line. The original stays untouched.</p>
      <textarea rows={6} value={splitTxt} onChange={e => setSplitTxt(e.target.value)} aria-label="Text to split" />
      <div className="btns"><button onClick={() => { const parts = splitTxt.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean); if (parts.length < 2) return setMsg({ k: "warn", t: "Add a blank line between thoughts to split." }); void run(async () => { await splitEntry(entry, parts); return `Created ${parts.length} linked entries.`; }); }}>Create entries</button></div></details>
    <details><summary>Related entries ({mine.length})</summary>
      <p className="small">{mine.map(m => <a key={m.id} href="#ea" style={{ display: "block" }} onClick={e => { e.preventDefault(); onOpen(m.id); }}>{label(m)}</a>)}{!mine.length && "None yet."}</p>
      <select aria-label="Link to" value={lk} onChange={e => setLk(e.target.value)}><option value="">Link to…</option>{others.map(o => <option key={o.id} value={o.id}>{label(o).slice(0, 60)}</option>)}</select>
      <div className="btns"><button disabled={!lk} onClick={() => void run(async () => { await linkEntries(entry.id, lk); setLk(""); return "Linked."; })}>Link</button></div></details></div>);
}
