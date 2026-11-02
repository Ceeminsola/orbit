
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EA_CATS,
  TIMES,
  STATUSES,
  sc,
  original,
  type Entry,
  type Status,
  type Workspace,
} from "../types";
import {
  allEntries,
  allLinks,
  linkEntries,
  myWorkspaces,
  purge,
  saveEntry,
  splitEntry,
  subscribe,
} from "../data";
import { download, toCsv } from "../lib/csv";

const today = () => new Date().toISOString().slice(0, 10);

const isOpen = (e: Entry) =>
  !e.trashed_at &&
  !["Completed", "Archived", "Transferred to Execution"].includes(e.status);

const overdue = (e: Entry) =>
  isOpen(e) && !!e.deadline && e.deadline < today();

const label = (e: Entry) => e.title || original(e).slice(0, 90);

const when = (s: string) =>
  new Date(s).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

type Msg = { k: "ok" | "err" | "warn"; t: string } | null;

const emptyFilters = () => ({
  q: "",
  status: "",
  cat: "",
  time: "",
  from: "",
  project: "",
  sort: "new",
  sp: "",
});

export default function Ea() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [links, setLinks] = useState<{ a: string; b: string }[]>([]);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [f, setF] = useState(emptyFilters);

  // Load the workspaces assigned to the signed-in EA.
  useEffect(() => {
    let active = true;

    async function loadWorkspaces() {
      try {
        const result = await myWorkspaces();

        if (!active) return;

        setWorkspaces(result);

        setActiveWorkspaceId((current) => {
          if (current && result.some((w) => w.id === current)) {
            return current;
          }

          return result[0]?.id ?? "";
        });

        setErr("");
      } catch (e) {
        if (active) {
          setErr(
            "Could not load your assigned workspaces: " +
              (e as Error).message
          );
        }
      } finally {
        if (active) setWorkspacesLoaded(true);
      }
    }

    void loadWorkspaces();

    return () => {
      active = false;
    };
  }, []);

  // Load entries and links for the selected workspace only.
  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      setEntries([]);
      setLinks([]);
      setLoaded(true);
      return;
    }

    try {
      const [nextEntries, nextLinks] = await Promise.all([
        allEntries(activeWorkspaceId),
        allLinks(activeWorkspaceId),
      ]);

      setEntries(nextEntries);
      setLinks(nextLinks);
      setErr("");
    } catch (e) {
      setErr("Could not load the inbox: " + (e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    setLoaded(false);
    setSel(null);
    setF(emptyFilters());

    if (!activeWorkspaceId) {
      setEntries([]);
      setLinks([]);
      setLoaded(true);
      return;
    }

    void load();

    return subscribe(
      ["entries", "thoughts", "entry_links"],
      () => void load(),
      activeWorkspaceId
    );
  }, [activeWorkspaceId, load]);

  const activeWorkspace = workspaces.find(
    (w) => w.id === activeWorkspaceId
  );

  const live = entries.filter((e) => !e.trashed_at);

  const c = (s: string) =>
    live.filter((e) => e.status === s).length;

  const projects = useMemo(
    () =>
      [...new Set(entries.map((e) => e.project).filter(Boolean))].sort(),
    [entries]
  );

  const view = useMemo(() => {
    const q = f.q.toLowerCase();

    const spec = (e: Entry) =>
      f.sp === "blocked"
        ? e.blocked && isOpen(e)
        : f.sp === "overdue"
          ? overdue(e)
          : ["Transferred to Execution", "Completed", "Archived"].includes(
              e.status
            );

    const filtered = entries.filter(
      (e) =>
        (f.status === "Trash"
          ? !!e.trashed_at
          : !e.trashed_at && (!f.status || e.status === f.status)) &&
        (!f.cat || e.category === f.cat) &&
        (!f.time || e.timing === f.time) &&
        (!f.project || e.project === f.project) &&
        (!f.from || e.created_at >= f.from) &&
        (!f.sp || spec(e)) &&
        (!q ||
          JSON.stringify([
            original(e),
            e.title,
            e.private_notes,
            e.project,
            e.owner,
            e.collab,
            e.next_action,
            e.share_next,
            e.deps,
            e.dest,
          ])
            .toLowerCase()
            .includes(q))
    );

    const timingRank = (e: Entry) => {
      const i = TIMES.indexOf(e.timing);
      return i < 0 ? 9 : i;
    };

    const sorters: Record<
      string,
      (a: Entry, b: Entry) => number
    > = {
      urgency: (a, b) => timingRank(a) - timingRank(b),
      deadline: (a, b) =>
        (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
      status: (a, b) =>
        STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
    };

    return [...filtered].sort(sorters[f.sort] ?? (() => 0));
  }, [entries, f]);

  const cur = entries.find((e) => e.id === sel) ?? null;

  const tiles: [string, number, string, string][] = [
    ["Total", live.length, "", ""],
    ["New", c("New"), "New", ""],
    ["Needs clarification", c("Needs Clarification"), "Needs Clarification", ""],
    ["Structured · ready", c("Structured"), "Structured", ""],
    [
      "Blocked",
      live.filter((e) => e.blocked && isOpen(e)).length,
      "",
      "blocked",
    ],
    ["Overdue", live.filter(overdue).length, "", "overdue"],
    [
      "Done / archived",
      live.filter((e) =>
        ["Transferred to Execution", "Completed", "Archived"].includes(
          e.status
        )
      ).length,
      "",
      "done",
    ],
  ];

  const cols = [
    "id",
    "workspace_id",
    "created_at",
    "status",
    "category",
    "timing",
    "title",
    "original",
    "deadline",
    "deps",
    "next_action",
    "owner",
    "collab",
    "dest",
    "project",
    "exec_link",
    "clarify",
    "blocked",
    "private_notes",
    "share_next",
    "needs_decision",
    "trashed_at",
    "parent_id",
    "executive_id",
  ];

  const exp = (kind: "csv" | "json") => {
    if (kind === "json") {
      return download(
        "orbit-export.json",
        JSON.stringify(entries, null, 2),
        "application/json"
      );
    }

    download(
      "orbit-export.csv",
      toCsv(
        entries.map((e) => ({
          ...e,
          original: original(e),
        })),
        cols
      ),
      "text/csv"
    );
  };

  const set = (k: keyof typeof f) =>
    (e: { target: { value: string } }) =>
      setF((current) => ({ ...current, [k]: e.target.value }));

  function changeWorkspace(id: string) {
    setActiveWorkspaceId(id);
    setSel(null);
    setRev((r) => r + 1);
    setF(emptyFilters());
  }

  if (!workspacesLoaded) {
    return <div className="empty">Loading your workspaces…</div>;
  }

  return (
    <>
      <h1>EA Command Inbox</h1>

      {err && (
        <div className="msg err" role="alert">
          {err}
        </div>
      )}

      {workspaces.length === 0 ? (
        <div className="empty">
          No executive workspaces are assigned to your account yet.
          Ask your administrator to assign you to a workspace.
        </div>
      ) : (
        <>
          <div className="card">
            <label htmlFor="ea-workspace">Active executive workspace</label>
            <select
              id="ea-workspace"
              value={activeWorkspaceId}
              onChange={(e) => changeWorkspace(e.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.executive_name}
                </option>
              ))}
            </select>

            {activeWorkspace && (
              <p className="small">
                Showing submissions and work for{" "}
                <b>{activeWorkspace.executive_name}</b>.
              </p>
            )}
          </div>

          <div className="stats">
            {tiles.map(([l, n, st, sp]) => (
              <button
                key={l}
                className="stat"
                onClick={() => setF((current) => ({
                  ...current,
                  status: st,
                  sp,
                }))}
              >
                <b>{n}</b>
                <span>{l}</span>
              </button>
            ))}
          </div>

          <div className="grid cols">
            <div>
              <div className="filters">
                <input
                  aria-label="Search"
                  placeholder="Search text, people, notes…"
                  value={f.q}
                  onChange={set("q")}
                />

                <select
                  aria-label="Status"
                  value={f.status}
                  onChange={set("status")}
                >
                  <option value="">All statuses</option>
                  <option>Trash</option>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>

                <select
                  aria-label="Category"
                  value={f.cat}
                  onChange={set("cat")}
                >
                  <option value="">All categories</option>
                  {EA_CATS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>

                <select
                  aria-label="Timing"
                  value={f.time}
                  onChange={set("time")}
                >
                  <option value="">All timing</option>
                  {TIMES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>

                <input
                  type="date"
                  aria-label="Submitted since"
                  value={f.from}
                  onChange={set("from")}
                />

                <select
                  aria-label="Project"
                  value={f.project}
                  onChange={set("project")}
                >
                  <option value="">All projects</option>
                  {projects.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>

                <select
                  aria-label="Sort"
                  value={f.sort}
                  onChange={set("sort")}
                >
                  <option value="new">Newest first</option>
                  <option value="urgency">Sort: urgency</option>
                  <option value="deadline">Sort: deadline</option>
                  <option value="status">Sort: status</option>
                </select>
              </div>

              <div className="btns" style={{ margin: "10px 0" }}>
                <button onClick={() => exp("csv")}>Export CSV</button>
                <button onClick={() => exp("json")}>Export JSON</button>
              </div>

              {!loaded ? (
                <div className="empty">Loading inbox…</div>
              ) : !entries.length ? (
                <div className="empty">
                  No submissions yet for {activeWorkspace?.executive_name}.
                </div>
              ) : !view.length ? (
                <div className="empty">
                  Nothing matches these filters.
                </div>
              ) : (
                view.map((e) => (
                  <div
                    key={e.id}
                    className={"row" + (sel === e.id ? " sel" : "")}
                    tabIndex={0}
                    role="button"
                    onClick={() => {
                      setSel(e.id);
                      setRev((r) => r + 1);
                    }}
                    onKeyDown={(k) => {
                      if (k.key === "Enter" || k.key === " ") {
                        k.preventDefault();
                        setSel(e.id);
                        setRev((r) => r + 1);
                      }
                    }}
                  >
                    <div className="t">{label(e)}</div>
                    <div className="m">
                      <span className={"tag s-" + sc(e.status)}>
                        {e.status}
                      </span>
                      {e.blocked && (
                        <span className="tag s-Blocked">Blocked</span>
                      )}
                      {overdue(e) && (
                        <span className="tag s-Overdue">Overdue</span>
                      )}
                      {e.project && <span>{e.project}</span>}
                      {(e.category || e.timing) && (
                        <span>
                          {[e.category, e.timing].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      <span>{when(e.created_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              {cur && (
                <Detail
                  key={cur.id + ":" + rev}
                  entry={cur}
                  entries={entries}
                  links={links}
                  workspaceId={activeWorkspaceId}
                  reload={load}
                  onGone={() => setSel(null)}
                  onOpen={(id) => {
                    setSel(id);
                    setRev((r) => r + 1);
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Detail({
  entry,
  entries,
  links,
  workspaceId,
  reload,
  onGone,
  onOpen,
}: {
  entry: Entry;
  entries: Entry[];
  links: { a: string; b: string }[];
  workspaceId: string;
  reload: () => Promise<void>;
  onGone: () => void;
  onOpen: (id: string) => void;
}) {
  const pick = (e: Entry) => ({
    title: e.title,
    category: e.category,
    timing: e.timing,
    next_action: e.next_action,
    owner: e.owner,
    collab: e.collab,
    deadline: e.deadline ?? "",
    deps: e.deps,
    dest: e.dest,
    project: e.project,
    exec_link: e.exec_link,
    clarify: e.clarify,
    blocked: e.blocked,
    private_notes: e.private_notes,
    share_next: e.share_next,
    needs_decision: e.needs_decision,
  });

  const [d, setD] = useState(() => pick(entry));
  const [ver, setVer] = useState(entry.version);
  const [msg, setMsg] = useState<Msg>(null);
  const [ask, setAsk] = useState<"" | "trash" | "purge">("");
  const [splitTxt, setSplitTxt] = useState(original(entry));
  const [lk, setLk] = useState("");
  const busy = useRef(false);

  const orig = original(entry);
  const trashed = !!entry.trashed_at;

  const mine = links
    .filter((l) => l.a === entry.id || l.b === entry.id)
    .map((l) =>
      entries.find((e) => e.id === (l.a === entry.id ? l.b : l.a))
    )
    .filter((e): e is Entry => !!e);

  const kids = entries.filter((e) => e.parent_id === entry.id);
  const parent = entries.find((e) => e.id === entry.parent_id);

  const others = entries.filter(
    (e) =>
      e.id !== entry.id &&
      !e.trashed_at &&
      !mine.some((m) => m.id === e.id)
  );

  const patchOf = (extra: Partial<Entry> = {}): Partial<Entry> => ({
    ...d,
    deadline: d.deadline || null,
    ...extra,
  });

  async function run(fn: () => Promise<string>, after?: () => void) {
    if (busy.current) return;

    busy.current = true;

    try {
      const t = await fn();
      setMsg({ k: "ok", t });
      await reload();
      after?.();
    } catch (e) {
      setMsg({
        k: "err",
        t:
          "Not saved — " +
          (e as Error).message +
          ". Your edits are still on screen; press the button again to retry.",
      });
    } finally {
      busy.current = false;
    }
  }

  const stamp = () =>
    new Date().toLocaleTimeString([], { timeStyle: "short" });

  const save = (
    extra: Partial<Entry> = {},
    text = "Saved"
  ) =>
    run(async () => {
      const n = await saveEntry(
        entry,
        ver,
        patchOf(extra),
        workspaceId
      );

      setVer(n.version);
      return `${text} ${stamp()}`;
    });

  const stale = entry.version !== ver;

  const inp = (
    k: keyof typeof d,
    lab: string,
    type = "text"
  ) => (
    <div>
      <label htmlFor={"d-" + k}>{lab}</label>
      <input
        id={"d-" + k}
        type={type}
        value={String(d[k] ?? "")}
        onChange={(e) =>
          setD({ ...d, [k]: e.target.value })
        }
      />
    </div>
  );

  return (
    <div className="card">
      <h2>Submission</h2>

      <p className="small">
        ID {entry.id}
        {entry.parent_id ? " · split entry" : ""}
        <br />
        Received {when(entry.created_at)} · Status:{" "}
        <b>{entry.status}</b>
      </p>

      {stale && (
        <div className="msg warn" role="alert">
          This entry changed elsewhere. Saving is blocked so nothing is
          overwritten. Reload it to see the latest.
        </div>
      )}

      <label>Original text (unedited)</label>
      <div className="orig">{orig}</div>

      {entry.thoughts &&
        (entry.thoughts.people ||
          entry.thoughts.deps ||
          entry.thoughts.deadline) && (
          <p className="small">
            From executive — people: {entry.thoughts.people || "—"} ·
            deadline: {entry.thoughts.deadline || "—"} · dependencies:{" "}
            {entry.thoughts.deps || "—"}
          </p>
        )}

      {parent && (
        <p className="small">
          Split from original:{" "}
          <a
            href="#ea"
            onClick={(e) => {
              e.preventDefault();
              onOpen(parent.id);
            }}
          >
            {label(parent)}
          </a>
        </p>
      )}

      {kids.length > 0 && (
        <p className="small">
          Split into{" "}
          {kids.map((k) => (
            <a
              key={k.id}
              href="#ea"
              onClick={(e) => {
                e.preventDefault();
                onOpen(k.id);
              }}
              style={{ marginRight: 8 }}
            >
              {label(k)}
            </a>
          ))}
        </p>
      )}

      {inp("title", "Structured title")}

      <div className="grid two">
        <div>
          <label htmlFor="d-category">Category</label>
          <select
            id="d-category"
            value={d.category}
            onChange={(e) =>
              setD({ ...d, category: e.target.value })
            }
          >
            <option value="">—</option>
            {EA_CATS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="d-timing">Timing</label>
          <select
            id="d-timing"
            value={d.timing}
            onChange={(e) =>
              setD({ ...d, timing: e.target.value })
            }
          >
            <option value="">—</option>
            {TIMES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
      </div>

      {inp("next_action", "Next action")}

      <div className="grid two">
        {inp("owner", "Proposed owner")}
        {inp("collab", "Collaborators")}
        {inp("deadline", "Deadline", "date")}
        {inp("dest", "Destination project / tool")}
      </div>

      {inp("deps", "Dependencies")}

      <div className="grid two">
        {inp("project", "Related project")}
        {inp("exec_link", "Execution link")}
      </div>

      {inp("clarify", "Clarification question")}

      <label
        style={{
          textTransform: "none",
          letterSpacing: 0,
          fontSize: 14,
        }}
      >
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={d.blocked}
          onChange={(e) =>
            setD({ ...d, blocked: e.target.checked })
          }
        />{" "}
        Blocked
      </label>

      <label htmlFor="d-share">
        Update your boss will see (not private)
      </label>
      <input
        id="d-share"
        value={d.share_next}
        placeholder="e.g. Booked for Friday; need your OK on budget"
        onChange={(e) =>
          setD({ ...d, share_next: e.target.value })
        }
      />

      <label
        style={{
          textTransform: "none",
          letterSpacing: 0,
          fontSize: 14,
        }}
      >
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={d.needs_decision}
          onChange={(e) =>
            setD({ ...d, needs_decision: e.target.checked })
          }
        />{" "}
        Awaiting his decision
      </label>

      <label htmlFor="d-notes">Private processing notes</label>
      <textarea
        id="d-notes"
        rows={4}
        value={d.private_notes}
        onChange={(e) =>
          setD({ ...d, private_notes: e.target.value })
        }
      />

      <label>Set status</label>
      <p className="small">
        Status changes only when you press a button. “Transferred to
        Execution” means you moved it yourself; Orbit has no connection
        to other tools.
      </p>

      <div className="btns">
        {STATUSES.slice(1).map((s) => (
          <button
            key={s}
            className={entry.status === s ? "p" : ""}
            onClick={() =>
              void save({ status: s as Status }, "Status saved")
            }
          >
            {s}
          </button>
        ))}
      </div>

      <div className="btns" style={{ marginTop: 12 }}>
        <button className="p" onClick={() => void save()}>
          Save changes
        </button>
      </div>

      {msg && (
        <div
          className={"msg " + msg.k}
          role={msg.k === "err" ? "alert" : "status"}
        >
          {msg.t}
        </div>
      )}

      {trashed ? (
        <>
          <div className="msg warn">
            This entry is in Trash. It is hidden from the inbox and from
            your boss.
          </div>

          <div className="btns">
            <button
              onClick={() =>
                void save({ trashed_at: null }, "Restored")
              }
            >
              Restore
            </button>
            <button onClick={() => setAsk("purge")}>
              Delete permanently…
            </button>
          </div>
        </>
      ) : (
        <div className="btns" style={{ marginTop: 12 }}>
          <button onClick={() => setAsk("trash")}>
            Move to trash…
          </button>
        </div>
      )}

      {ask === "trash" && (
        <div className="msg warn">
          Move to Trash? It disappears from the inbox and from your
          boss’s list. The original text, your notes, links and any split
          entries are kept, and you can restore it from Trash.

          <div className="btns">
            <button
              className="p"
              onClick={() =>
                void save(
                  { trashed_at: new Date().toISOString() },
                  "Moved to Trash"
                ).then(() => setAsk(""))
              }
            >
              Yes, move to trash
            </button>
            <button onClick={() => setAsk("")}>Cancel</button>
          </div>
        </div>
      )}

      {ask === "purge" && (
        <div className="msg err">
          Delete permanently? This erases the original submission, your
          notes and fields, and the copy your boss sees. {mine.length}{" "}
          linked entr{mine.length === 1 ? "y loses its link" : "ies lose their links"}
          {kids.length
            ? ` and ${kids.length} split entr${
                kids.length === 1 ? "y is" : "ies are"
              } kept as separate entries`
            : ""}
          . This cannot be undone.

          <div className="btns">
            <button
              className="p"
              onClick={() =>
                void run(async () => {
                  await purge(entry.id, workspaceId);
                  return "Deleted.";
                }, onGone)
              }
            >
              Yes, delete forever
            </button>
            <button onClick={() => setAsk("")}>Cancel</button>
          </div>
        </div>
      )}

      <details>
        <summary>Split into separate entries</summary>
        <p className="small">
          Separate thoughts with a blank line. The original stays
          untouched.
        </p>

        <textarea
          rows={6}
          value={splitTxt}
          onChange={(e) => setSplitTxt(e.target.value)}
          aria-label="Text to split"
        />

        <div className="btns">
          <button
            onClick={() => {
              const parts = splitTxt
                .split(/\n\s*\n/)
                .map((s) => s.trim())
                .filter(Boolean);

              if (parts.length < 2) {
                return setMsg({
                  k: "warn",
                  t: "Add a blank line between thoughts to split.",
                });
              }

              void run(async () => {
                await splitEntry(entry, parts, workspaceId);
                return `Created ${parts.length} linked entries.`;
              });
            }}
          >
            Create entries
          </button>
        </div>
      </details>

      <details>
        <summary>Related entries ({mine.length})</summary>

        <p className="small">
          {mine.map((m) => (
            <a
              key={m.id}
              href="#ea"
              style={{ display: "block" }}
              onClick={(e) => {
                e.preventDefault();
                onOpen(m.id);
              }}
            >
              {label(m)}
            </a>
          ))}
          {!mine.length && "None yet."}
        </p>

        <select
          aria-label="Link to"
          value={lk}
          onChange={(e) => setLk(e.target.value)}
        >
          <option value="">Link to…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {label(o).slice(0, 60)}
            </option>
          ))}
        </select>

        <div className="btns">
          <button
            disabled={!lk}
            onClick={() =>
              void run(async () => {
                await linkEntries(entry.id, lk, workspaceId);
                setLk("");
                return "Linked.";
              })
            }
          >
            Link
          </button>
        </div>
      </details>
    </div>
  );
}
