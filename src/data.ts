// The ONLY module that talks to Supabase tables.
import { supabase } from "./lib/supabase";
import type { Entry, Thought, Update } from "./types";
function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
export interface NewThought { text: string; category: string; timing: string; people: string; deadline: string; deps: string }
/** Resolves only after the row has been written AND read back identically. */
export async function submitThought(i: NewThought): Promise<Thought> {
  const t = must(await supabase.from("thoughts").insert({ text: i.text, category: i.category || null, timing: i.timing || null, people: i.people || null, deadline: i.deadline || null, deps: i.deps || null }).select().single<Thought>());
  const back = must(await supabase.from("thoughts").select("id,text").eq("id", t.id).single<{ id: string; text: string }>());
  if (back.text !== i.text) throw new Error("Could not confirm the save.");
  return t;
}
export const myThoughts = async () => must(await supabase.from("thoughts").select("*").order("created_at", { ascending: false }).returns<Thought[]>());
export const myUpdates = async () => must(await supabase.from("executive_updates").select("*").returns<Update[]>());
export const allEntries = async () => must(await supabase.from("entries").select("*, thoughts(*)").order("created_at", { ascending: false }).returns<Entry[]>());
export const allLinks = async () => must(await supabase.from("entry_links").select("a,b").returns<{ a: string; b: string }[]>());
/** Optimistic concurrency: fails (instead of overwriting) if someone else changed the row. */
export async function saveEntry(e: Entry, openedVersion: number, patch: Partial<Entry>): Promise<Entry> {
  const { data, error } = await supabase.from("entries").update(patch).eq("id", e.id).eq("version", openedVersion).select().maybeSingle<Entry>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This entry was changed elsewhere. Reload it before saving so nothing is overwritten.");
  return data;
}
export async function purge(id: string): Promise<void> {
  const { error } = await supabase.rpc("purge_entry", { p_id: id });
  if (error) throw new Error(error.message);
  const { data } = await supabase.from("entries").select("id").eq("id", id).maybeSingle();
  if (data) throw new Error("The entry could not be deleted.");
}
export async function splitEntry(parent: Entry, texts: string[]): Promise<void> {
  const rows = texts.map(t => ({ parent_id: parent.id, executive_id: parent.executive_id, text: t, status: "Reviewed", category: parent.category, timing: parent.timing, project: parent.project }));
  const kids = must(await supabase.from("entries").insert(rows).select("id").returns<{ id: string }[]>());
  await Promise.all(kids.map(k => linkEntries(parent.id, k.id)));
}
export async function linkEntries(x: string, y: string): Promise<void> {
  const [a, b] = x < y ? [x, y] : [y, x];
  const { error } = await supabase.from("entry_links").insert({ a, b });
  if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
}
export function subscribe(tables: string[], cb: () => void): () => void {
  const ch = supabase.channel("orbit-" + Math.random().toString(36).slice(2));
  tables.forEach(table => ch.on("postgres_changes", { event: "*", schema: "public", table }, cb));
  ch.subscribe();
  return () => { void supabase.removeChannel(ch); };
}
