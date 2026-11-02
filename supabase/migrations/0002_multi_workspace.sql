BEGIN;

-- =========================================================
-- 1. WORKSPACES AND MEMBERSHIPS
-- =========================================================

CREATE TABLE public.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    executive_id uuid NOT NULL UNIQUE
        REFERENCES public.profiles(id) ON DELETE RESTRICT,
    name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, executive_id)
);

CREATE TABLE public.workspace_members (
    workspace_id uuid NOT NULL
        REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL
        REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_idx
ON public.workspace_members(user_id);


-- Only executive accounts can own workspaces.
CREATE OR REPLACE FUNCTION public.workspace_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.executive_id <> OLD.executive_id THEN
        RAISE EXCEPTION 'Workspace ownership cannot be changed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = NEW.executive_id
          AND role = 'executive'
    ) THEN
        RAISE EXCEPTION 'Workspace owner must be an executive';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_owner_guard
BEFORE INSERT OR UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.workspace_owner_guard();


-- Only the owner and EA accounts can be members.
-- Membership changes are performed by an administrator.
CREATE OR REPLACE FUNCTION public.workspace_member_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner uuid;
    v_role text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'Workspace memberships cannot be updated';
    END IF;

    SELECT executive_id
    INTO v_owner
    FROM public.workspaces
    WHERE id = NEW.workspace_id;

    SELECT role
    INTO v_role
    FROM public.profiles
    WHERE id = NEW.user_id;

    IF v_owner IS NULL OR v_role IS NULL THEN
        RAISE EXCEPTION 'Workspace or profile does not exist';
    END IF;

    IF NEW.user_id = v_owner AND v_role <> 'executive' THEN
        RAISE EXCEPTION 'Workspace owner must have executive role';
    END IF;

    IF NEW.user_id <> v_owner AND v_role <> 'ea' THEN
        RAISE EXCEPTION 'Only EAs can be added as additional members';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_members_guard
BEFORE INSERT OR UPDATE ON public.workspace_members
FOR EACH ROW
EXECUTE FUNCTION public.workspace_member_guard();


CREATE OR REPLACE FUNCTION public.prevent_workspace_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.workspaces
        WHERE id = OLD.workspace_id
          AND executive_id = OLD.user_id
    ) THEN
        RAISE EXCEPTION 'The executive owner cannot be removed';
    END IF;

    RETURN OLD;
END;
$$;

CREATE TRIGGER workspace_owner_membership_protected
BEFORE DELETE ON public.workspace_members
FOR EACH ROW
EXECUTE FUNCTION public.prevent_workspace_owner_removal();


-- Create a workspace automatically when an executive profile is created.
CREATE OR REPLACE FUNCTION public.provision_executive_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_workspace_id uuid;
BEGIN
    IF NEW.role = 'executive' THEN
        INSERT INTO public.workspaces(executive_id)
        VALUES (NEW.id)
        RETURNING id INTO v_workspace_id;

        INSERT INTO public.workspace_members(workspace_id, user_id)
        VALUES (v_workspace_id, NEW.id);
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_provision_workspace
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.provision_executive_workspace();


-- Backfill workspaces for any existing executive profiles.
INSERT INTO public.workspaces(executive_id)
SELECT id
FROM public.profiles
WHERE role = 'executive'
ON CONFLICT (executive_id) DO NOTHING;

INSERT INTO public.workspace_members(workspace_id, user_id)
SELECT id, executive_id
FROM public.workspaces
ON CONFLICT DO NOTHING;


-- =========================================================
-- 2. ADD WORKSPACE OWNERSHIP TO EXISTING TABLES
-- =========================================================

ALTER TABLE public.thoughts
ADD COLUMN workspace_id uuid;

ALTER TABLE public.entries
ADD COLUMN workspace_id uuid,
ADD COLUMN assigned_ea_id uuid,
ADD COLUMN created_by uuid REFERENCES public.profiles(id);

ALTER TABLE public.executive_updates
ADD COLUMN workspace_id uuid;

ALTER TABLE public.entry_links
ADD COLUMN workspace_id uuid;

ALTER TABLE public.audit_log
ADD COLUMN workspace_id uuid;


-- Populate workspace IDs using each executive's workspace.
UPDATE public.thoughts t
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.executive_id = t.executive_id;

UPDATE public.entries e
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.executive_id = e.executive_id;

UPDATE public.executive_updates u
SET workspace_id = e.workspace_id
FROM public.entries e
WHERE e.id = u.entry_id;

UPDATE public.entry_links l
SET workspace_id = a.workspace_id
FROM public.entries a, public.entries b
WHERE a.id = l.a
  AND b.id = l.b
  AND a.workspace_id = b.workspace_id;

-- Preserve existing audit history by resolving the executive
-- from the old or new JSON record.
UPDATE public.audit_log a
SET workspace_id = w.id
FROM public.workspaces w
WHERE COALESCE(
    NULLIF(a.new_row ->> 'executive_id', '')::uuid,
    NULLIF(a.old_row ->> 'executive_id', '')::uuid
) = w.executive_id;


-- Abort if any existing record cannot be mapped safely.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.thoughts
        WHERE workspace_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Migration stopped: a thought has no executive workspace';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.entries
        WHERE workspace_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Migration stopped: an entry has no executive workspace';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.executive_updates
        WHERE workspace_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Migration stopped: an update has no workspace';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.entry_links
        WHERE workspace_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Migration stopped: a link is missing or crosses workspaces';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.audit_log
        WHERE workspace_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Migration stopped: some audit records cannot be mapped safely';
    END IF;
END;
$$;


ALTER TABLE public.thoughts
ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.entries
ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.executive_updates
ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.entry_links
ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.audit_log
ALTER COLUMN workspace_id SET NOT NULL;


-- =========================================================
-- 3. DATABASE CONSTRAINTS
-- =========================================================

ALTER TABLE public.thoughts
ADD CONSTRAINT thoughts_workspace_owner_fk
FOREIGN KEY (workspace_id, executive_id)
REFERENCES public.workspaces(id, executive_id);

ALTER TABLE public.entries
ADD CONSTRAINT entries_workspace_owner_fk
FOREIGN KEY (workspace_id, executive_id)
REFERENCES public.workspaces(id, executive_id);

ALTER TABLE public.entries
ADD CONSTRAINT entries_id_workspace_unique
UNIQUE (id, workspace_id);

ALTER TABLE public.entries
ADD CONSTRAINT entries_assigned_ea_membership_fk
FOREIGN KEY (workspace_id, assigned_ea_id)
REFERENCES public.workspace_members(workspace_id, user_id);

ALTER TABLE public.entries
ADD CONSTRAINT entries_parent_workspace_fk
FOREIGN KEY (parent_id, workspace_id)
REFERENCES public.entries(id, workspace_id);

ALTER TABLE public.executive_updates
ADD CONSTRAINT updates_workspace_owner_fk
FOREIGN KEY (workspace_id, executive_id)
REFERENCES public.workspaces(id, executive_id);

ALTER TABLE public.executive_updates
ADD CONSTRAINT updates_entry_workspace_fk
FOREIGN KEY (entry_id, workspace_id)
REFERENCES public.entries(id, workspace_id)
ON DELETE CASCADE;

ALTER TABLE public.entry_links
ADD CONSTRAINT entry_links_a_workspace_fk
FOREIGN KEY (a, workspace_id)
REFERENCES public.entries(id, workspace_id)
ON DELETE CASCADE;

ALTER TABLE public.entry_links
ADD CONSTRAINT entry_links_b_workspace_fk
FOREIGN KEY (b, workspace_id)
REFERENCES public.entries(id, workspace_id)
ON DELETE CASCADE;

ALTER TABLE public.audit_log
ADD CONSTRAINT audit_workspace_fk
FOREIGN KEY (workspace_id)
REFERENCES public.workspaces(id);


CREATE INDEX thoughts_workspace_created_idx
ON public.thoughts(workspace_id, created_at DESC);

CREATE INDEX entries_workspace_created_idx
ON public.entries(workspace_id, created_at DESC);

CREATE INDEX entries_assigned_ea_idx
ON public.entries(assigned_ea_id);

CREATE INDEX updates_workspace_updated_idx
ON public.executive_updates(workspace_id, updated_at DESC);

CREATE INDEX audit_workspace_at_idx
ON public.audit_log(workspace_id, at DESC);


-- =========================================================
-- 4. WORKSPACE SECURITY HELPERS
-- =========================================================

CREATE OR REPLACE FUNCTION public.is_workspace_member(
    p_workspace_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members
        WHERE workspace_id = p_workspace_id
          AND user_id = auth.uid()
    );
$$;


CREATE OR REPLACE FUNCTION public.is_workspace_ea(
    p_workspace_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        JOIN public.profiles p ON p.id = wm.user_id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND p.role = 'ea'
    );
$$;


CREATE OR REPLACE FUNCTION public.is_workspace_executive(
    p_workspace_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspaces w
        JOIN public.profiles p ON p.id = w.executive_id
        WHERE w.id = p_workspace_id
          AND w.executive_id = auth.uid()
          AND p.role = 'executive'
    );
$$;


CREATE OR REPLACE FUNCTION public.can_view_profile(
    p_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p_profile_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM public.workspace_members mine
            JOIN public.workspace_members theirs
              ON theirs.workspace_id = mine.workspace_id
            WHERE mine.user_id = auth.uid()
              AND theirs.user_id = p_profile_id
        );
$$;


REVOKE ALL ON FUNCTION public.is_workspace_member(uuid)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.is_workspace_ea(uuid)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.is_workspace_executive(uuid)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.can_view_profile(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_workspace_ea(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_workspace_executive(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid)
TO authenticated;


-- =========================================================
-- 5. UPDATE THOUGHT AND ENTRY TRIGGERS
-- =========================================================

-- Executives alone can submit original thoughts.
-- The database stamps their identity and workspace.
CREATE OR REPLACE FUNCTION public.thoughts_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_workspace_id uuid;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Original submissions are immutable';
    END IF;

    IF auth.uid() IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND role = 'executive'
        ) THEN
            RAISE EXCEPTION
                'Only an executive may submit an original thought';
        END IF;

        SELECT id
        INTO v_workspace_id
        FROM public.workspaces
        WHERE executive_id = auth.uid();

        IF v_workspace_id IS NULL THEN
            RAISE EXCEPTION
                'No executive workspace exists for this account';
        END IF;

        NEW.executive_id := auth.uid();
        NEW.workspace_id := v_workspace_id;
        NEW.created_at := now();
    END IF;

    RETURN NEW;
END;
$$;


-- Automatically create the EA working entry for each thought.
CREATE OR REPLACE FUNCTION public.thought_to_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.entries (
        thought_id,
        executive_id,
        workspace_id,
        category,
        timing,
        deadline,
        deps,
        collab,
        created_at,
        created_by
    )
    VALUES (
        NEW.id,
        NEW.executive_id,
        NEW.workspace_id,
        COALESCE(NEW.category, ''),
        COALESCE(NEW.timing, ''),
        NEW.deadline,
        COALESCE(NEW.deps, ''),
        COALESCE(NEW.people, ''),
        NEW.created_at,
        auth.uid()
    );

    RETURN NEW;
END;
$$;


-- Derive workspace for split entries from their parent.
-- Prevent cross-workspace parent/thought relationships.
CREATE OR REPLACE FUNCTION public.entries_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent_workspace uuid;
    v_parent_executive uuid;
    v_thought_workspace uuid;
    v_thought_executive uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN

        IF NEW.parent_id IS NOT NULL THEN
            SELECT workspace_id, executive_id
            INTO v_parent_workspace, v_parent_executive
            FROM public.entries
            WHERE id = NEW.parent_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Parent entry does not exist or is inaccessible';
            END IF;

            IF NEW.workspace_id IS NULL THEN
                NEW.workspace_id := v_parent_workspace;
            END IF;

            IF NEW.executive_id IS NULL THEN
                NEW.executive_id := v_parent_executive;
            END IF;

            IF NEW.workspace_id <> v_parent_workspace
               OR NEW.executive_id <> v_parent_executive THEN
                RAISE EXCEPTION 'Split entries must remain in their parent workspace';
            END IF;
        END IF;

        IF NEW.thought_id IS NOT NULL THEN
            SELECT workspace_id, executive_id
            INTO v_thought_workspace, v_thought_executive
            FROM public.thoughts
            WHERE id = NEW.thought_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Original thought does not exist or is inaccessible';
            END IF;

            IF NEW.workspace_id IS NULL THEN
                NEW.workspace_id := v_thought_workspace;
            END IF;

            IF NEW.executive_id IS NULL THEN
                NEW.executive_id := v_thought_executive;
            END IF;

            IF NEW.workspace_id <> v_thought_workspace
               OR NEW.executive_id <> v_thought_executive THEN
                RAISE EXCEPTION 'Entry and original thought must share a workspace';
            END IF;
        END IF;

        IF NEW.workspace_id IS NULL OR NEW.executive_id IS NULL THEN
            RAISE EXCEPTION 'An entry must belong to an executive workspace';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.workspaces
            WHERE id = NEW.workspace_id
              AND executive_id = NEW.executive_id
        ) THEN
            RAISE EXCEPTION 'Invalid executive workspace';
        END IF;

        IF NEW.parent_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM public.entries
               WHERE id = NEW.parent_id
                 AND workspace_id = NEW.workspace_id
           ) THEN
            RAISE EXCEPTION 'Parent entry belongs to another workspace';
        END IF;

        IF NEW.thought_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM public.thoughts
               WHERE id = NEW.thought_id
                 AND workspace_id = NEW.workspace_id
           ) THEN
            RAISE EXCEPTION 'Original thought belongs to another workspace';
        END IF;

        IF NEW.assigned_ea_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM public.workspace_members wm
               JOIN public.profiles p ON p.id = wm.user_id
               WHERE wm.workspace_id = NEW.workspace_id
                 AND wm.user_id = NEW.assigned_ea_id
                 AND p.role = 'ea'
           ) THEN
            RAISE EXCEPTION 'Assigned EA must belong to this workspace';
        END IF;

        IF auth.uid() IS NOT NULL THEN
            NEW.created_by := auth.uid();
        END IF;

        RETURN NEW;
    END IF;

    -- Preserve ownership and original submission on updates.
    NEW.workspace_id := OLD.workspace_id;
    NEW.executive_id := OLD.executive_id;
    NEW.thought_id := OLD.thought_id;
    NEW.created_by := OLD.created_by;

    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();

    IF NEW.parent_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.entries
           WHERE id = NEW.parent_id
             AND workspace_id = OLD.workspace_id
       ) THEN
        RAISE EXCEPTION 'Parent entry belongs to another workspace';
    END IF;

    IF NEW.assigned_ea_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.workspace_members wm
           JOIN public.profiles p ON p.id = wm.user_id
           WHERE wm.workspace_id = OLD.workspace_id
             AND wm.user_id = NEW.assigned_ea_id
             AND p.role = 'ea'
       ) THEN
        RAISE EXCEPTION 'Assigned EA must belong to this workspace';
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS entries_guard ON public.entries;

CREATE TRIGGER entries_guard
BEFORE INSERT OR UPDATE ON public.entries
FOR EACH ROW
EXECUTE FUNCTION public.entries_guard();


-- =========================================================
-- 6. EXECUTIVE UPDATES AND AUDIT LOGGING
-- =========================================================

CREATE OR REPLACE FUNCTION public.sync_exec_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.thought_id IS NOT NULL THEN
        INSERT INTO public.executive_updates (
            entry_id,
            executive_id,
            workspace_id,
            thought_id,
            status,
            share_next,
            needs_decision,
            trashed,
            updated_at
        )
        VALUES (
            NEW.id,
            NEW.executive_id,
            NEW.workspace_id,
            NEW.thought_id,
            NEW.status,
            NEW.share_next,
            NEW.needs_decision,
            NEW.trashed_at IS NOT NULL,
            now()
        )
        ON CONFLICT (entry_id)
        DO UPDATE SET
            executive_id = EXCLUDED.executive_id,
            workspace_id = EXCLUDED.workspace_id,
            thought_id = EXCLUDED.thought_id,
            status = EXCLUDED.status,
            share_next = EXCLUDED.share_next,
            needs_decision = EXCLUDED.needs_decision,
            trashed = EXCLUDED.trashed,
            updated_at = EXCLUDED.updated_at;
    END IF;

    RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row jsonb;
    v_workspace_id uuid;
    v_row_id uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_row := to_jsonb(OLD);
    ELSE
        v_row := to_jsonb(NEW);
    END IF;

    v_workspace_id := NULLIF(v_row ->> 'workspace_id', '')::uuid;
    v_row_id := NULLIF(v_row ->> 'id', '')::uuid;

    INSERT INTO public.audit_log (
        actor,
        table_name,
        row_id,
        action,
        old_row,
        new_row,
        workspace_id
    )
    VALUES (
        auth.uid(),
        TG_TABLE_NAME,
        v_row_id,
        TG_OP,
        CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
        v_workspace_id
    );

    RETURN NULL;
END;
$$;


-- =========================================================
-- 7. ENTRY LINK PROTECTION
-- =========================================================

CREATE OR REPLACE FUNCTION public.entry_links_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_a uuid;
    v_b uuid;
BEGIN
    SELECT workspace_id
    INTO v_a
    FROM public.entries
    WHERE id = NEW.a;

    SELECT workspace_id
    INTO v_b
    FROM public.entries
    WHERE id = NEW.b;

    IF v_a IS NULL OR v_b IS NULL OR v_a <> v_b THEN
        RAISE EXCEPTION
            'Related entries must belong to the same workspace';
    END IF;

    NEW.workspace_id := v_a;

    RETURN NEW;
END;
$$;

CREATE TRIGGER entry_links_workspace_guard
BEFORE INSERT OR UPDATE ON public.entry_links
FOR EACH ROW
EXECUTE FUNCTION public.entry_links_guard();


-- =========================================================
-- 8. PERMANENT DELETE
-- =========================================================

CREATE OR REPLACE FUNCTION public.purge_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_thought_id uuid;
    v_workspace_id uuid;
BEGIN
    SELECT thought_id, workspace_id
    INTO v_thought_id, v_workspace_id
    FROM public.entries
    WHERE id = p_id;

    IF v_workspace_id IS NULL
       OR NOT public.is_workspace_ea(v_workspace_id) THEN
        RAISE EXCEPTION
            'Not allowed to permanently delete this entry';
    END IF;

    DELETE FROM public.entries
    WHERE id = p_id;

    IF v_thought_id IS NOT NULL THEN
        DELETE FROM public.thoughts
        WHERE id = v_thought_id;
    END IF;
END;
$$;


-- =========================================================
-- 9. REMOVE OLD GLOBAL POLICIES
-- =========================================================

DROP POLICY IF EXISTS profiles_read ON public.profiles;
DROP POLICY IF EXISTS thoughts_read ON public.thoughts;
DROP POLICY IF EXISTS thoughts_insert ON public.thoughts;
DROP POLICY IF EXISTS thoughts_ea_delete ON public.thoughts;
DROP POLICY IF EXISTS entries_ea ON public.entries;
DROP POLICY IF EXISTS links_ea ON public.entry_links;
DROP POLICY IF EXISTS updates_read ON public.executive_updates;
DROP POLICY IF EXISTS audit_read ON public.audit_log;


-- =========================================================
-- 10. WORKSPACE-SCOPED ROW LEVEL SECURITY
-- =========================================================

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;


CREATE POLICY workspaces_member_read
ON public.workspaces
FOR SELECT TO authenticated
USING (public.is_workspace_member(id));


CREATE POLICY workspace_members_shared_read
ON public.workspace_members
FOR SELECT TO authenticated
USING (
    user_id = auth.uid()
    OR public.is_workspace_member(workspace_id)
);


CREATE POLICY profiles_shared_read
ON public.profiles
FOR SELECT TO authenticated
USING (public.can_view_profile(id));


-- Executives and assigned EAs can read original thoughts.
CREATE POLICY thoughts_workspace_read
ON public.thoughts
FOR SELECT TO authenticated
USING (public.is_workspace_member(workspace_id));


-- Only the executive owner can submit original thoughts.
CREATE POLICY thoughts_executive_insert
ON public.thoughts
FOR INSERT TO authenticated
WITH CHECK (
    executive_id = auth.uid()
    AND public.is_workspace_executive(workspace_id)
);


-- Full entries are EA-only.
CREATE POLICY entries_workspace_ea_select
ON public.entries
FOR SELECT TO authenticated
USING (public.is_workspace_ea(workspace_id));


CREATE POLICY entries_workspace_ea_insert
ON public.entries
FOR INSERT TO authenticated
WITH CHECK (public.is_workspace_ea(workspace_id));


CREATE POLICY entries_workspace_ea_update
ON public.entries
FOR UPDATE TO authenticated
USING (public.is_workspace_ea(workspace_id))
WITH CHECK (public.is_workspace_ea(workspace_id));


CREATE POLICY entries_workspace_ea_delete
ON public.entries
FOR DELETE TO authenticated
USING (public.is_workspace_ea(workspace_id));


CREATE POLICY links_workspace_ea_all
ON public.entry_links
FOR ALL TO authenticated
USING (public.is_workspace_ea(workspace_id))
WITH CHECK (public.is_workspace_ea(workspace_id));


-- Executives see only their own non-trashed updates.
-- Assigned EAs can see workspace updates.
CREATE POLICY updates_workspace_read
ON public.executive_updates
FOR SELECT TO authenticated
USING (
    public.is_workspace_ea(workspace_id)
    OR (
        public.is_workspace_executive(workspace_id)
        AND NOT trashed
    )
);


-- Audit history is EA-only and workspace-scoped.
CREATE POLICY audit_workspace_ea_read
ON public.audit_log
FOR SELECT TO authenticated
USING (
    workspace_id IS NOT NULL
    AND public.is_workspace_ea(workspace_id)
);


-- =========================================================
-- 11. EXPLICIT TABLE PERMISSIONS
-- =========================================================

REVOKE ALL ON public.workspaces
FROM anon, authenticated;

REVOKE ALL ON public.workspace_members
FROM anon, authenticated;

REVOKE ALL ON public.profiles
FROM anon, authenticated;

REVOKE ALL ON public.thoughts
FROM anon, authenticated;

REVOKE ALL ON public.entries
FROM anon, authenticated;

REVOKE ALL ON public.entry_links
FROM anon, authenticated;

REVOKE ALL ON public.executive_updates
FROM anon, authenticated;

REVOKE ALL ON public.audit_log
FROM anon, authenticated;


GRANT SELECT ON public.workspaces,
                public.workspace_members,
                public.profiles
TO authenticated;

GRANT SELECT, INSERT ON public.thoughts
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.entries, public.entry_links
TO authenticated;

GRANT SELECT ON public.executive_updates,
                public.audit_log
TO authenticated;


REVOKE ALL ON FUNCTION public.purge_entry(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.purge_entry(uuid)
TO authenticated;


-- Remove the old global helper functions.
DROP FUNCTION IF EXISTS public.is_ea();
DROP FUNCTION IF EXISTS public.is_member();


-- =========================================================
-- 12. REALTIME WORKSPACE CHANGES
-- =========================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    ) THEN

        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'workspaces'
        ) THEN
            ALTER PUBLICATION supabase_realtime
            ADD TABLE public.workspaces;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'workspace_members'
        ) THEN
            ALTER PUBLICATION supabase_realtime
            ADD TABLE public.workspace_members;
        END IF;

    END IF;
END;
$$;


COMMIT;