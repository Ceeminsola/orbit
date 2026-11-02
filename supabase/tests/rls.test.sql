-- RLS behaviour tests. Local Postgres: run 00_local_stubs.sql, then 0001_orbit.sql, then this file as superuser.
\set ON_ERROR_STOP on
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',coalesce(u::text,''),false); reset role; set role authenticated; end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$ begin reset role; set role anon; end $$;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
create function pg_temp.ok(c boolean, n text) returns void language plpgsql as $$ begin
  if not c then raise exception 'FAIL: %', n; end if; raise notice 'PASS: %', n; end $$;

reset role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000e'),('00000000-0000-0000-0000-0000000000b1'),('00000000-0000-0000-0000-0000000000b2');
insert into public.profiles(id,role) values ('00000000-0000-0000-0000-00000000000e','ea'),('00000000-0000-0000-0000-0000000000b1','executive'),('00000000-0000-0000-0000-0000000000b2','executive');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into public.thoughts(text,category,executive_id,created_at) values ('boss thought','Idea','00000000-0000-0000-0000-0000000000b2','2000-01-01');
select pg_temp.ok((select executive_id from public.thoughts)='00000000-0000-0000-0000-0000000000b1' and (select created_at from public.thoughts)>'2020-01-01','forged owner and timestamp are overridden by the server');
select pg_temp.ok(pg_temp.fails($q$insert into public.thoughts(text) values ('   ')$q$),'blank text rejected');
select pg_temp.ok((select count(*) from public.entries)=0,'executive cannot read entries (private notes table)');
select pg_temp.ok(pg_temp.fails($q$insert into public.entries(executive_id) values ('00000000-0000-0000-0000-0000000000b1')$q$),'executive cannot create entries');
select pg_temp.ok(pg_temp.fails($q$update public.thoughts set text='tampered'$q$),'executive cannot edit own original');
select pg_temp.ok((select text from public.thoughts)='boss thought','original unchanged');
delete from public.thoughts; select pg_temp.ok((select count(*) from public.thoughts)=1,'executive cannot delete own original');
select pg_temp.ok(pg_temp.fails($q$update public.profiles set role='ea'$q$),'executive cannot promote self');
select pg_temp.ok(pg_temp.fails($q$select public.purge_entry(gen_random_uuid())$q$),'executive cannot call purge');
select pg_temp.ok((select count(*) from public.audit_log)=0,'executive reads zero audit rows');
select pg_temp.ok((select count(*) from public.executive_updates)=1,'executive sees own update row');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
insert into public.thoughts(text) values ('boss2 thought');
select pg_temp.ok((select count(*) from public.thoughts)=1 and (select text from public.thoughts)='boss2 thought','second executive sees only own thoughts');
select pg_temp.ok((select count(*) from public.executive_updates)=1,'second executive sees only own updates');
select pg_temp.as_anon();
select pg_temp.ok(pg_temp.fails($q$select * from public.thoughts$q$),'anonymous visitor cannot read thoughts');
select pg_temp.ok(pg_temp.fails($q$insert into public.thoughts(text,executive_id) values ('x','00000000-0000-0000-0000-0000000000b1')$q$),'anonymous visitor cannot write');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.ok((select count(*) from public.thoughts)=2 and (select count(*) from public.entries)=2,'EA sees all thoughts and entries');
create temp table ctx as select e.id, e.version, e.executive_id from public.entries e join public.thoughts t on t.id=e.thought_id where t.text='boss thought';
grant all on ctx to authenticated;
update public.entries set status='Structured', private_notes='PRIVATE', share_next='Booked Friday', needs_decision=true where id=(select id from ctx);
select pg_temp.ok((select version from public.entries where id=(select id from ctx))=2,'version incremented on update');
select pg_temp.ok((select count(*) from public.entries where id=(select id from ctx) and version=1)=0,'stale version no longer matches (client detects conflict)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok((select status||share_next from public.executive_updates)='StructuredBooked Friday','executive sees status and shared update');
select pg_temp.ok(not exists(select 1 from public.executive_updates where to_jsonb(executive_updates)::text like '%PRIVATE%'),'private notes never reach executive view');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
update public.entries set trashed_at=now() where id=(select id from ctx);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok((select count(*) from public.executive_updates)=0,'trashed entry disappears from executive view');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
insert into public.entries(parent_id,executive_id,text) select id,executive_id,'split child' from ctx;
select public.purge_entry((select id from ctx));
select pg_temp.ok((select count(*) from public.thoughts where text='boss thought')=0 and (select count(*) from public.entries where id=(select id from ctx))=0,'purge removes original and entry');
select pg_temp.ok((select count(*) from public.entries where text='split child' and parent_id is null)=1,'split child kept, parent link cleared');
select pg_temp.ok((select count(*) from public.thoughts where text='boss2 thought')=1,'other executive untouched by purge');
select pg_temp.ok((select count(*) from public.audit_log)>=3,'audit log recorded changes');
reset role;
