# SINAI Concept Room — מצב תפעולי מאומת

**נכתב:** 2026-08-06  
**ריפו:** `C:\Users\dtami\daniel-content-site`  
**ענף/commit שנבדקו:** `main` / `04e048ba3134d9dbc132c137f330d61bf11b6d65`  
**כלל סודות:** המסמך אינו מכיל URL, JWT, מפתחות, tokens או ערכים של משתני סביבה. שמות משתנים ונתיבי קבצים בלבד.

## 1. שיטת אימות וגבול הראיות

### אומת חי

- האתר החי ב־GitHub Pages הוצג ב־Edge כשהודעת המצב שלו היא: **"מחובר למסד הנתונים — ההחלטות נשמרות לצוות."**
- באותו מסך חי הוצג מונה **22 קונספטים** ונטענו 22 כרטיסי קונספט.
- קובץ המקור היה נקי משינויים tracked מול ה־index בעת הבדיקה (`tracked_worktree_equal_index=0`).
- קומיט `04e048ba3134d9dbc132c137f330d61bf11b6d65` הוא קומיט קיים ב־`main` ועוקב אחרי `origin/main` ללא פער ahead/behind.

### לא ניתן היה לאמת חי

אין בסביבה המקומית קובץ service-role, קובץ `.env`, CLI מחובר ל־Supabase, GitHub CLI מחובר, או דפדפן שכבר פתוח ל־Supabase Dashboard. לכן לא בוצעו SQL או REST מיוחס־מנהל נגד הפרויקט. במיוחד **לא** נטען כאן ש־migration כלשהי הופעלה רק משום שקובץ SQL קיים בריפו.

הסעיפים על סכימה, RLS, triggers ו־Storage מתחת מסומנים במפורש כ־**מוגדרים בקוד** או **לא מאומתים חי**. יש לאמת אותם ב־Supabase SQL Editor או באמצעות service role לפני ייבוא.

---

## 2. מיגרציות: מה קיים בריפו ומה הוכח חי

| מזהה | קובץ במאגר הנוכחי | תפקיד | מצב חי מאומת |
|---|---|---|---|
| `202608050001` | `supabase/migrations/202608050001_concept_approval.sql` | סכימת בסיס, RLS, Auth triggers ו־Storage | לא אומת ברמת catalog; עצם החיבור והצגת 22 קונספטים חיים תואמים לכך שקיימת סכימה תפעולית, אך אינם מוכיחים את כל ה־DDL/policies |
| `202608060002` | `supabase/migrations/202608060002_bilingual_concepts.sql` | `concepts.locale`, indexes דו־לשוניים | לא אומת חי |
| `202608060003` | `supabase/migrations/202608060003_append_only_reviews.sql` | היסטוריית החלטות append-only וחותמת זמן שרת | לא אומת חי |
| migration רביעית | **לא נמצא קובץ רביעי tracked** תחת `supabase/migrations/` ב־commit זה | — | לא ישים עד שמזוהה קובץ/שם מדויק |

### `concepts.locale`

**בקוד המיגרציה:** מוסיפה `locale text NOT NULL DEFAULT 'he' CHECK (locale IN ('he','en'))`, מעדכנת NULL קיימים ל־`he`, מוסיפה index `(publication_status, locale, priority)` ו־unique `(locale, title)`.

**עובדה חיה:** לא ניתן היה להריץ query מול catalog/records עם הרשאות מנהל; לכן לא ניתן לאשר במסמך זה אם העמודה קיימת, מה ה־default האפקטיבי שלה, או ש־22 הרשומות הקיימות הן `locale='he'`.

**בדיקת חובה לפני import:**

```sql
select locale, count(*)
from public.concepts
group by locale
order by locale;
```

התוצאה הצפויה לפני ייבוא אנגלית: שורה אחת `he | 22`.

---

## 3. סכימה ומדיניות — מוגדר בקוד, לא הוכחת catalog חי

### `public.profiles`

מוגדר ב־`202608050001`:

- עמודות: `id uuid PK -> auth.users`, `display_name`, `identity_kind`, `is_editor`, `approved`, `created_at`, `updated_at`.
- constraints: שם באורך 1–80; `identity_kind` מתוך `reviewer/honi/itzik/advisor/editor`; שני booleans עם default `false`.
- trigger: `profiles_set_updated_at` לפני UPDATE.
- RLS: self read; read לציבור רק אם הפרופיל שייך לסקירה של concept מפורסם; editors מאושרים קוראים הכול; יצירת/עדכון עצמי לא־מורשה; editor מאושר מנהל profiles.

### `public.concepts`

מוגדר ב־`202608050001` + `202608060002`:

- עמודות בסיס: `id`, `title`, `description`, `section`, `publication_status`, `priority`, `banner_path`, `pdf_path`, `created_by`, `created_at`, `updated_at`.
- constraints: title 1–140; description 1–500; section `queue/library`; publication status `draft/published`; priority 0–9999; נתיבי media ייחודיים ובפורמט UUID/banners/PDF.
- לאחר migration 002: `locale` כנ"ל.
- indexes: `concepts_public_queue_idx`; לאחר 002 גם `concepts_published_locale_priority_idx`, `concepts_locale_title_unique_idx`.
- trigger: `concepts_set_updated_at` לפני UPDATE.
- RLS: anon/auth קוראים רק published; editor מאושר בלבד insert/update/delete.

### `public.reviews`

מוגדר ב־`202608050001` + `202608060003`:

- עמודות: `id`, `concept_id`, `reviewer_id`, `decision`, `notes`, `created_at`, `updated_at`.
- constraints: decision הוא אחת מ־`priority-approved`, `schedule-approved`, `wait`, `canceled`; notes עד 1,000 תווים.
- index: `reviews_concept_reviewer_latest_idx (concept_id, reviewer_id, created_at DESC)`.
- triggers בסיס: `reviews_set_updated_at`; `reviews_force_authenticated_identity` (כופה `reviewer_id = auth.uid()` ובודק profile מאושר).
- RLS בסיס: public/auth קוראים reviews של concepts מפורסמים; reviewer מאושר יכול insert לעצמו; מדיניות UPDATE ישנה קיימת בבסיס.
- migration 003 אמורה למחוק את מדיניות UPDATE, להוסיף `reviews_stamp_creation` לפני INSERT, ו־`reviews_prevent_update` + `reviews_prevent_delete` שדוחים mutation.

### הוכחת `202608060003` המבוקשת

**לא בוצעה ולא קיימת במסמך זה.** ללא profile מאושר שאפשר להיכנס איתו ובלי service role, ניסיון UPDATE/DELETE אמיתי אינו בר־ביצוע בטוח. אין להסיק מהקוד שה־trigger חי.

יש להריץ לאחר החלת migration, עם review test לא־קריטי ובסשן של אותו reviewer:

1. INSERT עם `created_at` שסופק במכוון כזמן אחר.
2. SELECT של row שנוצר — `created_at` חייב להיות זמן השרת, לא זמן הלקוח.
3. UPDATE של אותו review — חייב להידחות עם `Review history is append-only`.
4. DELETE של אותו review — חייב להידחות עם אותו עקרון.
5. לנקות רק את נתון הבדיקה לפי נוהל מאושר; migration 003 בכוונה מונעת DELETE ולכן יש לתכנן test row שלא מזיק.

### Storage

**מוגדר בקוד:**

| bucket | public | limit | mime |
|---|---:|---:|---|
| `concept-banners` | `false` | 5 MiB | `image/png` |
| `concept-pdfs` | `false` | 25 MiB | `application/pdf` |

RLS מוצהר: קריאה לקובץ רק אם הוא מקושר ל־concept מפורסם, או editor מאושר; insert/update/delete ל־editor מאושר בלבד. הקליינט מציג media באמצעות signed URL לשעה.

**לא אומת חי:** bucket existence, flag private, object policies ורשימת objects דורשים dashboard/admin API.

---

## 4. פרופיל עורך

**לא מאומת.** לא ניתן היה לקרוא `profiles` עם הרשאות editor/admin ולכן שם החשבון ו־UUID של profile עם `is_editor=true AND approved=true` אינם נרשמים כאן.

בדיקת SQL שיש להריץ ב־Supabase SQL Editor:

```sql
select id, display_name, identity_kind, is_editor, approved
from public.profiles
where is_editor = true and approved = true
order by created_at;
```

ה־UUID המוחזר הוא הערך הנכון ל־`CONCEPT_ADMIN_CREATED_BY` אם קיימים יותר מעורך מאושר אחד.

---

## 5. מצב הקוד: locale וייבוא

### מה כבר ממומש ב־front-end

ב־commit הנבדק קיימת שכבת locale בקורא:

- `src/lib/i18n.ts`: `Locale = 'he' | 'en'`, strings, כיווניות RTL/LTR.
- `src/lib/concept-repository.ts`: `loadConcepts(locale)` מסנן `.eq('locale', locale)` וקורא signed URLs לכל שפה.
- `src/data/demo-concepts.mjs`: demo data לפי locale.
- הקורא החי מציג מתג שפה וטאבים/קורא PDF.js לפי החוזה שנדחף ב־`04e048b`.

### מה עדיין לא ממומש ב־ייבוא/admin

**עודכן — הפער נסגר.** הסעיף הזה תיאר את המצב ב־`04e048b`. מאז:

- `parseConceptManifest(manifest, { locale })` קורא ומאמת locale לפי הסדר: override של המפעיל → `item.locale` → `manifest.locale` → `he`. שפה לא מוכרת נדחית ולא מתפרשת בשקט כעברית.
- נוסף `conceptIdentity(locale, title)`, שמשקף את ה־unique index `(locale, title)` שמיגרציה 002 מגדירה. דדופליקציה בייבוא עברה להשתמש בו — ולכן אותה כותרת יכולה להתקיים פעם אחת בכל שפה, וכפילות בתוך אותה שפה עדיין נחסמת.
- `concept-admin.mjs` קיבל `--locale he|en`, שומר `locale` ב־insert, ומדווח locale ב־imported/skipped/failed.
- `admin-app.ts` מעביר locale גם ביצירה ידנית וגם ב־bulk import, ובודק קיימים לפי הזוג.
- `AdminApp.astro` — נוסף בורר שפה גם לטופס הקונספט הבודד; קודם הוא היה רק בטופס הייבוא.
- כיסוי: `tests/concept-admin.test.mjs` מכיל כעת גם בדיקה שמפרסרת את חבילת הייבוא האמיתית ומאמתת 22 פריטים ב־`he`.

**מה נשאר במכוון ללא שינוי:** נתיבי ה־storage נשארים `${uuid}/banner.png` ו־`${uuid}/concept.pdf`. UUID כבר מונע collision, ו־namespace לפי שפה היה מחייב שינוי של check constraints על הנתיבים במיגרציה נוספת — DDL נוסף בתמורה לנוחות ביקורת בלבד. `concept_key` יציב שמקשר בין הגרסה העברית לאנגלית גם הוא נדחה: אין כרגע מיפוי מאומת בין 18 הפריטים האנגליים ל־22 העבריים, וניחוש לפי סדר עדיפות היה יוצר קישור שגוי.

### שינוי נדרש

1. להרחיב schema של manifest/import ל־`locale` (`he`/`en`) ולוודא התאמה לבחירת locale של הטופס.
2. להעביר locale אל `createConcept()` ולהוסיף אותו ל־INSERT.
3. לשנות בדיקת קיימים ל־locale + key יציב. **לא slug לפי title בלבד.** מומלץ להוסיף `concept_key`/`source_id` אחיד לשתי השפות ב־schema, ואז unique `(locale, concept_key)`.
4. להפריד paths, למשל `<locale>/<uuid>/banner.png` ו־`<locale>/<uuid>/concept.pdf`; אם מאמצים זאת, יש לעדכן את check constraints של paths במיגרציה חדשה לפני העלאה.
5. לסנן load/list/publish לפי locale במקומות שבהם הפעולה אמורה להיות שפתית; bulk publish כללי דורש confirmation ספציפי כדי לא לפרסם אנגלית בטעות.
6. לעדכן tests כך שייבוא אותו concept key ב־he ו־en עובר, אבל כפילות באותו locale נחסמת.

---

## 6. manifest v2

נבדק מקומית מול `C:\Users\dtami\Documents\Sinai Concept Review Import v2\manifest.json` באמצעות `parseConceptManifest` הנוכחי.

תוצאה: **PASS**.

- `schema`: `sinai-concept-import-v2`
- `concept_count`: `22`
- `items`: `22`
- parser קיבל את החבילה כפי שהיא, ללא התאמת parser נדרשת עבור השדות הנוכחיים.

הערה: PASS זה מוכיח את parser הקיים בלבד. הוא אינו מאמת locale או source identity, מפני שה־parser הנוכחי עוד אינו יודע אותם.

---

## 7. GitHub Actions variables/secrets

השמות שהפרויקט דורש לפריסת frontend מחובר הם:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

**אומת חי — שניהם מוגדרים.** `gh` אכן אינו זמין, אבל אין בכך צורך: Astro מטמיע ערכי `PUBLIC_*` בזמן בנייה, ולכן נוכחותם בתוצר מוכיחה שהם היו קיימים ב־Actions. בתוצר החי של `04e048b`, הקובץ `_astro/supabase-client.*.js` מכיל הפניה ל־`supabase.co`. אישור עצמאי שני: המסך החי מציג "מחובר למסד הנתונים" וטוען 22 קונספטים, מה שדורש anon key תקף בזמן ריצה.

אין להכניס ערכים למסמך הזה, ל־Git או לצ׳אט.

---

## 8. קבצי credentials מקומיים

נבדקו בשמות בלבד הנתיבים הבאים:

- `C:\Users\dtami\daniel-content-site\.env` — לא קיים.
- `C:\Users\dtami\daniel-content-site\.secrets\concept-admin.env` — לא קיים.
- `C:\Users\dtami\AppData\Local\hermes\.env` — אין בו מפתחות Supabase תואמים.

לא נוצרו קבצים חלקיים, משום שלא קיימים ערכים מלאים ל־`SUPABASE_SERVICE_ROLE_KEY` ול־`CONCEPT_ADMIN_CREATED_BY`. יצירת קובץ ריק הייתה מטעה ולא מאפשרת import.

כשהערכים יימסרו בערוץ פרטי או ימוקמו מקומית בידי בעל החשבון, הקבצים הנדרשים הם:

```dotenv
# .secrets/concept-admin.env — ignored by .gitignore
SUPABASE_URL=[REDACTED]
SUPABASE_SERVICE_ROLE_KEY=[REDACTED]
CONCEPT_ADMIN_CREATED_BY=[REDACTED]
```

```dotenv
# .env — ignored by .gitignore
PUBLIC_SUPABASE_URL=[REDACTED]
PUBLIC_SUPABASE_ANON_KEY=[REDACTED]
```

`.gitignore` כבר מכסה `.env` ואת `.secrets/`.

---

## 8א. מה בוצע בפועל (2026-08-06, אחרי כתיבת המסמך)

- **מיגרציות 002 ו־003 הוחלו ואומתו.** `concepts.locale` קיים, 22 הרשומות הקיימות `he`. על `reviews` נותרו רק מדיניות `INSERT` ו־`SELECT` — מדיניות ה־UPDATE נמחקה, כנדרש.
- **22 המסמכים העבריים הוחלפו במקום** בגרסה המעוצבת מחדש, באמצעות `concept-admin.mjs sync --apply`. הרשומות, המזהים והנתיבים נשמרו; רק תוכן הקבצים והתיאורים התחלפו. אומת: 22/22 תואמים ל־SHA256 של החבילה.
- **18 מסמכים אנגליים יובאו ופורסמו** מ־`Documents\Sinai Concept Review Import English v2`. אומת: 18/18 checksum, ומעבר השפה החי מציג 22 בעברית ו־18 באנגלית.
- **מצב reviews בזמן הביצוע: 0.** לא אבדה היסטוריית החלטות.

### המיפוי בין השפות — נמצא, ולא נוחש

הספר האנגלי מדפיס בכל עמוד פתיחה את מספר הקונספט מהספר העברי: 09, 16, 04, 18, 03, 05, 06, 07, 12, 21, 11, 20, 02, 15, 19, 08, 13, 22. זהו בדיוק סדר `expected_order` העברי בהשמטת 01, 10, 14, 17 — אברהם, אסתר, משה, רות. המספר נשמר כ־`concept_number` בכל פריט במניפסט האנגלי, לצד `id` המשותף לשתי השפות. זה מבטל את ההסתייגות בסעיף 5 לגבי היעדר מיפוי בר־סמכא.

### תיקון מטא־דאטה בחבילה האנגלית

ביקורת מול הספר העלתה שהפירוק לעמודים היה **נכון לחלוטין** — 36/36 עמודי תוכן, ברצף, ללא חפיפה, עם השמטה נכונה של שער, תוכן עניינים וארבעה חוצצי מדור — אבל **13 מתוך 18 הכותרות בחבילה המקורית לא היו הכותרת של המסמך**, אלא תוויות שנכתבו מחדש. חמש מהן הצביעו על קונספט אחר שקיים בקטלוג (למשל `Prophecy` למסמך ההמצאות הישראליות, `Our People` לפודקאסט Prophesizing). חבילת v2 מחליפה אותן בכותרות המודפסות בספר, ואת התיאורים בשורת הפתיחה שכל מסמך מדפיס תחת `THE ORIGINAL DOCUMENT`. ה־PDF עצמם לא שונו.

## 9. חסמים פתוחים

1. ~~אין credential ניהולי מקומי~~ **נסגר** — `.secrets/concept-admin.env` קיים מקומית ופועל.
2. ~~אין הוכחה חיה ש־migration 002 ו־003 הורצו.~~ **נסגר** — ראו §8א.
3. הוכחה התנהגותית ל־immutable reviews עדיין לא בוצעה. הוכחת הקטלוג (טריגרים קיימים, אין מדיניות UPDATE) בוצעה. בדיקה התנהגותית תשאיר שורת בדיקה שלא ניתן למחוק, ולכן נדחתה במכוון.
4. ~~אין הרשאת GitHub API/CLI לאימות שמות GitHub Actions secrets.~~ **נסגר** — ראו §7: שני ה־secrets אומתו דרך התוצר החי.
5. ~~כלי הייבוא עדיין אינו locale-aware.~~ **נסגר** — ראו §5.
6. חבילת אנגלית כוללת 18 documents בלבד; ארבעה concepts (אברהם, אסתר, משה, רות) אין להם מסמך מקור מאושר באנגלית ולכן אינם קיימים במצב English. זו התנהגות מכוונת, לא באג.
9. המסמכים האנגליים הם הגרסה המקורית, לא מעוצבת מחדש. הטקסט בהם עדיין סובל מאותו קיטוע שתוקן בעברית. זו הייתה החלטה מפורשת של בעל הפרויקט.
7. אין webfont מורשה/מקומי מאומת של ADUMA או ALMONI.
8. `AGENT_HANDOFF.md` §5 מפנה למיגרציה `20260805170000_concept_review.sql` שאינה קיימת ואינה tracked. בריפו יש שלושה קבצי מיגרציה בלבד: `202608050001`, `202608060002`, `202608060003`. יש לתקן את ההפניה או לאתר את הקובץ החסר לפני שמסתמכים על רשימת ההחלה.

## 10. תשובה תפעולית: מה אפשר לעשות עצמאית ומה דורש גישה

אפשר לבצע עצמאית את ההחלה, upload, יצירת records ופרסום **לאחר** שקיימים מקומית הקבצים בסעיף 8 והייבוא מתוקן ל־locale-aware. הפעולה יכולה להיעשות ללא דודו אם הקבצים וההרשאות זמינים במחשב זה.

לא ניתן לבצע עצמאית בלי אחד מאלה:

- `SUPABASE_SERVICE_ROLE_KEY` מקומי, או
- session של בעל־פרויקט ב־Supabase Dashboard שמורשה להריץ SQL/manage Storage, או
- גישה מאומתת ל־GitHub Settings כדי לבדוק/לתקן Actions secrets.

אין צורך שדודו יבצע את הלוגיקה עצמה; הוא נדרש רק אם הוא מחזיק את הגישה/הסודות או את סביבת ההרצה היחידה.
