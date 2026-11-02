SELECT
  p.display_name AS executive,
  w.id AS workspace_id,
  ea.display_name AS assigned_ea
FROM public.workspaces w
JOIN public.profiles p
  ON p.id = w.executive_id
JOIN public.workspace_members wm
  ON wm.workspace_id = w.id
JOIN public.profiles ea
  ON ea.id = wm.user_id
WHERE ea.display_name = 'Test EA'
ORDER BY p.display_name;