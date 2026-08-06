import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase-client';

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
      .select('is_editor,approved')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const authorized = Boolean(profile?.is_editor && profile?.approved);
    authPanel.hidden = true;
    approvalPanel.hidden = authorized;
    workspace.hidden = !authorized;
    if (authorized) await loadConceptList();
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

  if (!isSupabaseConfigured) configuration.hidden = false;
  else {
    authPanel.hidden = false;
    authStatus.textContent = 'בודק את מצב הכניסה…';
  }
}
