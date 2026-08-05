# אתר התוכן של דניאל — תשתית חינמית

אתר תוכן עברי, סטטי ו־CMS-ready. התוכן נשמר בקבצים רגילים ב־GitHub, נערך דרך Pages CMS ונפרס אוטומטית ל־GitHub Pages.

## מה כבר קיים

- אתר Astro מהיר, רספונסיבי ובכיוון RTL.
- מאמרים ב־Markdown עם טיוטות, תאריך, תקציר, תגיות ותוכן מוביל.
- הגדרות אתר ב־`src/data/site.json`.
- ממשק עריכה דרך Pages CMS לפי `.pages.yml`.
- RSS, sitemap, כתובות canonical, Open Graph ונתוני Article מובנים.
- בנייה ופריסה אוטומטיות דרך GitHub Actions.
- שערי איכות: Astro check, בדיקת תצורת CMS, קישורים פנימיים, מסלולים, טיוטות ומטא־דאטה.
- אינדוקס חסום כברירת מחדל עד שהנוסח הציבורי מאושר.

## הארכיטקטורה

1. **GitHub** — מקור האמת לקוד, טקסטים, תמונות והיסטוריית שינויים.
2. **Pages CMS** — ממשק עריכה; הוא כותב ישירות לקבצים במאגר ואין לו מסד תוכן נפרד.
3. **Astro** — בונה את הקבצים לעמודים סטטיים.
4. **GitHub Actions + Pages** — מריצים את הבדיקות ומפרסמים את התוצר.

המסלול הזה אינו דורש תשלום חודשי. ב־GitHub Free, GitHub Pages זמין למאגר ציבורי. Pages CMS מציג את עצמו כחינמי וקוד פתוח.

מקורות רשמיים:

- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://docs.astro.build/en/guides/deploy/github/
- https://pagescms.org/docs/
- https://pagescms.org/docs/quick-start/

## עבודה מקומית

דרישות: Node.js 22.12 ומעלה.

```bash
npm ci
npm run dev
```

בדיקה מלאה כמו בפריסה:

```bash
npm run build
```

תצוגת התוצר:

```bash
npm run preview
```

## עריכת תוכן

### דרך ה־CMS

1. פותחים את `/admin/` באתר או נכנסים ל־https://app.pagescms.org/.
2. נכנסים עם GitHub.
3. בפעם הראשונה מתקינים את GitHub App של Pages CMS רק על מאגר האתר.
4. בוחרים `תכנים` או `הגדרות האתר`, עורכים ושומרים.
5. השמירה יוצרת commit; תהליך הפריסה בונה ומפרסם את הגרסה החדשה.

### ישירות בקבצים

- מאמרים: `src/content/posts/*.md`
- טקסטים כלליים: `src/data/site.json`
- תמונות: `public/uploads/`

מאמר חדש נשאר מחוץ לאתר כל עוד `draft: true`.

## פריסה ראשונה

1. יוצרים מאגר ציבורי ודוחפים לענף `main`.
2. ב־GitHub: `Settings` → `Pages` → `Build and deployment` → `Source: GitHub Actions`.
3. ה־workflow שב־`.github/workflows/deploy.yml` יעלה את האתר.
4. אם שם המאגר הוא `<username>.github.io`, האתר יפורסם בשורש. בכל שם אחר Astro גוזר אוטומטית את נתיב המאגר.

אפשר לעקוף את הגזירה באמצעות משתני build:

- `SITE_URL` — ה־origin הציבורי, למשל `https://example.com`.
- `BASE_PATH` — נתיב בסיס, למשל `/content-site`.

## לפני פתיחה למנועי חיפוש

הערך `indexing` ב־`src/data/site.json` הוא כרגע `false`. לאחר החלפת טקסטי הפתיחה ואישור התוכן הציבורי, משנים אותו ל־`true` דרך Pages CMS. אז דפי האתר מקבלים `index, follow` ו־`robots.txt` נפתח לסריקה.

## גבולות וסיכונים

- מאגר ציבורי פירושו שגם קבצי המקור גלויים. אין להכניס סיסמאות, מפתחות או חומר פרטי.
- זו מערכת תוכן לקבצים, לא מערכת משתמשים, מסחר או מסד נתונים.
- Pages CMS הוא שירות חיצוני; גם אם יוחלף בעתיד, התוכן נשאר בקבצים וניתן לעריכה ישירה או להעברה ל־CMS אחר.
- לא צורף רישיון פתוח לתוכן. זכויות התוכן נשארות אצל דניאל.
