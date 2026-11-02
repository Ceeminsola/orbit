-- Orbit: Multi-workspace verification
-- Read-only checks. Safe to run repeatedly.

-- 1. Confirm required tables and workspace columns.
SELECT
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    table_name IN ('workspaces', 'workspace_members')
    OR (
      table_name IN (
        'thoughts',
        'entries',
        'executive_updates',
        'entry_links',
        'audit_log'
      )
      AND column_name = 'workspace_id'
    )
  )
ORDER BY table_name, ordinal_position;


-- 2. Confirm workspace RLS policies.
SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'workspaces',
    'workspace_members',
    'profiles',
    'thoughts',
    'entries',
    'entry_links',
    'executive_updates',
    'audit_log'
  )
ORDER BY tablename, policyname;


-- 3. Confirm workspace helper functions.
SELECT
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.proconfig AS function_settings,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n
  ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_workspace_member',
    'is_workspace_ea',
    'is_workspace_executive',
    'can_view_profile'
  )
ORDER BY p.proname;


-- 4. Confirm current database record counts.
SELECT
  (SELECT count(*) FROM public.profiles) AS profiles,
  (SELECT count(*) FROM public.workspaces) AS workspaces,
  (SELECT count(*) FROM public.workspace_members) AS memberships,
  (SELECT count(*) FROM public.thoughts) AS thoughts,
  (SELECT count(*) FROM public.entries) AS entries;