# Brief לסוכן המשך — דו־לשוניות SINAI

הדבק/י את הטקסט הבא לסוכן שממשיך את העבודה:

---

אני צריך/ה להשלים יישום אמיתי של דו־לשוניות (עברית RTL / English LTR) באפליקציית SINAI Concept Room. אל תדמה מצב עובד ואל תפרסם נכסים פרטיים ל־GitHub.

## מיקום וקריאה ראשונית

- Repository: `C:\Users\dtami\daniel-content-site`
- Handoff מלא: `C:\Users\dtami\daniel-content-site\AGENT_HANDOFF.md`
- אתר חי: `https://dtamish.github.io/daniel-content-site/`
- ניהול: `https://dtamish.github.io/daniel-content-site/admin/`

לפני שינוי, קרא/י לפחות את:

1. `AGENT_HANDOFF.md`
2. `src/lib/concept-repository.ts`
3. `src/scripts/review-app.ts`
4. `src/components/ReviewApp.astro`
5. `src/scripts/admin-app.ts`
6. `src/components/AdminApp.astro`
7. `src/styles/global.css`
8. `supabase/migrations/202608060002_bilingual_concepts.sql`
9. `supabase/migrations/202608060003_append_only_reviews.sql`

## מצב עבודה מדויק

### מה כבר קיים

- אפליקציית Astro/Supabase של חדר קונספטים בעברית RTL.
- 22 קונספטים עבריים שפורסמו בעבר, עם PDFs ובאנרים פרטיים ב־Supabase Storage.
- חלון PDF פנימי שמציג `iframe` של קורא ה־PDF הטבעי של הדפדפן, כולל פתיחה מלאה וסגירה. אין להחזיר PDF.js/canvas.
- migration בסיסי לדו־לשוניות כבר נכתב בריפו:
  `supabase/migrations/202608060002_bilingual_concepts.sql`.
  הוא מוסיף `concepts.locale` עם `he` / `en`, default עברית ואינדקסים.
- ב־`AdminApp.astro` כבר יש select בשם `locale` עם `he` / `en`.
- קיימת חבילת ייבוא אנגלית **פרטית ומקומית בלבד**:
  `C:\Users\dtami\Documents\Sinai Concept Review Import English\`
  ובה 18 PDFs ו־18 באנרים.

### מה עדיין לא קיים / לא הושלם

- לא הוכח ש־migration `202608060002_bilingual_concepts.sql` רץ בפרויקט Supabase החי.
- ה־admin runtime (`src/scripts/admin-app.ts`) לא קורא/מעביר/שומר את `locale`; הסלקטור לבדו אינו פונקציונלי.
- `concept-repository.ts` לא מסנן לפי locale ולא טוען שתי חבילות.
- `review-app.ts` לא מחזיק locale state ואין כפתור החלפה עברית/English.
- `BaseLayout.astro` מקובע ל־`<html lang="he" dir="rtl">`.
- אין translation map לממשק: תפריט, כותרות, onboarding, dialogs, labels, החלטות, empty states, aria labels, הודעות שגיאה/סטטוס.
- לא הועלו PDFs/באנרים אנגליים ל־Supabase Storage ולא נוצרו records אנגליים במסד הנתונים.
- אין QA חי שמוכיח מעבר שפה, LTR, reader, mobile או signed URLs באנגלית.

## מגבלת תוכן מחייבת

המסמך האנגלי שסופק מכיל רק **18 קונספטים תואמים**. אסור להמציא או לשכפל כאנגלית מסמך שאין לו מקור. ארבעת הקונספטים העבריים ללא PDF אנגלי עצמאי הם:

- `abraham`
- `esther`
- `moses`
- `ruth`

במצב English יש להציג רק 18 קונספטים עם נכסים אנגליים מאומתים, עד שיועלו מסמכים מורשים לארבעת החסרים.

## יעד UX

ליצור מתג בולט Hebrew / English בדסקטופ ובמובייל. המתג צריך להיות **חם**: בלחיצה השפה מתחלפת מיד, בלי מסך טעינה מלאכותי, ובאותו מעבר מתחלפים יחד:

- `lang` ו־`dir` של המסמך (`he`/`rtl`, `en`/`ltr`);
- כל תפריטי הממשק, ה־dialogs, הודעות העזר וה־ARIA;
- קטלוג הקונספטים, titles, summaries, categories והחלטות;
- באנרים ו־PDFים עם signed URLs של החבילה המתאימה;
- כיוון drawer, טיפוגרפיה ומרווחים;
- כותרת חלון ה־PDF וכל פעולותיו.

שימור UX קיים:

- תמה כהה עם accent כתום, לא ירוק.
- Drawer מימין ב־RTL; יש לבדוק מיקום תקין ב־LTR.
- אין overlay/metadata מיותר על באנרים.
- יחס הבאנרים נשמר.
- ה־PDF חייב להישאר native iframe/browser viewer, עם close ברור ו־Escape.
- בסגירת חלון PDF חובה לנקות `readerFrame.src`.

## תכנית ביצוע נדרשת

1. **בדיקת schema חיה, לפני כתיבה**
   - ודא/י אם `locale` קיים בפרויקט Supabase והאם המיגרציה כבר הופעלה.
   - אם לא, הרץ/י את migration `202608060002_bilingual_concepts.sql` פעם אחת בלבד ובדוק/י constraint, indexes, records עבריים עם `locale='he'`, ו־RLS.
   - אל תריץ/י מחדש migration בסיסי אם הטבלאות כבר קיימות.

2. **TDD / model data**
   - הוסף/י tests לטעינת concepts לפי locale, לקשר `he`/`en`, ולהיעדר ארבעת המסמכים באנגלית.
   - הגדיר/י טיפוס `Locale = 'he' | 'en'` ומקור single source of truth למחרוזות UI.
   - אל תסתמך/י על heuristics של תרגום טקסט עברי; record אנגלי מכיל תוכן אנגלי עצמאי.

3. **Repository / Supabase**
   - הוסף/י locale filter לטעינת concepts.
   - שמור/י locale באפשרות ה־bulk import, ב־storage paths וברשומת concept.
   - הימנע/י מהתנגשות: אותו slug/קונספט יכול להופיע בשתי שפות; השפה היא חלק מהזהות הלוגית.
   - כל PDF/banner נשארים buckets פרטיים בלבד (`concept-pdfs`, `concept-banners`) ומוצגים רק ב־signed URLs קצרי תוקף.
   - אין `service_role` ב־browser, Astro frontend, GitHub Pages, source או GitHub secrets.

4. **Import אנגלית**
   - ודא/י manifest/assets מול חבילת הייבוא האנגלית לפני העלאה.
   - העלה/י רק ל־Supabase Storage הפרטי.
   - צור/י 18 concepts אנגליים במצב draft תחילה; בדוק/י titles, paths, locale, signed URLs וכיסוי.
   - פרסום מחייב פעולה מפורשת של editor אחרי בדיקה. אל תפרסם/י אוטומטית.

5. **Frontend language switch**
   - הטען/י/שמור שתי חבילות בזמן סביר כדי שהמעבר ירגיש מיידי, אך הצג/י רק שפה אחת.
   - החלף/י `document.documentElement.lang` ו־`dir` בלי reload.
   - עדכן/י את כל המחרוזות ותוויות הנגישות, לא רק כותרות.
   - נקי/עדכן signed URLs ו־PDF dialog נכון בעת מעבר שפה או סגירה.
   - ב־English אל תציג/י את ארבעת הקונספטים החסרים.

6. **QA ואימות**
   - הרץ/י:
     ```bash
     npm run check
     npm run build
     npm test
     git diff --check
     ```
   - בדוק/י ב־Edge/Chrome חי: Hebrew desktop/mobile, English desktop/mobile, drawer direction, reader, Escape, full-screen open, signed URL load, history of reviews, refresh and language switch.
   - ודא/י ש־RLS עדיין מגן על drafts ונכסים פרטיים.
   - לפני דיווח על פריסה: commit, push, ואז ודא/י GitHub Actions `success` עבור ה־SHA המדויק.

## מפתחות ושמות מערכות — ללא ערכים

- `PUBLIC_SUPABASE_URL` — `.env` מקומי / GitHub Actions build variable; value `[REDACTED]`.
- `PUBLIC_SUPABASE_ANON_KEY` — `.env` מקומי / GitHub Actions build variable; value `[REDACTED]`.
- `SUPABASE_SERVICE_ROLE_KEY` — CLI מקומי בלבד אם נדרש; never browser/frontend/GitHub Pages; value `[REDACTED]`.
- storage buckets: `concept-banners`, `concept-pdfs`.
- app hooks: `data-review-app`, `data-concept-grid`, `data-reader-dialog`, `data-reader-frame`, `data-reader-fullscreen`, `data-close-reader`, `data-open-drawer`, `data-drawer`, `data-decision-form`.

## בטיחות והחלטות

- Reviews הם היסטוריה עסקית. `202608060003_append_only_reviews.sql` צריך להיות מוחל ומאומת חי לפני טענה שהחלטות בלתי־ניתנות לדריסה.
- אין לחשוף credentials, signed URLs ארוכי־חיים, מקורות SINAI או נכסים פרטיים בצ׳אט/commit.
- אל תחליף/י פונטים ל־ADUMA/ALMONI בלי קובצי WOFF2 מורשים ורישיון web embedding. כרגע לא נמצאו קבצים כאלה מקומית.
- אל תדווח/י “האנגלית הוטמעה” לפני שכל ארבע השכבות — DB, Storage/import, repository ו־frontend hot switch — עובדות ונבדקו חי.

בסוף, החזר/י סיכום עם: commit SHA, סטטוס migration חי, מספר records באנגלית, מספר נכסי PDF/banner באנגלית, תוצאות בדיקות, URL פריסה, ומה נשאר חסום.

---

**נוצר על סמך המצב המאומת ב־2026-08-06.**
