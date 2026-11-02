-- Orbit schema + Row Level Security. Run in the Supabase SQL editor (or `supabase db push`).
create extension if not exists pgcrypto;

create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('executive','ea')),
  display_name text, created_at timestamptz not null default now());

create function public.is_ea() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.profiles where id=auth.uid() and role='ea') $$;
create function public.is_member() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.profiles where id=auth.uid()) $$;

-- Original submissions: immutable, server-stamped.
create table public.thoughts(
  id uuid primary key default gen_random_uuid(), legacy_id text unique,
  executive_id uuid not null references public.profiles(id),
  text text not null check (length(btrim(text))>0),
  category text, timing text, people text, deadline date, deps text,
  created_at timestamptz not null default now());

-- EA working record: one per thought, plus split entries. EA-only (holds private notes).
create table public.entries(
  id uuid primary key default gen_random_uuid(), legacy_id text unique,
  thought_id uuid unique references public.thoughts(id) on delete set null,
  parent_id uuid references public.entries(id) on delete set null,
  executive_id uuid not null references public.profiles(id),
  text text,
  status text not null default 'New' check (status in ('New','Reviewed','Needs Clarification','Structured','In Progress','Transferred to Execution','Completed','Archived')),
  title text not null default '', category text not null default '', timing text not null default '',
  next_action text not null default '', owner text not null default '', collab text not null default '',
  deadline date, deps text not null default '', dest text not null default '', project text not null default '',
  exec_link text not null default '', clarify text not null default '', blocked boolean not null default false,
  private_notes text not null default '',
  share_next text not null default '', needs_decision boolean not null default false,
  trashed_at timestamptz, version int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);

create table public.entry_links(
  a uuid not null references public.entries(id) on delete cascade,
  b uuid not null references public.entries(id) on delete cascade,
  primary key(a,b), check (a<b));

-- What the executive may see. Contains NO private notes; filled only by trigger.
create table public.executive_updates(
  entry_id uuid primary key references public.entries(id) on delete cascade,
  executive_id uuid not null, thought_id uuid, status text not null,
  share_next text not null default '', needs_decision boolean not null default false,
  trashed boolean not null default false, updated_at timestamptz not null default now());

create table public.audit_log(
  id bigserial primary key, at timestamptz not null default now(), actor uuid,
  table_name text, row_id uuid, action text, old_row jsonb, new_row jsonb);

-- Triggers --------------------------------------------------------------
create function public.thoughts_guard() returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' and auth.uid() is not null then  -- clients cannot forge owner or time
    new.executive_id:=auth.uid(); new.created_at:=now(); end if;
  if tg_op='UPDATE' then raise exception 'original submissions are immutable'; end if;
  return new; end $$;
create trigger thoughts_guard before insert or update on public.thoughts for each row execute function public.thoughts_guard();

create function public.thought_to_entry() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.entries(thought_id,executive_id,category,timing,deadline,deps,collab,created_at)
  values(new.id,new.executive_id,coalesce(new.category,''),coalesce(new.timing,''),new.deadline,coalesce(new.deps,''),coalesce(new.people,''),new.created_at);
  return new; end $$;
create trigger thought_to_entry after insert on public.thoughts for each row execute function public.thought_to_entry();

create function public.entries_guard() returns trigger language plpgsql as $$
begin
  new.executive_id:=old.executive_id; new.thought_id:=old.thought_id;
  new.version:=old.version+1; new.updated_at:=now(); new.updated_by:=auth.uid(); return new; end $$;
create trigger entries_guard before update on public.entries for each row execute function public.entries_guard();

create function public.sync_exec_update() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.thought_id is not null then
    insert into public.executive_updates(entry_id,executive_id,thought_id,status,share_next,needs_decision,trashed,updated_at)
    values(new.id,new.executive_id,new.thought_id,new.status,new.share_next,new.needs_decision,new.trashed_at is not null,now())
    on conflict(entry_id) do update set status=excluded.status,share_next=excluded.share_next,
      needs_decision=excluded.needs_decision,trashed=excluded.trashed,updated_at=excluded.updated_at;
  end if; return new; end $$;
create trigger sync_exec_update after insert or update on public.entries for each row execute function public.sync_exec_update();

create function public.audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_log(actor,table_name,row_id,action,old_row,new_row)
  values(auth.uid(),tg_table_name,coalesce((to_jsonb(new)->>'id'),(to_jsonb(old)->>'id'))::uuid,tg_op,
    case when tg_op<>'INSERT' then to_jsonb(old) end, case when tg_op<>'DELETE' then to_jsonb(new) end);
  return null; end $$;
create trigger audit_entries after update or delete on public.entries for each row execute function public.audit();
create trigger audit_thoughts after delete on public.thoughts for each row execute function public.audit();

-- Permanent delete: one transaction, EA only. Split children survive (parent_id set null).
create function public.purge_entry(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  if not public.is_ea() then raise exception 'not allowed'; end if;
  select thought_id into t from public.entries where id=p_id;
  delete from public.entries where id=p_id;
  if t is not null then delete from public.thoughts where id=t; end if;
end $$;
revoke all on function public.purge_entry(uuid) from public, anon;
grant execute on function public.purge_entry(uuid) to authenticated;

-- RLS: deny by default ---------------------------------------------------
alter table public.profiles enable row level security;
alter table public.thoughts enable row level security;
alter table public.entries enable row level security;
alter table public.entry_links enable row level security;
alter table public.executive_updates enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (id=auth.uid() or public.is_ea());
create policy thoughts_read on public.thoughts for select to authenticated using (executive_id=auth.uid() or public.is_ea());
create policy thoughts_insert on public.thoughts for insert to authenticated with check (public.is_member() and executive_id=auth.uid());
create policy thoughts_ea_delete on public.thoughts for delete to authenticated using (public.is_ea());
create policy entries_ea on public.entries for all to authenticated using (public.is_ea()) with check (public.is_ea());
create policy links_ea on public.entry_links for all to authenticated using (public.is_ea()) with check (public.is_ea());
create policy updates_read on public.executive_updates for select to authenticated
  using ((executive_id=auth.uid() and not trashed) or public.is_ea());
create policy audit_read on public.audit_log for select to authenticated using (public.is_ea());

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.profiles, public.executive_updates, public.audit_log to authenticated;
grant select, insert, delete on public.thoughts to authenticated;
grant select, insert, update, delete on public.entries, public.entry_links to authenticated;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.entries, public.thoughts, public.executive_updates, public.entry_links;
end if; end $$;
