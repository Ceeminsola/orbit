// The ONLY module that talks to Supabase tables.
import { supabase } from "./lib/supabase";
import type { Entry, Thought, Update, Workspace } from "./types";

function must<T>(r: {
  data: T | null;
  error: { message: string } | null;
}): T {
  if (r.error) throw new Error(r.error.message);
  if (r.data === null) throw new Error("No data was returned.");
  return r.data;
}

export interface NewThought {
  text: string;
  category: string;
  timing: string;
  people: string;
  deadline: string;
  deps: string;
}

/**
 * Returns the workspaces the signed-in EA belongs to,
 * together with each executive's display name.
 */
export async function myWorkspaces(): Promise<Workspace[]> {
  const { data: userData, error: userError } =
    await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!userData.user) throw new Error("You are not signed in.");

  const memberships = must(
    await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userData.user.id)
      .returns<{ workspace_id: string }[]>()
  );

  const ids = memberships.map((m) => m.workspace_id);

  if (!ids.length) return [];

  const workspaces = must(
    await supabase
      .from("workspaces")
      .select("id, executive_id")
      .in("id", ids)
      .returns<{ id: string; executive_id: string }[]>()
  );

  if (!workspaces.length) return [];

  const executiveIds = workspaces.map((w) => w.executive_id);

  const profiles = must(
    await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", executiveIds)
      .returns<{ id: string; display_name: string }[]>()
  );

  const names = new Map(
    profiles.map((p) => [p.id, p.display_name])
  );

  return workspaces
    .map((w) => ({
      id: w.id,
      executive_id: w.executive_id,
      executive_name: names.get(w.executive_id) || "Executive",
    }))
    .sort((a, b) =>
      a.executive_name.localeCompare(b.executive_name)
    );
}

/** Resolves only after the row has been written and read back identically. */
export async function submitThought(i: NewThought): Promise<Thought> {
  const t = must(
    await supabase
      .from("thoughts")
      .insert({
        text: i.text,
        category: i.category || null,
        timing: i.timing || null,
        people: i.people || null,
        deadline: i.deadline || null,
        deps: i.deps || null,
      })
      .select()
      .single<Thought>()
  );

  const back = must(
    await supabase
      .from("thoughts")
      .select("id, text")
      .eq("id", t.id)
      .single<{ id: string; text: string }>()
  );

  if (back.text !== i.text) {
    throw new Error("Could not confirm the save.");
  }

  return t;
}

export const myThoughts = async () =>
  must(
    await supabase
      .from("thoughts")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<Thought[]>()
  );

export const myUpdates = async () =>
  must(
    await supabase
      .from("executive_updates")
      .select("*")
      .returns<Update[]>()
  );

/** Loads entries from one explicitly selected workspace only. */
export const allEntries = async (workspaceId: string) => {
  if (!workspaceId) throw new Error("Select a workspace first.");

  return must(
    await supabase
      .from("entries")
      .select("*, thoughts(*)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .returns<Entry[]>()
  );
};

/** Loads links from one explicitly selected workspace only. */
export const allLinks = async (workspaceId: string) => {
  if (!workspaceId) throw new Error("Select a workspace first.");

  return must(
    await supabase
      .from("entry_links")
      .select("a, b")
      .eq("workspace_id", workspaceId)
      .returns<{ a: string; b: string }[]>()
  );
};

/**
 * Optimistic concurrency:
 * fails instead of overwriting if another user changed the row.
 */
export async function saveEntry(
  e: Entry,
  openedVersion: number,
  patch: Partial<Entry>,
  workspaceId: string
): Promise<Entry> {
  if (e.workspace_id !== workspaceId) {
    throw new Error("This entry does not belong to the selected workspace.");
  }

  const { data, error } = await supabase
    .from("entries")
    .update(patch)
    .eq("id", e.id)
    .eq("workspace_id", workspaceId)
    .eq("version", openedVersion)
    .select()
    .maybeSingle<Entry>();

  if (error) throw new Error(error.message);

  if (!data) {
    throw new Error(
      "This entry was changed elsewhere or is no longer available in this workspace. Reload it before saving."
    );
  }

  return data;
}

export async function purge(
  id: string,
  workspaceId: string
): Promise<void> {
  const existing = must(
    await supabase
      .from("entries")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle<{ id: string }>()
  );

  if (!existing) {
    throw new Error("This entry is not in the selected workspace.");
  }

  const { error } = await supabase.rpc("purge_entry", {
    p_id: id,
  });

  if (error) throw new Error(error.message);

  const remaining = must(
    await supabase
      .from("entries")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle<{ id: string }>()
  );

  if (remaining) {
    throw new Error("The entry could not be deleted.");
  }
}

export async function splitEntry(
  parent: Entry,
  texts: string[],
  workspaceId: string
): Promise<void> {
  if (parent.workspace_id !== workspaceId) {
    throw new Error("The original entry is not in the selected workspace.");
  }

  const rows = texts.map((t) => ({
    workspace_id: workspaceId,
    parent_id: parent.id,
    executive_id: parent.executive_id,
    text: t,
    status: "Reviewed",
    category: parent.category,
    timing: parent.timing,
    project: parent.project,
  }));

  const kids = must(
    await supabase
      .from("entries")
      .insert(rows)
      .select("id")
      .returns<{ id: string }[]>()
  );

  await Promise.all(
    kids.map((k) => linkEntries(parent.id, k.id, workspaceId))
  );
}

export async function linkEntries(
  x: string,
  y: string,
  workspaceId: string
): Promise<void> {
  if (x === y) {
    throw new Error("An entry cannot be linked to itself.");
  }

  const matchingEntries = must(
    await supabase
      .from("entries")
      .select("id")
      .in("id", [x, y])
      .eq("workspace_id", workspaceId)
      .returns<{ id: string }[]>()
  );

  if (matchingEntries.length !== 2) {
    throw new Error(
      "Both entries must belong to the selected workspace."
    );
  }

  const [a, b] = x < y ? [x, y] : [y, x];

  const { error } = await supabase
    .from("entry_links")
    .insert({ a, b });

  if (error && !/duplicate/i.test(error.message)) {
    throw new Error(error.message);
  }
}

/** Refreshes only when a change occurs in the selected workspace. */
export function subscribe(
  tables: string[],
  cb: () => void,
  workspaceId?: string
): () => void {
  const ch = supabase.channel(
    "orbit-" + Math.random().toString(36).slice(2)
  );

  tables.forEach((table) => {
    const config: {
      event: "*";
      schema: "public";
      table: string;
      filter?: string;
    } = {
      event: "*",
      schema: "public",
      table,
    };

    if (workspaceId) {
      config.filter = `workspace_id=eq.${workspaceId}`;
    }

    ch.on("postgres_changes", config, cb);
  });

  ch.subscribe();

  return () => {
    void supabase.removeChannel(ch);
  };
}