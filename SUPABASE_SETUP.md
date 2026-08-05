# Supabase setup — חדר קונספטים

Without Supabase the site intentionally runs as a clearly labelled, device-local demo. Complete the steps below for shared concepts, reviews, uploads, and editor access.

## 1. Create and configure the project

1. Create a Supabase project and copy its Project URL and public `anon` / publishable key.
2. Under Authentication → Providers, enable Email and Magic Link.
3. Enable Anonymous Sign-Ins to allow reviewers to submit decisions without email authentication.
4. Under Authentication → URL Configuration, set the production Site URL.
5. Add the exact Redirect URLs you use, for example:
   - `http://localhost:4321/admin/`
   - `http://localhost:4321/daniel-content-site/admin/` when developing with that base path
   - `https://<OWNER>.github.io/daniel-content-site/admin/`
   - the equivalent `/admin/` URL on a custom production domain

## 2. Apply the migration

Run `supabase/migrations/202608050001_concept_approval.sql` with `supabase db push`, or paste the complete file into the Supabase SQL Editor as the project owner.

The migration creates `profiles`, `concepts`, `reviews`, and two private buckets (`concept-banners`, `concept-pdfs`). RLS provides these guarantees:

- the public can read only published concepts, their reviews, reviewer display badges, and media linked to those published concepts;
- only an authenticated profile with both `is_editor = true` and `approved = true` can administer profiles, concepts, and media;
- an authenticated reviewer can insert or update only reviews owned by their `auth.uid()`;
- a database trigger overwrites `reviewer_id` from `auth.uid()`, so the client cannot submit an arbitrary reviewer identity;
- the four decision values and the 500-character description limit are enforced in the database.

## 3. Approve the first editor

1. Open `/admin/`, submit the editor email, and follow the magic link in the same browser.
2. The auth trigger creates a non-privileged profile automatically.
3. In the SQL Editor, approve that profile by email:

```sql
update public.profiles p
set display_name = 'Editor name',
    identity_kind = 'editor',
    is_editor = true,
    approved = true
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('editor@example.com');
```

Sign out and follow a fresh magic link. Picking “עורך תוכן” on the public review screen never grants access.

## 4. Local environment variables

Copy `.env.example` to `.env` and provide only:

```dotenv
PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Never put a `service_role` key in this Astro project. These two values are public by design; authentication and RLS are the security boundary.

## 5. GitHub Secrets

In GitHub, open Settings → Secrets and variables → Actions and add these Repository Secrets (or environment secrets for the Pages environment):

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

Expose them to the build job, for example:

```yaml
jobs:
  build:
    env:
      PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}
      PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.PUBLIC_SUPABASE_ANON_KEY }}
```

Do not add a `service_role` secret. Rebuild the site after changing environment variables. The yellow local-demo notice should be replaced by the connected notice, and `/admin/` should offer magic-link sign-in.
