# Orbit (standalone: React + TypeScript + Vite + Supabase)

Status: **first working draft — NOT yet deployable to real executive data.** See "What is and isn't verified".

## 1. Create the Supabase project
1. Create a project at supabase.com (use separate **staging** and **production** projects).
2. Authentication → Providers → Email: enable. Authentication → Sign-ups: **disable** (invite-only).
3. SQL editor: run `supabase/migrations/0001_orbit.sql` once.
4. Authentication → Users → Add user (email + password) for yourself and your boss.
5. Give each a role (SQL editor), using their user IDs from the Users page:
   ```sql
   insert into public.profiles(id, role, display_name) values
     ('<YOUR-USER-ID>',  'ea',        'EA'),
     ('<BOSS-USER-ID>',  'executive', 'Executive');
   ```
   Roles can only be set here (SQL editor / service role). Clients cannot change them.

## 2. Run locally
```bash
cp .env.example .env.local   # fill in project URL + anon (public) key
npm install
npm run dev                  # http://localhost:5173
npm run typecheck && npm test && npm run build
```
Only the **anon** key goes in `.env.local`. Never use the `service_role` key in the app.

## 3. Deploy (Vercel / Netlify / Cloudflare Pages)
Build command `npm run build`, output `dist`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's environment settings.
Add the deployed URL under Supabase → Authentication → URL Configuration. Serve over HTTPS.
The PWA manifest and `apple-touch-icon` are real files now, so Home Screen icons work on your own domain (still verify on a real iPhone).

## 4. Security model (enforced by Postgres Row Level Security, not the UI)
| Table | Executive | EA |
|---|---|---|
| `thoughts` (originals) | insert + read own; **no edit/delete**; owner and timestamp are forced by the server | read all; delete via purge |
| `entries` (private notes, owner, deadlines…) | **no access** | full |
| `entry_links` | no access | full |
| `executive_updates` (what he sees; no private notes) | read own, non-trashed | read all; written only by trigger |
| `audit_log` | none | read |
| `profiles` | read own | read all; nobody can edit via the API |
Everything is denied by default; `anon` has no table access.

## 5. Tests
* `tests/csv.test.ts` — formula-injection protection (`npm test`).
* `supabase/tests/rls.test.sql` — 25 permission checks. Runs on a local Postgres with `00_local_stubs.sql` (never on Supabase).
  Run on your **staging** Supabase project with real users before launch.

## What is and isn't verified
Verified here: TypeScript typecheck, production build, 7 unit tests, and 25 RLS checks on a local Postgres 16 with a stubbed `auth.uid()`.
NOT verified: any run against real Supabase (auth, realtime, PostgREST); the React screens in a browser; two real accounts end to end; iPhone behaviour.
NOT included yet: legacy data import (`scripts/` is empty by design — back up and dry-run first), duplicate flagging, group-by-project, `#selftest` (replaced by the SQL tests).

## Migrating the existing Claude Artifact data
Do not migrate until a faithful backup exists. Plan: export every document (inbox/*, ea/*, status/*), dry-run an import script on staging, compare counts and links, then cut over. The artifact stays untouched meanwhile.
