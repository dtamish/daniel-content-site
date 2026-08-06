# SINAI Concept Room — Agent Handoff

> **Purpose:** a safe, practical handoff for agents who need to maintain or improve the SINAI concept-approval application.
>
> **Repository:** `C:\Users\dtami\daniel-content-site`  
> **Public site:** `https://dtamish.github.io/daniel-content-site/`  
> **Admin route:** `https://dtamish.github.io/daniel-content-site/admin/`  
> **Architecture:** Astro static frontend on GitHub Pages + Supabase (Auth, Postgres, private Storage).
>
> **Security rule:** secrets, JWTs, access tokens, connection strings, magic links and storage signed URLs must never be committed, copied into this document, or printed in chat. A value is written only as `[REDACTED]`.

---

## 1. Product contract — do not regress

### Audience and purpose

SINAI Concept Room is a fast review surface for concept documents. Its job is to make a reader open a concept PDF naturally, decide, and let the team see the decision history.

### UX decisions that are fixed

- Default language is Hebrew / RTL. English is a true LTR content package, not a translated UI over Hebrew documents. The language switch is hot: no reload, and it swaps `lang`/`dir`, every UI string, the catalogue and the document together.
- Default visual mode is dark, minimal and high-contrast. Accent is orange (`--accent: #ff7a1a`), **not green**.
- The flow is deliberately narrow: say who you are → pick a document → page through it → decide. There is no onboarding tour and no welcome screen; the first thing a visitor sees is the identity question.
- Navigation is three tabs — ממתינים / מאושרים / נדחו — driven by each concept's latest decision. There is no side drawer and no secondary filter list.
- A concept card is intentionally quiet: banner, title, concise description, latest decision. Do not restore decorative metadata overlays such as “PDF” or “בתור לסקירה” over banners.
- Preserve source banner composition. Use only verified, private derivatives if optimizing weight.
- The reader is a full-screen dark surface that renders the document **page by page with PDF.js onto a canvas**: pinch and wheel zoom, drag to pan when zoomed, horizontal swipe or the ‹ › buttons to change page, arrow keys and Escape. It is not an embedded browser viewer, and there is no `iframe`.
- The document ends on the decision: after the last page the pager shows the decision panel. That is where a review is saved.
- Closing the reader must destroy the PDF.js loading task and clear the canvas, so a signed URL is not left live in the page.
- The four permitted decision values are the source of truth in `src/lib/review-state.mjs`:
  1. `priority-approved` — `מאושר להפקה ולקדם במיידי`
  2. `scheduled-approved` — `מאושר להפקה בסדר לוח השידורים`
  3. `hold` — `להמתין עם זה`
  4. `rejected` — `לא מאושר להפקה - לבטל רעיון`
- Reviews are business records. A later decision must be a new historical record, never an edit that erases the earlier decision.
- `localStorage` is only for tutorial/demo convenience. It is never the shared source of truth for real approvals.

### Known content facts

- **Re-typeset Hebrew documents (current):** `C:\Users\dtami\Documents\Sinai Concept Review Import v2\` — 22 concepts, 39 pages, one PDF per concept, plus `manifest.json`, `content_report.txt` and `concepts-final.json`. The source templates had broken right-to-left flow (words, numbers, Latin runs and multi-column cards out of order); the text was re-ordered and re-typeset, and every repair is validated to preserve the exact multiset of non-space characters. `content_report.txt` lists every character that was dropped and why.
- Hebrew source book: `C:\Users\dtami\Downloads\Telegram Desktop\SINAI_Concept_Book_Hebrew_Illustrated_Final.pdf`
- It has 50 pages and 22 concepts. Source pages excluded from concept documents: **1, 2, 3, 11, 41, 44**.
- The verified Hebrew range map is in the private import package at `C:\Users\dtami\Documents\Sinai Concept Review Import\manifest.json`. Important multi-page examples: Abraham 21–24, Esther 25–28, Moses 29–31, Ruth 32–34. Do not split continuation pages.
- English source book: `C:\Users\dtami\Downloads\Telegram Desktop\SINAI_Concept_Book_Long_English_Illustrated.pdf`
- The supplied English source contains 18 direct concept documents, not 22. It has no standalone equivalents for `abraham`, `esther`, `moses`, or `ruth`. Do not invent English PDFs or silently mix languages.
- Private English import package (not public, not GitHub): `C:\Users\dtami\Documents\Sinai Concept Review Import English v2\` — 18 concepts, imported and published 2026-08-06. The `v2` package keeps the supplied PDFs unchanged and corrects only their metadata: 13 of the 18 titles in the original package were rewritten labels rather than the documents' own titles, and five of those named a different concept that also exists in the catalogue.
- **The Hebrew/English mapping is printed in the source.** Every opening page of the English book carries its Hebrew concept number, stored as `concept_number` in the English manifest. It is what confirms that `abraham`, `esther`, `moses` and `ruth` genuinely have no English document.
- The English documents are the originally supplied files, deliberately not re-typeset; their text still has the broken flow that was repaired on the Hebrew side.
- Live state as of 2026-08-06: 22 published Hebrew concepts, 18 published English concepts, 0 reviews.

---

## 2. Repository map

```text
C:\Users\dtami\daniel-content-site\
├── .env.example                         # names of client build variables only
├── .github/workflows/deploy.yml          # GitHub Actions: validate/build/deploy Pages
├── .pages.yml                            # legacy Pages CMS configuration; not concept DB authority
├── astro.config.mjs                      # Astro + base path for GitHub Pages
├── package.json                          # scripts and dependencies
├── README.md                             # older general content-site documentation; this file is concept-room authority
├── SUPABASE_SETUP.md                     # initial Supabase operator setup
├── AGENT_HANDOFF.md                      # this document
├── public/                               # public static assets only; never put SINAI source PDFs/banners here
├── src/
│   ├── components/
│   │   ├── ReviewApp.astro               # public review HTML/dialogs/header/drawer
│   │   └── AdminApp.astro                # editor auth, import and publish HTML
│   ├── data/
│   │   └── demo-concepts.mjs             # local fallback/demo records only
│   ├── layouts/
│   │   └── BaseLayout.astro              # document shell, fonts and global CSS import
│   ├── lib/
│   │   ├── concept-repository.ts         # Supabase reads/writes/signed media URLs, locale filter
│   │   ├── i18n.ts                       # Locale type + the single source of truth for UI strings
│   │   ├── review-state.mjs              # decision labels per locale, tab status, review badges
│   │   └── urls.ts                       # GitHub Pages base-path helper
│   ├── pages/
│   │   ├── index.astro                   # `/` → public concept room
│   │   └── admin.astro                   # `/admin/` → concept administration
│   ├── scripts/
│   │   ├── review-app.ts                 # public runtime state, cards, reader, review UI
│   │   └── admin-app.ts                  # auth/import/publish runtime
│   └── styles/
│       ├── global.css                    # design tokens and shared base styles
│       └── room.css                      # the concept room: header, tabs, cards, reader, decision
├── supabase/
│   └── migrations/
│       ├── 202608050001_concept_approval.sql # base schema/RLS/private buckets
│       ├── 20260805170000_concept_review.sql # review changes
│       ├── 202608060002_bilingual_concepts.sql # locale groundwork — verify/apply before bilingual use
│       └── 202608060003_append_only_reviews.sql # append-only review hardening — verify/apply before claiming it live
├── tests/
│   ├── site.test.mjs                     # static product/regression tests
│   └── concept-admin.test.mjs             # safe admin core tests
└── tools/
    ├── concept-admin-core.mjs             # manifest validation/editor resolution/delete confirmation
    └── concept-admin.mjs                  # local operator CLI; do not put credentials in it
```

### Execution order

```text
Browser request
  → Astro page (`src/pages/index.astro` or `src/pages/admin.astro`)
  → Astro component (`ReviewApp.astro` / `AdminApp.astro`)
  → client script (`review-app.ts` / `admin-app.ts`)
  → repository layer (`concept-repository.ts`)
  → Supabase Auth / Postgres / Storage
  → signed URL only for private banner/PDF display
```

The UI must remain usable in a clearly labelled local demo mode when Supabase public build variables are unavailable. Demo mode is not shared, not durable and not authorization.

---

## 3. Routes, DOM integration keys and page ownership

| Route | Source | Purpose | Important DOM/data keys |
|---|---|---|---|
| `/` | `src/pages/index.astro` → `ReviewApp.astro` | Published catalog, review cards, identity, paged reader | `data-review-app`, `data-concept-grid`, `data-tab`, `data-locale-toggle`, `data-identity-dialog`, `data-reader`, `data-stage`, `data-page-canvas`, `data-decision-slide`, `data-decision-form`, `data-prev`, `data-next` |
| `/admin/` | `src/pages/admin.astro` → `AdminApp.astro` | Magic Link, editor import, publishing | bulk import form, `name="locale"`, publish-drafts control |
| GitHub Pages base | `astro.config.mjs`, `src/lib/urls.ts` | Allows repository deployment under `/daniel-content-site/` | use `withBase(...)`; do not hard-code root-relative app links |

Do not rename `data-*` hooks casually. `review-app.ts` and `admin-app.ts` bind behavior through them.

---

## 4. Frontend state and key files

### `src/scripts/review-app.ts`

This is the public room controller. It:

- loads concepts from Supabase when configured, otherwise `demoConcepts`;
- requests short-lived signed banner/PDF URLs via the repository layer;
- renders concept cards and concise descriptions;
- opens/closes the native PDF dialog;
- asks for a display identity when a reader wants to save a decision;
- filters concepts by the latest decision;
- renders latest reviewer badges plus expandable, chronological decision history.

**Safe rendering rule:** reviewer notes and names must be placed using `textContent` / the existing `create()` helper. Never use `innerHTML` for user-authored notes.

### `src/lib/review-state.mjs`

This file owns decision vocabulary and review aggregation. Keep labels, value keys and filters synchronized with the Postgres `check` constraint.

`getReviewerBadges()` selects the latest review per reviewer. A history view must retain every row, newest first.

### `src/lib/concept-repository.ts`

This is the only browser-facing access layer for Supabase. It should:

- query published concepts and their readable reviews;
- request signed URLs for private `concept-banners` and `concept-pdfs` storage objects;
- insert reviews with the authenticated identity enforced in Postgres;
- avoid any `service_role` logic.

When modifying review reads, select canonical fields needed for history, including `id`, `reviewer_id`, `decision`, `notes`, `created_at`, and `profiles(display_name)`. Prefer returning a database-authoritative row from an insert, or reload state, rather than constructing a fake local reviewer identity.

### Typography

Current public font packages are Assistant and Frank Ruhl Libre, imported in `BaseLayout.astro`; CSS tokens are in `global.css`.

Requested end state is **ADUMA for titles** and **ALMONI for body text**. No verified local font file or web embedding licence was found. Do not download, convert or commit a desktop font without explicit webfont redistribution permission. Once licensed `.woff2` files are supplied, place them in:

```text
public/fonts/aduma-<weight>.woff2
public/fonts/almoni-<weight>.woff2
```

Then define accurate `@font-face` rules in `global.css`, use `font-display: swap`, and point title/body tokens to those families while retaining Hebrew-capable fallbacks. Validate Hebrew, English and mobile rendering before deployment.

---

## 5. Supabase system map

### Tables

| Table | Responsibility | Authority |
|---|---|---|
| `public.profiles` | authenticated user display name, approval, editor role | database/RLS; never client-controlled role claims |
| `public.concepts` | concept metadata, status, storage paths, order and locale groundwork | editor only for changes; public only sees published rows |
| `public.reviews` | decision records, reviewer identity, time, optional notes | append-only history; public visibility only for published concepts |

### Storage buckets

| Bucket | Content | Visibility |
|---|---|---|
| `concept-banners` | private original or verified optimized banners | private; render using short-lived signed URL only |
| `concept-pdfs` | private per-concept PDFs | private; render/open using short-lived signed URL only |

**Never** commit SINAI PDFs, PNGs, WebPs, raw books, manifests containing private asset paths, or signed URLs to GitHub.

### RLS and identity rules

- Magic Link and anonymous sign-in authenticate a user; they do not make the user an editor.
- Editors require both `profiles.is_editor = true` and `profiles.approved = true`.
- Postgres triggers must derive `reviewer_id` from `auth.uid()`; browser identity labels are display-only.
- Public/anonymous visitors may read only published concepts and their permitted reviews.
- `202608060003_append_only_reviews.sql` removes review updates and rejects updates/deletes by trigger. It also stamps server-side creation time so a browser cannot manipulate “latest” ordering.

### Applying migrations safely

**Status warning:** migration files in this repository are not proof they have run in the hosted project. Before deploying code that depends on them, inspect the Supabase SQL Editor/schema and apply missing migrations once, in filename order:

1. `202608050001_concept_approval.sql` — only if base schema does not already exist. Do not blindly rerun it if tables exist.
2. `202608060002_bilingual_concepts.sql` — **applied and verified 2026-08-06**.
3. `202608060003_append_only_reviews.sql` — **applied and verified 2026-08-06**.

There are three migration files, not four. Earlier revisions of this document named a
`20260805170000_concept_review.sql`; no such file exists or is tracked.

Verify after each: table columns, indexes, policies, triggers and bucket privacy. In particular, prove an UPDATE/DELETE of a review is rejected and an INSERT records the server timestamp.

---

## 6. Environment and secret-handling keys

These are **names and locations only**, never values.

| Name / setting | Where it belongs | What it is for | Rule |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | local `.env`; GitHub Actions/Pages build secret/variable | public project URL for the browser client | public build configuration; value is `[REDACTED]` |
| `PUBLIC_SUPABASE_ANON_KEY` | local `.env`; GitHub Actions/Pages build secret/variable | public anon/publishable client key | public build configuration; value is `[REDACTED]` |
| `SUPABASE_SERVICE_ROLE_KEY` | local operator-only environment if ever needed for CLI | privileged server/CLI work only | **never** Astro/browser/GitHub Pages/client repo; value is `[REDACTED]` |
| `.secrets/concept-admin.env` | local, ignored operator file | CLI operator configuration | never commit; all values `[REDACTED]` |
| Supabase Site URL / Redirect URLs | Supabase Dashboard → Authentication | Magic Link redirects | include production `/admin/` and local dev URLs |
| GitHub Pages secrets | GitHub → Settings → Secrets and variables → Actions | build-time public Supabase values | no service role key |

`.env.example` may list names but must not receive actual values. The expected shape is:

```dotenv
PUBLIC_SUPABASE_URL=[REDACTED]
PUBLIC_SUPABASE_ANON_KEY=[REDACTED]
```

No agent is allowed to ask a browser for passwords, paste credentials into source, reveal values in output, or move a credential from a private operator environment to the frontend.

---

## 7. Import and publication workflow

### Private package contract

A valid private import package includes a `manifest.json`, a per-concept PDF directory and a banner directory. Validate before upload:

- every manifest entry has a stable unique ID/slug;
- PDF and banner paths exist and have the expected type;
- source page ranges are the verified inclusive ranges;
- no cover, table-of-contents or section-divider pages are included;
- assets are uploaded only to private buckets;
- imported records begin as drafts unless an editor explicitly publishes them.

### Admin flow

1. Open `/admin/`.
2. Use Magic Link in the same browser.
3. Ensure the authenticated profile is both approved and editor-enabled in Supabase.
4. Select the package locale (`he` or `en`); the UI selector already exists, but the runtime and DB locale import path must be completed and tested before relying on it.
5. Validate manifest/assets before any write.
6. Upload assets to private buckets, create/update records, then inspect the imported draft set.
7. Publish only after deliberate editor confirmation.
8. Verify from an anonymous/public session that only published rows and signed assets load.

### Bilingual implementation status

The migration groundwork exists, and an English package exists privately, but the complete hot language switch is **not yet finished**. A safe implementation must:

- maintain `locale: 'he' | 'en'` in the public application state;
- set `document.documentElement.lang` and `dir` immediately;
- switch all UI strings, menus, descriptions, categories, concept record set, PDFs and banners together;
- cache/preload the two record sets where sensible; do not show an artificial loading screen for a routine switch;
- filter Supabase queries by locale;
- use locale-aware private storage paths and signed URLs;
- show only the 18 validated English documents; do not invent the four missing English source documents;
- make the admin importer persist locale, validate locale packages and avoid slug collisions across languages;
- test desktop/mobile RTL/LTR transitions, reader titles, dialog labels and menu direction.

---

## 8. Quality gates, local commands and deployment

### Prerequisites

Use Node.js compatible with the lockfile/project (README currently states Node 22.12+).

```bash
npm ci
npm run dev
```

### Mandatory verification before every commit/deployment

```bash
npm run check
npm run build
npm test
git diff --check
git status --short
```

`npm run build` already runs Astro checking, static build and the Node test suite. Still run `git diff --check` and inspect status so no private imports/secrets become accidental commits.

### Deployment

1. Commit only intentional source/config/test/documentation changes.
2. Push `main`.
3. Confirm the newest GitHub Actions workflow for the exact commit SHA completed with `success`.
4. Open the public Pages URL in a private/anonymous browser context and verify:
   - catalog loads;
   - banner aspect ratio is natural;
   - drawer opens from RTL right side;
   - PDF dialog opens, scrolls/zooms naturally, expands externally and closes with both button and Escape;
   - decision history displays only permitted published data;
   - no console errors or failed Supabase/media requests.

Never claim deployment from a successful `git push` alone.

---

## 9. Tests and maintenance discipline

- Start behavior changes with a focused test in `tests/site.test.mjs` or `tests/concept-admin.test.mjs`.
- Do not replace a failed real integration with mock-looking output. Fix, rerun and report tool evidence.
- Check migrations against a real Supabase instance before saying they are live.
- Keep secure behavior at the database/RLS layer; client UI is not an authorization mechanism.
- Build nodes with safe DOM APIs; review notes are user-controlled content.
- Do not refactor PDF reader, review persistence and bilingual architecture together without regression tests; they are independent risk zones.
- Keep commits focused and deploy only after the quality gates pass.

---

## 10. Current backlog / blockers

1. **Apply and verify Supabase migrations** `202608060002` and `202608060003` in the hosted project.
2. **Complete bilingual runtime:** locale state, data queries, UI translation map, signed assets, importer persistence and responsive RTL/LTR QA.
3. **Import English package** after migration/runtime completion. It has 18 validated concepts and deliberately omits Abraham/Esther/Moses/Ruth.
4. **Obtain licensed ADUMA and ALMONI WOFF2 webfonts** before font integration.
5. **Verify live append-only review behavior** with a real editor and anonymous reader, including visible history and no data loss.
6. **Consider verified WebP derivatives** in private storage only. A tested candidate at width 1280/quality 84 reduced the Hebrew banner set substantially; re-verify visual quality and update DB paths before adopting it.
7. **Create a final Edge/mobile QA checklist** for the reader dialog, the language switch, signed URL expiry and review history.

---

## 11. Fast operational checklist for the next agent

- [ ] Read this document, `SUPABASE_SETUP.md`, the relevant migration and the target component/script before changing anything.
- [ ] Confirm whether the request touches public frontend, Supabase schema, private assets, or all four.
- [ ] Never expose a credential or private SINAI asset.
- [ ] Add/regress a test first for logic that could lose data, alter decisions or break language/reader behavior.
- [ ] Apply hosted database changes only with explicit authorization and verify them after execution.
- [ ] Run the full quality-gate commands.
- [ ] Confirm the exact Pages workflow SHA succeeded.
- [ ] Perform a real public-browser QA check.
- [ ] Report verified result and named blockers; do not claim a phone ring without user confirmation.
