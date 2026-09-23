import { collection, doc, getDoc, getDocs, query, runTransaction, setDoc, updateDoc, where } from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { anonymousUser, firestore, storage, isFirebaseConfigured } from '../lib/firebase-client';
import { ensureReviewerSession, refreshMediaUrl, releaseMediaUrls } from '../lib/concept-repository';
import {
  BANNER_ARTWORK, assertBannerSource, bannerLayoutFromPath,
  composeBannerArtwork, versionedArtworkBannerPath,
} from '../lib/banner-artwork.mjs';

const app = document.querySelector<HTMLElement>('[data-admin-app]');
if (app) {
  const required = <T extends Element>(selector: string) => {
    const node = app.querySelector<T>(selector);
    if (!node) throw new Error(`Missing admin element: ${selector}`);
    return node;
  };
  const configuration = required<HTMLElement>('[data-configuration-panel]');
  const authPanel = required<HTMLElement>('[data-auth-panel]');
  const approvalPanel = required<HTMLElement>('[data-approval-panel]');
  const workspace = required<HTMLElement>('[data-editor-workspace]');
  const authStatus = required<HTMLElement>('[data-auth-status]');
  const editorStatus = required<HTMLElement>('[data-editor-status]');
  const conceptForm = required<HTMLFormElement>('[data-concept-form]');
  const description = required<HTMLTextAreaElement>('#concept-description');
  const editForm = required<HTMLFormElement>('[data-edit-form]');
  const editSelect = required<HTMLSelectElement>('[data-edit-concept]');
  const editStatus = required<HTMLElement>('[data-edit-status]');
  type EditableRow = {
    id: string; title: string; description: string; section: string; priority: number;
    locale: string; category?: string; publication_status: string; updated_at?: string;
    banner_path: string | null; pdf_path: string | null;
  };
  let editable: EditableRow[] = [];
  const editorIdentity = { kind: 'content_editor' as const, name: 'עורך/ת תוכן' };
  async function showCurrentState() {
    if (!isFirebaseConfigured) {
      configuration.hidden = false;
      authPanel.hidden = true;
      return;
    }
    const user = await anonymousUser();
    const profile = await getDoc(doc(firestore(), 'profiles', user.uid));
    const authorized = profile.data()?.identity_kind === 'content_editor' && profile.data()?.approved === true;
    authPanel.hidden = authorized;
    approvalPanel.hidden = true;
    workspace.hidden = !authorized;
    if (authorized) await Promise.all([loadConceptList(), loadBannerConcepts(), loadEditable()]);
  }

  async function loadEditable() {
    const previous = editSelect.value;
    editable = (await getDocs(collection(firestore(), 'concepts'))).docs.map((record) => ({ ...record.data(), id: record.id } as EditableRow))
      .sort((a, b) => a.locale.localeCompare(b.locale) || a.priority - b.priority);
    editSelect.replaceChildren(new Option('— בחירת קונספט —', ''));
    for (const row of editable) editSelect.add(new Option(`${row.locale.toUpperCase()} · ${row.title}`, row.id));
    if (editable.some((row) => row.id === previous)) editSelect.value = previous;
    fillEditable();
  }

  function fillEditable() {
    const row = editable.find((item) => item.id === editSelect.value);
    if (!row) { editForm.reset(); return; }
    for (const key of ['title', 'description', 'section', 'locale', 'priority', 'category', 'publication_status'] as const) {
      const control = editForm.elements.namedItem(key) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      control.value = String(row[key] ?? (key === 'category' ? 'series' : ''));
    }
    (editForm.elements.namedItem('banner') as HTMLInputElement).value = '';
    (editForm.elements.namedItem('pdf') as HTMLInputElement).value = '';
    editStatus.textContent = '';
  }
  editSelect.addEventListener('change', fillEditable);

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const row = editable.find((item) => item.id === editSelect.value);
    if (!row) return;
    const form = new FormData(editForm);
    const banner = form.get('banner') as File;
    const pdf = form.get('pdf') as File;
    const newBanner = banner?.size ? banner : null;
    const newPdf = pdf?.size ? pdf : null;
    const title = String(form.get('title') ?? '').trim();
    const text = String(form.get('description') ?? '').trim();
    const priority = Number(form.get('priority'));
    if (!title || !text || text.length > 500 || !Number.isInteger(priority) || priority < 0 || priority > 9999) {
      editStatus.textContent = 'יש להזין כותרת, תיאור עד 500 תווים וסדר תקין.';
      return;
    }
    const button = editForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    editStatus.textContent = 'שומר שינויים…';
    const uploaded: string[] = [];
    let committed = false;
    let attemptedCommit = false;
    let bannerPath: string | null = row.banner_path;
    let pdfPath: string | null = row.pdf_path;
    try {
      await ensureReviewerSession(editorIdentity);
      validateFiles(newBanner, newPdf);
      const nextLocale = asLocale(form.get('locale'));
      const neighbors = await getDocs(query(collection(firestore(), 'concepts'), where('locale', '==', nextLocale)));
      if (neighbors.docs.some((record) => record.id !== row.id && conceptIdentity(nextLocale, record.data().title) === conceptIdentity(nextLocale, title))) {
        throw new Error('קונספט בשם הזה כבר קיים בשפה שנבחרה.');
      }
      bannerPath = newBanner ? `${crypto.randomUUID()}/banner.png` : row.banner_path;
      pdfPath = newPdf ? `${crypto.randomUUID()}/concept.pdf` : row.pdf_path;
      if (newBanner && bannerPath) {
        const path = `concept-banners/${bannerPath}`;
        await uploadBytes(ref(storage(), path), newBanner, { contentType: 'image/png', customMetadata: { conceptId: row.id } });
        uploaded.push(path);
      }
      if (newPdf && pdfPath) {
        const path = `concept-pdfs/${pdfPath}`;
        await uploadBytes(ref(storage(), path), newPdf, { contentType: 'application/pdf', customMetadata: { conceptId: row.id } });
        uploaded.push(path);
      }
      attemptedCommit = true;
      await updateConceptIfUnchanged(row.id, { updated_at: row.updated_at }, {
        title, description: text, priority,
        section: form.get('section') === 'library' ? 'library' : 'queue',
        locale: nextLocale,
        category: String(form.get('category')),
        publication_status: form.get('publication_status') === 'published' ? 'published' : 'draft',
        banner_path: bannerPath, pdf_path: pdfPath,
      });
      committed = true;
      if (newBanner) rememberReplacedBanner(row.id, row.banner_path);
      await Promise.all([loadEditable(), loadConceptList(), loadBannerConcepts()]);
      editStatus.textContent = 'השינויים נשמרו. קבצים ישנים נשארו בארכיון.';
    } catch (error) {
      if (!committed && attemptedCommit) {
        try {
          const current = (await getDoc(doc(firestore(), 'concepts', row.id))).data();
          if (current?.banner_path === bannerPath && current?.pdf_path === pdfPath) committed = true;
        } catch { committed = true; } // uncertain state: never erase potentially referenced objects
      }
      if (committed && newBanner) rememberReplacedBanner(row.id, row.banner_path);
      if (!committed) await Promise.allSettled(uploaded.map((path) => deleteObject(ref(storage(), path))));
      editStatus.textContent = `השמירה נכשלה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה.'}`;
    } finally { button.disabled = false; }
  });

  async function loadConceptList() {
    const list = required<HTMLElement>('[data-admin-concept-list]');
    const data = (await getDocs(collection(firestore(), 'concepts'))).docs.map((item) => ({ ...item.data(), id: item.id } as EditableRow))
      .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))).slice(0, 12);
    list.replaceChildren();
    for (const concept of data) {
      const item = document.createElement('article');
      item.className = 'admin-concept-row';
      const title = document.createElement('h3');
      title.textContent = concept.title;
      const meta = document.createElement('p');
      meta.textContent = `${concept.section === 'queue' ? 'בתור' : 'בספרייה'} · ${concept.publication_status === 'published' ? 'פורסם' : 'טיוטה'}`;
      item.append(title, meta);
      list.append(item);
    }
    if (!list.childElementCount) list.textContent = 'עדיין אין קונספטים.';
  }

  required<HTMLFormElement>('[data-magic-link-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    authStatus.textContent = 'פותח סביבת עריכה…';
    try {
      await ensureReviewerSession(editorIdentity);
      await showCurrentState();
    } catch (error) { authStatus.textContent = error instanceof Error ? error.message : 'הכניסה נכשלה.'; }
  });
  // Leave editor mode without replacing the anonymous uid (and losing ownership of reviews).
  app.querySelectorAll<HTMLButtonElement>('[data-sign-out]').forEach((button) => button.addEventListener('click', async () => {
    await ensureReviewerSession({ kind: 'advisor', name: 'יועץ/ת' });
    localStorage.removeItem('concept-approval:identity');
    location.reload();
  }));

  description.addEventListener('input', () => {
    required<HTMLOutputElement>('[data-description-count]').value = `${description.value.length} / 500`;
  });

  type Locale = 'he' | 'en';

  type ConceptDraft = {
    title: string;
    description: string;
    section: 'queue' | 'library';
    priority: number;
    locale: Locale;
    banner: File | null;
    pdf: File | null;
    published: boolean;
    sourceId?: string | null;
    category?: string;
  };

  type ImportManifest = {
    concept_count?: number;
    locale?: string;
    items?: Array<{
      title?: string;
      description?: string;
      description_draft?: string;
      priority?: number;
      locale?: string;
      id?: string;
      category_key?: string;
      pdf?: string;
      banner?: string;
    }>;
  };

  const asLocale = (value: unknown): Locale => (value === 'en' ? 'en' : 'he');

  // A title may exist once per language, so an existing record is identified by the pair.
  const conceptIdentity = (locale: string, title: string) => `${locale} ${title.trim()}`;

  function validateFiles(banner: File | null, pdf: File | null) {
    if (banner?.size && (banner.type !== 'image/png' || banner.size > 5 * 1024 * 1024)) {
      throw new Error('הבאנר חייב להיות PNG ועד 5MB.');
    }
    if (pdf?.size && (pdf.type !== 'application/pdf' || pdf.size > 25 * 1024 * 1024)) {
      throw new Error('מסמך הקונספט חייב להיות PDF ועד 25MB.');
    }
  }

  async function createConcept(draft: ConceptDraft) {
    await ensureReviewerSession(editorIdentity);
    if (!draft.title || !draft.description) throw new Error('כותרת ותיאור הם שדות חובה.');
    if (draft.description.length > 500) throw new Error('התיאור מוגבל ל־500 תווים.');
    if (!Number.isInteger(draft.priority) || draft.priority < 0 || draft.priority > 9999) throw new Error('סדר התצוגה אינו תקין.');
    if (draft.category && !['FLAGSHIP SERIES', 'series', 'film', 'film-short', 'film-long', 'digital', 'podcast'].includes(draft.category)) {
      throw new Error('סוג הקונספט במניפסט אינו מוכר.');
    }
    validateFiles(draft.banner, draft.pdf);
    const matchingLocale = await getDocs(query(collection(firestore(), 'concepts'), where('locale', '==', draft.locale)));
    if (matchingLocale.docs.some((record) => conceptIdentity(draft.locale, record.data().title) === conceptIdentity(draft.locale, draft.title))) {
      throw new Error('קונספט בשם הזה כבר קיים בשפה שנבחרה.');
    }

    if (draft.sourceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.sourceId)) {
      throw new Error('מזהה מקור במניפסט חייב להיות UUID תקין.');
    }
    const id = draft.sourceId ?? crypto.randomUUID();
    if ((await getDoc(doc(firestore(), 'concepts', id))).exists()) throw new Error('מזהה המקור כבר קיים; אין לדרוס קונספט או היסטוריה.');
    const bannerPath = draft.banner?.size ? `${id}/banner.png` : null;
    const pdfPath = draft.pdf?.size ? `${id}/concept.pdf` : null;
    const reference = doc(firestore(), 'concepts', id);
    const now = new Date().toISOString();
    const uploaded: string[] = [];
    let writing = false;
    try {
      if (bannerPath && draft.banner) {
        await uploadBytes(ref(storage(), `concept-banners/${bannerPath}`), draft.banner, { contentType: 'image/png', customMetadata: { conceptId: id } });
        uploaded.push(`concept-banners/${bannerPath}`);
      }
      if (pdfPath && draft.pdf) {
        await uploadBytes(ref(storage(), `concept-pdfs/${pdfPath}`), draft.pdf, { contentType: 'application/pdf', customMetadata: { conceptId: id } });
        uploaded.push(`concept-pdfs/${pdfPath}`);
      }
      // Do not expose a half-uploaded draft, even to editors.
      writing = true;
      await setDoc(reference, {
        id, title: draft.title, description: draft.description, section: draft.section,
        priority: draft.priority, locale: draft.locale,
        publication_status: draft.published ? 'published' : 'draft',
        banner_path: bannerPath, pdf_path: pdfPath,
        category: draft.category ?? 'series', reviews: [], concept_assessments: null,
        created_at: now, updated_at: now, created_by: (await anonymousUser()).uid,
      });
    } catch (error) {
      // A timed-out write may already have committed. Never delete its referenced files.
      if (writing) {
        try { if ((await getDoc(reference)).exists()) return; }
        catch { throw new Error('מצב השמירה אינו ברור. אין למחוק את הקבצים; בדקו את הרשומה לפני ניסיון נוסף.', { cause: error }); }
      }
      await Promise.allSettled(uploaded.map((path) => deleteObject(ref(storage(), path))));
      throw error;
    }
  }

  function packagePath(file: File) {
    return (file.webkitRelativePath || file.name).replaceAll('\\', '/');
  }

  function packageFile(files: File[], expectedPath: string) {
    const normalized = expectedPath.replaceAll('\\', '/');
    return files.find((file) => packagePath(file) === normalized || packagePath(file).endsWith(`/${normalized}`)) ?? null;
  }

  conceptForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(conceptForm);
    const banner = data.get('banner') as File;
    const pdf = data.get('pdf') as File;
    try {
      editorStatus.textContent = 'שומר…';
      await createConcept({
        title: String(data.get('title') ?? '').trim(),
        description: description.value.trim(),
        section: data.get('section') === 'library' ? 'library' : 'queue',
        priority: Number(data.get('priority')),
        locale: asLocale(data.get('locale')),
        banner: banner?.size ? banner : null,
        pdf: pdf?.size ? pdf : null,
        published: Boolean(data.get('published')),
      });
      editorStatus.textContent = 'הקונספט נשמר בהצלחה.';
      conceptForm.reset();
      required<HTMLOutputElement>('[data-description-count]').value = '0 / 500';
      await loadConceptList();
    } catch (error) {
      editorStatus.textContent = `השמירה נכשלה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה.'}`;
    }
  });

  const bulkImportForm = required<HTMLFormElement>('[data-bulk-import-form]');
  const bulkFolder = required<HTMLInputElement>('[data-bulk-import-folder]');
  // Astro's HTML attribute typings do not include the Chromium directory picker.
  // Setting the standard de-facto attribute here keeps the source portable.
  bulkFolder.setAttribute('webkitdirectory', '');
  const bulkStatus = required<HTMLElement>('[data-bulk-import-status]');

  bulkImportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const files = Array.from(bulkFolder.files ?? []);
    const manifestFile = files.find((file) => packagePath(file).endsWith('/manifest.json') || packagePath(file) === 'manifest.json');
    if (!manifestFile) {
      bulkStatus.textContent = 'יש לבחור את תיקיית חבילת הייבוא עצמה — זו שמכילה manifest.json.';
      return;
    }

    let manifest: ImportManifest;
    try {
      manifest = JSON.parse(await manifestFile.text()) as ImportManifest;
    } catch {
      bulkStatus.textContent = 'לא ניתן לקרוא את manifest.json.';
      return;
    }
    const items = manifest.items ?? [];
    if (!items.length || (manifest.concept_count && manifest.concept_count !== items.length)) {
      bulkStatus.textContent = 'המניפסט אינו מכיל רשימת קונספטים תקינה.';
      return;
    }
    const missing = items.find((item) => !item.title || !item.pdf || !item.banner || !packageFile(files, item.pdf) || !packageFile(files, item.banner));
    if (missing) {
      bulkStatus.textContent = `החבילה אינה שלמה — חסר PDF או באנר עבור „${missing.title ?? 'קונספט ללא כותרת'}”.`;
      return;
    }

    const submitButton = bulkImportForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    let imported = 0;
    let skipped = 0;
    const failures: string[] = [];
    try {
      const form = new FormData(bulkImportForm);
      const packageLocale = asLocale(form.get('locale') ?? manifest.locale);

      const existing = await getDocs(collection(firestore(), 'concepts'));
      const taken = new Set(existing.docs.map((record) => conceptIdentity(record.data().locale ?? 'he', record.data().title)));
      const shouldPublish = Boolean(form.get('published'));

      for (const [index, item] of items.entries()) {
        const itemLocale = asLocale(item.locale ?? packageLocale);
        if (taken.has(conceptIdentity(itemLocale, item.title as string))) {
          skipped += 1;
          continue;
        }
        bulkStatus.textContent = `מייבא ${index + 1} מתוך ${items.length}…`;
        try {
          await createConcept({
            title: (item.title as string).trim(),
            description: ((item.description_draft ?? item.description ?? `מסמך קונספט: ${item.title}`).trim().slice(0, 500)),
            section: 'queue',
            priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : index + 1,
            locale: itemLocale,
            banner: packageFile(files, item.banner as string),
            pdf: packageFile(files, item.pdf as string),
            published: shouldPublish,
            sourceId: item.id,
            category: item.category_key,
          });
          imported += 1;
          taken.add(conceptIdentity(itemLocale, item.title as string));
        } catch (error) {
          failures.push(`${item.title}: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`);
        }
      }
      await loadConceptList();
      bulkStatus.textContent = failures.length
        ? `הייבוא הסתיים חלקית: ${imported} נוספו, ${skipped} כבר היו קיימים, ${failures.length} נכשלו. ${failures[0]}`
        : `הייבוא הושלם: ${imported} קונספטים נוספו${skipped ? `, ${skipped} דולגו כי כבר היו קיימים` : ''}.`;
    } catch (error) {
      bulkStatus.textContent = `הייבוא לא התחיל: ${error instanceof Error ? error.message : 'שגיאה לא ידועה.'}`;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  const publishDraftsButton = required<HTMLButtonElement>('[data-publish-drafts]');
  const publishDraftsStatus = required<HTMLElement>('[data-publish-drafts-status]');
  publishDraftsButton.addEventListener('click', async () => {
    publishDraftsButton.disabled = true;
    publishDraftsStatus.textContent = 'מאתר טיוטות לפרסום…';
    try {
      await ensureReviewerSession(editorIdentity);
      const drafts = await getDocs(query(collection(firestore(), 'concepts'), where('publication_status', '==', 'draft')));
      if (drafts.empty) {
        publishDraftsStatus.textContent = 'אין טיוטות לפרסום.';
        return;
      }
      await Promise.all(drafts.docs.map((record) => updateDoc(record.ref, { publication_status: 'published', updated_at: new Date().toISOString() })));
      publishDraftsStatus.textContent = `${drafts.size} קונספטים פורסמו לקוראים.`;
      await loadConceptList();
    } catch (error) {
      publishDraftsStatus.textContent = `הפרסום נכשל: ${error instanceof Error ? error.message : 'שגיאה לא ידועה.'}`;
    } finally {
      publishDraftsButton.disabled = false;
    }
  });

  // ------------------------------------------------------------ banner studio
  //
  // The catalogue's banners were cut from each concept document's hero band, so every one
  // of them has its title painted into the picture, and the card had to print that title a
  // second time underneath. Regenerating a banner is what removes the duplicate, and until
  // now that could only be done by an operator running a local script against the service
  // key. This panel is the same operation for an approved editor, in the browser, under
  // their own session: the storage and table policies that already exist are what allow it,
  // and nothing here asks for a permission the editor did not already have.
  //
  // Three rules hold the panel together:
  //  - a preview is composed on a canvas in this tab and reaches nothing;
  //  - every save writes a new, immutable object in its own folder, so no banner ever
  //    published — delivered or regenerated — is overwritten, and the pointer it replaced
  //    is recorded so it can be put back;
  //  - correcting a title on a banner that is already title-free changes the title only,
  //    and never re-encodes the picture.
  const studio = required<HTMLElement>('[data-banner-studio]');
  const bannerForm = required<HTMLFormElement>('[data-banner-form]');
  const bannerConceptSelect = required<HTMLSelectElement>('[data-banner-concept]');
  const bannerTitleInput = required<HTMLInputElement>('[data-banner-title]');
  const bannerSourceInput = required<HTMLInputElement>('[data-banner-source]');
  const bannerPreview = required<HTMLElement>('[data-banner-preview]');
  const bannerStatus = required<HTMLElement>('[data-banner-status]');
  const bannerCurrent = required<HTMLElement>('[data-banner-current]');
  const bannerSaveButton = required<HTMLButtonElement>('[data-banner-save]');
  const bannerPreviewButton = required<HTMLButtonElement>('[data-banner-preview-run]');
  const bannerRestoreButton = required<HTMLButtonElement>('[data-banner-restore]');

  type BannerConcept = {
    id: string;
    title: string;
    locale: string | null;
    banner_path: string | null;
    publication_status: string;
  };
  /** What Save would do next: nothing, retitle in place, or publish a composed banner. */
  type PendingSave =
    | null
    | { kind: 'title' }
    | { kind: 'banner'; conceptId: string; blob: Blob; url: string };

  const PREVIOUS_BANNERS_KEY = 'concept-banner-studio:replaced';

  let bannerConcepts: BannerConcept[] = [];
  let pendingSave: PendingSave = null;
  let currentBannerUrl = '';
  let wordmark: HTMLImageElement | null = null;
  /** Bumped whenever the concept or the chosen background changes, so a decode that is
   *  still running cannot land its result on a different concept. */
  let previewToken = 0;

  const selectedBannerConcept = () =>
    bannerConcepts.find((concept) => concept.id === bannerConceptSelect.value) ?? null;

  /** The pointer each concept had before this browser replaced it, kept for Restore. */
  function replacedBanners(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(PREVIOUS_BANNERS_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  function rememberReplacedBanner(conceptId: string, path: string | null) {
    if (!path) return;
    const record = replacedBanners();
    // Only the first replacement matters: that is the banner the catalogue was delivered with.
    record[conceptId] ??= path;
    localStorage.setItem(PREVIOUS_BANNERS_KEY, JSON.stringify(record));
  }

  function clearPending() {
    if (pendingSave?.kind === 'banner') URL.revokeObjectURL(pendingSave.url);
    pendingSave = null;
    bannerSaveButton.disabled = true;
  }

  async function brandWordmark() {
    if (wordmark) return wordmark;
    const image = new Image();
    image.src = studio.dataset.wordmark ?? '';
    await image.decode();
    wordmark = image;
    return image;
  }

  async function loadBannerConcepts() {
    const data = (await getDocs(collection(firestore(), 'concepts'))).docs.map((record) => ({ id: record.id, ...record.data() } as BannerConcept & { priority: number }))
      .sort((a, b) => String(a.locale).localeCompare(String(b.locale)) || a.priority - b.priority);
    const previous = bannerConceptSelect.value;
    bannerConcepts = data;
    bannerConceptSelect.replaceChildren(new Option('— בחירת קונספט —', ''));
    for (const concept of bannerConcepts) {
      const layout = bannerLayoutFromPath(concept.banner_path) === 'artwork' ? 'כותרת חיה' : 'כותרת צרובה';
      bannerConceptSelect.add(new Option(`${concept.locale === 'en' ? 'EN' : 'HE'} · ${concept.title} · ${layout}`, concept.id));
    }
    if (previous && bannerConcepts.some((concept) => concept.id === previous)) bannerConceptSelect.value = previous;
    await showCurrentBanner();
  }

  function renderBannerPreview(imageUrl: string, layout: 'artwork' | 'composed', title: string) {
    const band = document.createElement('div');
    band.className = 'card-banner';
    band.dataset.bannerLayout = layout;
    // The room reads each concept in its own language, and the band mirrors with it.
    band.dir = selectedBannerConcept()?.locale === 'en' ? 'ltr' : 'rtl';
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    band.append(image);
    if (layout === 'artwork') {
      const heading = document.createElement('h3');
      heading.className = 'card-title';
      heading.textContent = title;
      band.append(heading);
    }
    bannerPreview.replaceChildren(band);
    if (layout === 'composed') {
      const note = document.createElement('p');
      note.className = 'banner-preview-note';
      note.textContent = 'הבאנר הזה עדיין מכיל כותרת צרובה, ולכן החדר מציג את הכותרת מתחתיו. תמונת רקע נקייה תסיים את הכפילות.';
      bannerPreview.append(note);
    }
  }

  async function showCurrentBanner() {
    previewToken += 1;
    clearPending();
    const concept = selectedBannerConcept();
    bannerSourceInput.value = '';
    releaseMediaUrls('concept-banners');
    currentBannerUrl = '';
    if (!concept) {
      bannerTitleInput.value = '';
      bannerCurrent.textContent = '';
      bannerRestoreButton.hidden = true;
      const empty = document.createElement('p');
      empty.className = 'banner-preview-empty';
      empty.textContent = 'בוחרים קונספט כדי לראות את הבאנר הנוכחי, ותמונת רקע כדי לקבל תצוגה מקדימה.';
      bannerPreview.replaceChildren(empty);
      return;
    }
    bannerTitleInput.value = concept.title;
    const layout = bannerLayoutFromPath(concept.banner_path);
    bannerCurrent.textContent = layout === 'artwork'
      ? `הבאנר הנוכחי נקי מטקסט, והכותרת מצוירת עליו כטקסט חי · ${concept.banner_path}`
      : `הבאנר הנוכחי מכיל כותרת צרובה בתוך התמונה · ${concept.banner_path ?? 'אין באנר'}`;
    bannerRestoreButton.hidden = !replacedBanners()[concept.id];
    if (!concept.banner_path) {
      bannerPreview.replaceChildren();
      return;
    }
    const token = previewToken;
    const url = await refreshMediaUrl('concept-banners', concept.banner_path);
    if (token !== previewToken) return;
    currentBannerUrl = url;
    if (currentBannerUrl) renderBannerPreview(currentBannerUrl, layout, bannerTitleInput.value);
  }

  /**
   * Composes the preview from the background the editor chose. A banner that still has its
   * title baked in is never reused as a background: that would paint a second title over
   * the first, which is the very defect this panel exists to remove. A banner that is
   * already title-free needs no new background at all — correcting its title is a title
   * change, handled without touching a single pixel.
   */
  async function previewBanner() {
    const concept = selectedBannerConcept();
    if (!concept) throw new Error('יש לבחור קונספט.');
    const chosen = bannerSourceInput.files?.[0] ?? null;
    if (!chosen?.size) {
      throw new Error(bannerLayoutFromPath(concept.banner_path) === 'artwork'
        ? 'הבאנר כבר נקי מטקסט. לשינוי הכותרת בלבד די לערוך את שדה הכותרת ולשמור — התמונה לא תיגע.'
        : 'יש לבחור תמונת רקע נקייה מטקסט. אי אפשר להרכיב באנר מעל באנר שהכותרת כבר צרובה בתוכו.');
    }
    const token = previewToken;
    const bitmap = await createImageBitmap(assertBannerSource(chosen) as Blob);
    try {
      const blob = await composeBannerArtwork({
        source: bitmap,
        wordmark: await brandWordmark(),
        direction: concept.locale === 'he' ? 'rtl' : 'ltr',
      });
      // The editor may have moved on while the picture was decoding.
      if (token !== previewToken || selectedBannerConcept()?.id !== concept.id) {
        throw new Error('הבחירה השתנתה בזמן ההרכבה. אפשר לנסות שוב.');
      }
      clearPending();
      pendingSave = { kind: 'banner', conceptId: concept.id, blob, url: URL.createObjectURL(blob) };
      bannerSaveButton.disabled = false;
      renderBannerPreview(pendingSave.url, 'artwork', bannerTitleInput.value.trim() || concept.title);
      return blob;
    } finally {
      bitmap.close?.();
    }
  }

  /**
   * Publishes a composed banner as a new object in a folder of its own.
   *
   * Nothing already in the bucket is written over — not the delivered banner, not a banner
   * this panel published a minute ago — so every version stays recoverable and the pointer
   * being replaced is recorded before it changes. The concept row is updated only if it
   * still points where it did when the preview was made, so two editors cannot silently
   * overwrite each other.
   *
   * A catalogue that has not yet run 202609070003_banner_artwork_path.sql refuses the
   * banner-artwork.png name at the database, so the same bytes are published under the name
   * that constraint does allow. The duplicate title is gone either way; only the room's live
   * title overlay waits for the migration.
   */
  async function publishArtworkBanner(concept: BannerConcept, blob: Blob, title: string) {
    await ensureReviewerSession(editorIdentity);
    const version = crypto.randomUUID();
    const path = versionedArtworkBannerPath(version);
    const object = ref(storage(), `concept-banners/${path}`);
    await uploadBytes(object, blob, { contentType: BANNER_ARTWORK.outputType, customMetadata: { conceptId: concept.id } });
    try {
      await updateConceptIfUnchanged(concept.id, { banner_path: concept.banner_path, title: concept.title }, { banner_path: path, title });
    } catch (error) {
      let current: string | undefined;
      try { current = (await getDoc(doc(firestore(), 'concepts', concept.id))).data()?.banner_path; }
      catch { throw new Error('מצב פרסום הבאנר אינו ברור. הקובץ נשמר; יש לבדוק את הקונספט לפני ניסיון נוסף.', { cause: error }); }
      if (current !== path) { await deleteObject(object); throw error; }
    }
    rememberReplacedBanner(concept.id, concept.banner_path);
    return { id: concept.id, title, banner_path: path, liveTitle: true };
  }

  async function updateConceptIfUnchanged(id: string, expected: Record<string, unknown>, changes: Record<string, unknown>) {
    const reference = doc(firestore(), 'concepts', id);
    await runTransaction(firestore(), async (tx) => {
      const snapshot = await tx.get(reference);
      if (!snapshot.exists() || Object.entries(expected).some(([key, value]) => snapshot.data()[key] !== value)) {
        throw new Error('הקונספט השתנה בינתיים. יש לרענן כדי לא לדרוס עריכה אחרת.');
      }
      tx.update(reference, { ...changes, updated_at: new Date().toISOString() });
    });
  }

  /** A title correction on a banner that is already title-free: the picture is not touched. */
  async function saveTitleOnly(concept: BannerConcept, title: string) {
    await ensureReviewerSession(editorIdentity);
    await updateConceptIfUnchanged(concept.id, { banner_path: concept.banner_path, title: concept.title }, { title });
    return { id: concept.id, title, banner_path: concept.banner_path };
  }

  bannerConceptSelect.addEventListener('change', () => {
    bannerStatus.textContent = '';
    showCurrentBanner().catch((error) => {
      bannerStatus.textContent = error instanceof Error ? error.message : 'לא ניתן לטעון את הבאנר.';
    });
  });

  bannerTitleInput.addEventListener('input', () => {
    const heading = bannerPreview.querySelector('.card-title');
    if (heading) heading.textContent = bannerTitleInput.value;
    const concept = selectedBannerConcept();
    if (!concept || pendingSave?.kind === 'banner') return;
    const changed = bannerTitleInput.value.trim() && bannerTitleInput.value.trim() !== concept.title;
    pendingSave = changed ? { kind: 'title' } : null;
    bannerSaveButton.disabled = !changed;
  });

  bannerSourceInput.addEventListener('change', () => {
    previewToken += 1;
    clearPending();
    bannerStatus.textContent = bannerSourceInput.files?.length
      ? 'התמונה נבחרה. אפשר ליצור תצוגה מקדימה.'
      : '';
  });

  bannerPreviewButton.addEventListener('click', async () => {
    bannerPreviewButton.disabled = true;
    try {
      const blob = await previewBanner();
      bannerStatus.textContent = `תצוגה מקדימה מוכנה (${Math.round(blob.size / 1024)}KB). היא נשארת במסך הזה עד שמירה.`;
    } catch (error) {
      bannerStatus.textContent = error instanceof Error ? error.message : 'לא ניתן להרכיב תצוגה מקדימה.';
    } finally {
      bannerPreviewButton.disabled = false;
    }
  });

  bannerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const concept = selectedBannerConcept();
    const pending = pendingSave;
    if (!concept || !pending) {
      bannerStatus.textContent = 'אין מה לשמור: צריך כותרת חדשה או תצוגה מקדימה של באנר.';
      return;
    }
    if (pending.kind === 'banner' && pending.conceptId !== concept.id) {
      bannerStatus.textContent = 'התצוגה המקדימה שייכת לקונספט אחר. יש להרכיב אותה מחדש.';
      return;
    }
    const title = bannerTitleInput.value.trim();
    if (!title) {
      bannerStatus.textContent = 'כותרת היא שדה חובה.';
      return;
    }
    if (pending.kind === 'banner' && pending.blob.size > 5 * 1024 * 1024) {
      bannerStatus.textContent = 'הבאנר המורכב גדול מ־5MB, מעל מה שהדלי מקבל. יש לבחור תמונת רקע קלה יותר.';
      return;
    }
    bannerSaveButton.disabled = true;
    bannerPreviewButton.disabled = true;
    bannerConceptSelect.disabled = true;
    bannerStatus.textContent = 'שומר…';
    const previousPath = concept.banner_path;
    try {
      if (pending.kind === 'title') {
        const saved = await saveTitleOnly(concept, title);
        concept.title = saved.title;
        bannerStatus.textContent = `הכותרת נשמרה. התמונה לא נגעה — ${saved.banner_path} נשאר בדיוק כפי שהיה.`;
      } else {
        const saved = await publishArtworkBanner(concept, pending.blob, title);
        concept.banner_path = saved.banner_path;
        concept.title = saved.title;
        bannerStatus.textContent = `נשמר ופורסם. הקונספט מצביע על ${saved.banner_path}, הכותרת מצוירת על הבאנר בחדר, והבאנר הקודם (${previousPath}) נשאר בארכיון.`;
      }
      clearPending();
      await loadBannerConcepts();
      await loadConceptList();
    } catch (error) {
      bannerStatus.textContent = `השמירה נכשלה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה.'}`;
      bannerSaveButton.disabled = false;
    } finally {
      bannerPreviewButton.disabled = false;
      bannerConceptSelect.disabled = false;
    }
  });

  bannerRestoreButton.addEventListener('click', async () => {
    const concept = selectedBannerConcept();
    if (!concept) return;
    // Only the pointer this browser recorded is offered. Guessing at a neighbouring object
    // could hand a concept a banner that was never its own.
    const original = replacedBanners()[concept.id];
    if (!original) {
      bannerStatus.textContent = 'אין כאן רישום של באנר קודם. הנתיב רשום בקבלת ההרצה, ואפשר להחזיר אותו משם.';
      return;
    }
    bannerRestoreButton.disabled = true;
    bannerStatus.textContent = 'מחזיר את הבאנר הקודם…';
    try {
      await ensureReviewerSession(editorIdentity);
      await updateConceptIfUnchanged(concept.id, { banner_path: concept.banner_path }, { banner_path: original });
      concept.banner_path = original;
      bannerStatus.textContent = `הוחזר הבאנר הקודם: ${original}`;
      await loadBannerConcepts();
    } catch (error) {
      bannerStatus.textContent = `החזרה נכשלה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה.'}`;
    } finally {
      bannerRestoreButton.disabled = false;
    }
  });

  authStatus.textContent = 'בודק את מצב הכניסה…';
  window.addEventListener('pagehide', () => { clearPending(); releaseMediaUrls(); });
  void showCurrentState().catch((error) => {
    authPanel.hidden = false;
    authStatus.textContent = error instanceof Error ? error.message : 'לא ניתן לבדוק את מצב הכניסה.';
  });
}
