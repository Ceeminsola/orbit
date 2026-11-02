INSERT INTO public.workspace_members (workspace_id, user_id)
SELECT w.id, ea.id
FROM public.workspaces w
CROSS JOIN public.profiles ea
WHERE w.executive_id IN (
  SELECT id
  FROM public.profiles
  WHERE display_name IN ('Executive A', 'Executive B')
    AND role = 'executive'
)
AND ea.display_name = 'Test EA'
AND ea.role = 'ea';