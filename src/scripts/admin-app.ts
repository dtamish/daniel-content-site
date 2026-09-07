import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase-client';
import {
  ARTWORK_BANNER_FILE, BANNER_ARTWORK, CHECK_VIOLATION, artworkBannerPathFor, assertBannerSource,
  bannerLayoutFromPath, composeBannerArtwork, constrainedBannerPathFor,
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
  const client = getSupabaseClient();
  const authRedirectUrl = new URL(`${import.meta.env.BASE_URL}admin/`, window.location.origin).toString();

  async function showCurrentState(session: Session | null) {
    if (!client) {
      configuration.hidden = false;
      return;
    }
    if (!session) {
      authPanel.hidden = false;
      approvalPanel.hidden = true;
      workspace.hidden = true;
      return;
    }
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('identity_kind,approved')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    // "editor" remains accepted during the hosted role-migration window.
    const authorized = Boolean(profile?.approved && ['content_editor', 'editor'].includes(profile.identity_kind));
    authPanel.hidden = true;
    approvalPanel.hidden = authorized;
    workspace.hidden = !authorized;
    if (authorized) await Promise.all([loadConceptList(), loadBannerConcepts()]);
  }

  async function loadConceptList() {
    if (!client) return;
    const list = required<HTMLElement>('[data-admin-concept-list]');
    const { data, error } = await client
      .from('concepts')
      .select('id,title,section,publication_status,updated_at')
      .order('updated_at', { ascending: false })
      .limit(12);
    if (error) {
      list.textContent = 'לא ניתן לטעון את הרשימה.';
      return;
    }
    list.replaceChildren();
    for (const concept of data ?? []) {
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
    if (!client) return;
    const form = event.currentTarget as HTMLFormElement;
    const email = String(new FormData(form).get('email') ?? '');
    authStatus.textContent = 'שולח קישור…';
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: authRedirectUrl } });
    authStatus.textContent = error ? `השליחה נכשלה: ${error.message}` : 'הקישור נשלח. אפשר לעבור לתיבת הדואר.';
  });

  if (client) {
    client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        showCurrentState(session).catch((error) => {
          authPanel.hidden = false;
          authStatus.textContent = error instanceof Error ? error.message : 'לא ניתן לבדוק את מצב הכניסה.';
        });
      }, 0);
    });
  }

  app.querySelectorAll<HTMLButtonElement>('[data-sign-out]').forEach((button) => button.addEventListener('click', async () => {
    await client?.auth.signOut();
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
    if (!client) throw new Error('Supabase אינו מחובר.');
    if (!draft.title || !draft.description) throw new Error('כותרת ותיאור הם שדות חובה.');
    if (draft.description.length > 500) throw new Error('התיאור מוגבל ל־500 תווים.');
    validateFiles(draft.banner, draft.pdf);

    const id = crypto.randomUUID();
    const bannerPath = draft.banner?.size ? `${id}/banner.png` : null;
    const pdfPath = draft.pdf?.size ? `${id}/concept.pdf` : null;
    const { error: insertError } = await client.from('concepts').insert({
      id,
      title: draft.title,
      description: draft.description,
      section: draft.section,
      priority: draft.priority,
      locale: draft.locale,
      publication_status: 'draft',
      banner_path: null,
      pdf_path: null,
    });
    if (insertError) throw insertError;

    const uploads = [];
    if (bannerPath && draft.banner) uploads.push(client.storage.from('concept-banners').upload(bannerPath, draft.banner, { contentType: 'image/png', upsert: false }));
    if (pdfPath && draft.pdf) uploads.push(client.storage.from('concept-pdfs').upload(pdfPath, draft.pdf, { contentType: 'application/pdf', upsert: false }));
    const results = await Promise.all(uploads);
    const uploadError = results.find(({ error }) => error)?.error;
    if (uploadError) {
      await client.from('concepts').delete().eq('id', id);
      if (bannerPath) await client.storage.from('concept-banners').remove([bannerPath]);
      if (pdfPath) await client.storage.from('concept-pdfs').remove([pdfPath]);
      throw new Error(`העלאת הקובץ נכשלה, ולכן הקונספט לא נשמר: ${uploadError.message}`);
    }

    const { error: finalizeError } = await client.from('concepts').update({
      banner_path: bannerPath,
      pdf_path: pdfPath,
      publication_status: draft.published ? 'published' : 'draft',
    }).eq('id', id);
    if (finalizeError) throw finalizeError;
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
    if (!client) return;
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
    if (!client) return;
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
      const titles = items.map((item) => item.title as string);
      const { data: existing, error: existingError } = await client.from('concepts').select('title,locale').in('title', titles);
      if (existingError) throw existingError;
      const taken = new Set((existing ?? []).map((concept) => conceptIdentity(concept.locale ?? 'he', concept.title)));
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
          });
          imported += 1;
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
    if (!client) return;
    publishDraftsButton.disabled = true;
    publishDraftsStatus.textContent = 'מאתר טיוטות לפרסום…';
    try {
      const { data: drafts, error: draftsError } = await client
        .from('concepts')
        .select('id')
        .eq('publication_status', 'draft');
      if (draftsError) throw draftsError;
      if (!drafts?.length) {
        publishDraftsStatus.textContent = 'אין טיוטות לפרסום.';
        return;
      }
      const { error } = await client
        .from('concepts')
        .update({ publication_status: 'published' })
        .in('id', drafts.map((concept) => concept.id));
      if (error) throw error;
      publishDraftsStatus.textContent = `${drafts.length} קונספטים פורסמו לקוראים.`;
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
  // of them has its title baked into the picture, and the card had to print that title a
  // second time underneath. Regenerating a banner is what removes the duplicate, and until
  // now that could only be done by an operator running a local script against the service
  // key. This panel is the same operation for an approved editor, in the browser, under
  // their own session: the storage and table policies that already exist are what allow
  // it, and nothing here asks for a permission the editor did not already have.
  //
  // Composition happens on a canvas in this tab. A preview is never uploaded. Saving
  // writes the new picture to a *new* object beside the original and then points the
  // concept at it, so the original banner is still in the bucket and restoring it is one
  // row update away.
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

  let bannerConcepts: BannerConcept[] = [];
  /** The banner each concept pointed at before it was regenerated in this session. */
  const previousBannerPaths = new Map<string, string | null>();
  let composedBanner: { blob: Blob; url: string } | null = null;
  let currentBannerUrl = '';
  let wordmark: HTMLImageElement | null = null;

  const selectedBannerConcept = () =>
    bannerConcepts.find((concept) => concept.id === bannerConceptSelect.value) ?? null;

  function releaseComposedBanner() {
    if (composedBanner) URL.revokeObjectURL(composedBanner.url);
    composedBanner = null;
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
    if (!client) return;
    const { data, error } = await client
      .from('concepts')
      .select('id,title,locale,banner_path,publication_status')
      .order('locale', { ascending: true })
      .order('priority', { ascending: true });
    if (error) {
      bannerStatus.textContent = `לא ניתן לטעון את רשימת הקונספטים: ${error.message}`;
      return;
    }
    const previous = bannerConceptSelect.value;
    bannerConcepts = (data ?? []) as BannerConcept[];
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
    releaseComposedBanner();
    const concept = selectedBannerConcept();
    bannerSourceInput.value = '';
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
    bannerRestoreButton.hidden = layout !== 'artwork';
    if (!client || !concept.banner_path) {
      bannerPreview.replaceChildren();
      return;
    }
    const { data } = await client.storage.from('concept-banners').createSignedUrl(concept.banner_path, 60 * 10);
    currentBannerUrl = data?.signedUrl ?? '';
    if (currentBannerUrl) renderBannerPreview(currentBannerUrl, layout, bannerTitleInput.value);
  }

  /**
   * Composes the preview. The background is the file the editor picked, or — when the
   * concept already has a title-free banner — that banner itself, so a title can be
   * corrected without hunting for the artwork again. A banner that still has its title
   * baked in is never reused as a background: that would paint a second title over the
   * first, which is the very defect this panel exists to remove.
   */
  async function previewBanner() {
    const concept = selectedBannerConcept();
    if (!concept) throw new Error('יש לבחור קונספט.');
    const chosen = bannerSourceInput.files?.[0] ?? null;
    let source: Blob;
    if (chosen?.size) {
      source = assertBannerSource(chosen) as Blob;
    } else if (bannerLayoutFromPath(concept.banner_path) === 'artwork' && currentBannerUrl) {
      source = await (await fetch(currentBannerUrl)).blob();
    } else {
      throw new Error('יש לבחור תמונת רקע נקייה מטקסט. אי אפשר להרכיב באנר מעל באנר שהכותרת כבר צרובה בתוכו.');
    }
    const bitmap = await createImageBitmap(source);
    try {
      const blob = await composeBannerArtwork({
        source: bitmap,
        wordmark: await brandWordmark(),
        direction: concept.locale === 'he' ? 'rtl' : 'ltr',
      });
      releaseComposedBanner();
      composedBanner = { blob, url: URL.createObjectURL(blob) };
      bannerSaveButton.disabled = false;
      renderBannerPreview(composedBanner.url, 'artwork', bannerTitleInput.value.trim() || concept.title);
      return blob;
    } finally {
      bitmap.close?.();
    }
  }

  /**
   * Publishes a composed banner without ever writing over the delivered one.
   *
   * The preferred object sits beside the original and is named so the room recognises it as
   * title-free. A catalogue that has not yet run 202609070003_banner_artwork_path.sql still
   * refuses that name at the database, so the banner goes to its own folder instead: the
   * duplicate title is gone either way, and only the live title overlay waits for the
   * migration. Both routes leave the original object exactly where it was.
   */
  async function publishArtworkBanner(concept: BannerConcept, blob: Blob, title: string) {
    if (!client) throw new Error('Supabase אינו מחובר.');
    const attempt = async (path: string) => {
      const upload = await client.storage.from('concept-banners')
        .upload(path, blob, { contentType: BANNER_ARTWORK.outputType, upsert: true });
      if (upload.error) throw upload.error;
      return client.from('concepts').update({ banner_path: path, title })
        .eq('id', concept.id).select('id,title,banner_path').single();
    };
    const artworkPath = artworkBannerPathFor(concept.banner_path, concept.id);
    let { data, error } = await attempt(artworkPath);
    if (error?.code === CHECK_VIOLATION) {
      ({ data, error } = await attempt(constrainedBannerPathFor(crypto.randomUUID())));
    }
    if (error) throw error;
    if (!data) throw new Error('השמירה לא החזירה את השורה המעודכנת.');
    return { ...data, liveTitle: bannerLayoutFromPath(data.banner_path) === 'artwork' };
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
  });

  bannerSourceInput.addEventListener('change', () => {
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
    if (!client) return;
    const concept = selectedBannerConcept();
    if (!concept || !composedBanner) {
      bannerStatus.textContent = 'צריך תצוגה מקדימה לפני שמירה.';
      return;
    }
    const title = bannerTitleInput.value.trim();
    if (!title) {
      bannerStatus.textContent = 'כותרת היא שדה חובה.';
      return;
    }
    if (composedBanner.blob.size > 5 * 1024 * 1024) {
      bannerStatus.textContent = 'הבאנר המורכב גדול מ־5MB, מעל מה שהדלי מקבל. יש לבחור תמונת רקע קלה יותר.';
      return;
    }
    bannerSaveButton.disabled = true;
    bannerStatus.textContent = 'שומר…';
    const previousPath = concept.banner_path;
    try {
      const saved = await publishArtworkBanner(concept, composedBanner.blob, title);
      previousBannerPaths.set(concept.id, previousPath);
      concept.banner_path = saved.banner_path;
      concept.title = saved.title;
      bannerStatus.textContent = saved.liveTitle
        ? `נשמר ופורסם. הקונספט מצביע על ${saved.banner_path}, הכותרת מצוירת על הבאנר בחדר, והבאנר המקורי (${previousPath}) נשאר בארכיון.`
        : `נשמר ופורסם ב־${saved.banner_path}, והבאנר המקורי (${previousPath}) נשאר בארכיון. עד שתופעל מיגרציית banner-artwork בבסיס הנתונים, החדר יציג את הכותרת מתחת לתמונה ולא עליה — הכפילות כבר לא קיימת בכל מקרה.`;
      await loadBannerConcepts();
      await loadConceptList();
    } catch (error) {
      bannerStatus.textContent = `השמירה נכשלה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה.'}`;
      bannerSaveButton.disabled = false;
    }
  });

  bannerRestoreButton.addEventListener('click', async () => {
    if (!client) return;
    const concept = selectedBannerConcept();
    if (!concept?.banner_path) return;
    bannerRestoreButton.disabled = true;
    bannerStatus.textContent = 'מחפש את הבאנר המקורי…';
    try {
      const folder = concept.banner_path.slice(0, concept.banner_path.lastIndexOf('/'));
      const { data: objects, error: listError } = await client.storage.from('concept-banners').list(folder);
      if (listError) throw listError;
      const sibling = (objects ?? []).find((object) => object.name !== ARTWORK_BANNER_FILE);
      const original = previousBannerPaths.get(concept.id) ?? (sibling ? `${folder}/${sibling.name}` : null);
      if (!original) {
        bannerStatus.textContent = 'הבאנר המקורי אינו בתיקייה הזו. הנתיב שלו רשום בקבלת ההרצה, ואפשר להחזיר אותו משם.';
        return;
      }
      const { data, error } = await client.from('concepts')
        .update({ banner_path: original })
        .eq('id', concept.id)
        .select('id,banner_path')
        .single();
      if (error) throw error;
      concept.banner_path = data.banner_path;
      bannerStatus.textContent = `הוחזר הבאנר המקורי: ${data.banner_path}`;
      await loadBannerConcepts();
    } catch (error) {
      bannerStatus.textContent = `החזרה נכשלה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה.'}`;
    } finally {
      bannerRestoreButton.disabled = false;
    }
  });

  if (!isSupabaseConfigured) configuration.hidden = false;
  else {
    authPanel.hidden = false;
    authStatus.textContent = 'בודק את מצב הכניסה…';
  }
}
