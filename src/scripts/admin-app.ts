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

  async function showCurrentState() {
    if (!client) {
      configuration.hidden = false;
      return;
    }
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      authPanel.hidden = false;
      approvalPanel.hidden = true;
      workspace.hidden = true;
      return;
    }
    const { data: profile } = await client
      .from('profiles')
      .select('is_editor,approved')
      .eq('id', session.user.id)
      .maybeSingle();
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
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    authStatus.textContent = error ? `השליחה נכשלה: ${error.message}` : 'הקישור נשלח. אפשר לעבור לתיבת הדואר.';
  });

  app.querySelectorAll<HTMLButtonElement>('[data-sign-out]').forEach((button) => button.addEventListener('click', async () => {
    await client?.auth.signOut();
    location.reload();
  }));

  description.addEventListener('input', () => {
    required<HTMLOutputElement>('[data-description-count]').value = `${description.value.length} / 500`;
  });

  conceptForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client) return;
    const data = new FormData(conceptForm);
    const banner = data.get('banner') as File;
    const pdf = data.get('pdf') as File;
    if (description.value.length > 500) {
      editorStatus.textContent = 'התיאור מוגבל ל־500 תווים.';
      return;
    }
    if (banner?.size && (banner.type !== 'image/png' || banner.size > 5 * 1024 * 1024)) {
      editorStatus.textContent = 'הבאנר חייב להיות PNG ועד 5MB.';
      return;
    }
    if (pdf?.size && (pdf.type !== 'application/pdf' || pdf.size > 25 * 1024 * 1024)) {
      editorStatus.textContent = 'מסמך הקונספט חייב להיות PDF ועד 25MB.';
      return;
    }

    const id = crypto.randomUUID();
    const bannerPath = banner?.size ? `${id}/banner.png` : null;
    const pdfPath = pdf?.size ? `${id}/concept.pdf` : null;
    editorStatus.textContent = 'שומר…';
    const shouldPublish = Boolean(data.get('published'));
    const { error: insertError } = await client.from('concepts').insert({
      id,
      title: String(data.get('title') ?? '').trim(),
      description: description.value.trim(),
      section: data.get('section'),
      priority: Number(data.get('priority')),
      publication_status: 'draft',
      banner_path: null,
      pdf_path: null,
    });
    if (insertError) {
      editorStatus.textContent = `השמירה נכשלה: ${insertError.message}`;
      return;
    }

    const uploads = [];
    if (bannerPath) uploads.push(client.storage.from('concept-banners').upload(bannerPath, banner, { contentType: 'image/png', upsert: false }));
    if (pdfPath) uploads.push(client.storage.from('concept-pdfs').upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: false }));
    const results = await Promise.all(uploads);
    const uploadError = results.find(({ error }) => error)?.error;
    if (uploadError) {
      await client.from('concepts').delete().eq('id', id);
      if (bannerPath) await client.storage.from('concept-banners').remove([bannerPath]);
      if (pdfPath) await client.storage.from('concept-pdfs').remove([pdfPath]);
      editorStatus.textContent = `העלאת הקובץ נכשלה, ולכן הקונספט לא פורסם: ${uploadError.message}`;
      return;
    }

    const { error: finalizeError } = await client.from('concepts').update({
      banner_path: bannerPath,
      pdf_path: pdfPath,
      publication_status: shouldPublish ? 'published' : 'draft',
    }).eq('id', id);
    if (finalizeError) {
      editorStatus.textContent = `הקבצים הועלו והקונספט נשאר כטיוטה: ${finalizeError.message}`;
      return;
    }
    editorStatus.textContent = 'הקונספט נשמר בהצלחה.';
    conceptForm.reset();
    required<HTMLOutputElement>('[data-description-count]').value = '0 / 500';
    await loadConceptList();
  });

  if (!isSupabaseConfigured) configuration.hidden = false;
  else showCurrentState().catch((error) => {
    authPanel.hidden = false;
    authStatus.textContent = error instanceof Error ? error.message : 'לא ניתן לבדוק את מצב הכניסה.';
  });
}
