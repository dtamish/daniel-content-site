import { demoConcepts } from '../data/demo-concepts.mjs';
import { DECISIONS, filterConceptsByLatestDecision, getReviewerBadges } from '../lib/review-state.mjs';
import { isSupabaseConfigured, loadConcepts, saveReview, type Identity } from '../lib/concept-repository';

type Review = { reviewerId: string; reviewerName: string; decision: string; createdAt: string };
type Concept = { id: string; title: string; description: string; section: string; priority: number; bannerUrl: string; pdfUrl: string; reviews: Review[] };

const app = document.querySelector<HTMLElement>('[data-review-app]');
if (app) {
  const root = app;
  const required = <T extends Element>(selector: string) => { const node = root.querySelector<T>(selector); if (!node) throw new Error(`Missing review app element: ${selector}`); return node; };
  const welcomeDialog = required<HTMLDialogElement>('[data-welcome-dialog]');
  const tutorialDialog = required<HTMLDialogElement>('[data-tutorial-dialog]');
  const identityDialog = required<HTMLDialogElement>('[data-identity-dialog]');
  const decisionDialog = required<HTMLDialogElement>('[data-decision-dialog]');
  const identityForm = required<HTMLFormElement>('[data-identity-form]');
  const decisionForm = required<HTMLFormElement>('[data-decision-form]');
  const advisorField = required<HTMLElement>('[data-advisor-name]');
  const advisorInput = required<HTMLInputElement>('#advisor-name');
  const notesField = required<HTMLElement>('[data-notes-field]');
  const reviewStatus = required<HTMLElement>('[data-review-status]');
  const grid = required<HTMLElement>('[data-concept-grid]');
  const drawer = required<HTMLElement>('[data-drawer]');
  const scrim = required<HTMLElement>('[data-drawer-scrim]');
  const menuButton = required<HTMLButtonElement>('[data-open-drawer]');
  const modeNotice = required<HTMLElement>('[data-mode-notice]');
  const readerDialog = required<HTMLDialogElement>('[data-reader-dialog]');
  const readerFrame = required<HTMLIFrameElement>('[data-reader-frame]');
  const readerTitle = required<HTMLElement>('[data-reader-title]');
  const readerOpen = required<HTMLButtonElement>('[data-reader-open]');
  const readerFullscreen = required<HTMLButtonElement>('[data-reader-fullscreen]');
  let concepts: Concept[] = []; let section = 'queue'; let filter = 'all'; let identity: Identity | null = null; let activeConcept: Concept | null = null;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };

  function compactDescription(value: string) {
    const normalized = value.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
    const firstSentence = normalized.split(/(?<=[.!?])\s+/).find((part) => part.replace(/[^\p{L}\p{N}]/gu, '').length >= 12) ?? normalized;
    const preview = firstSentence.slice(0, 140).trim();
    return preview.length === 140 ? `${preview.replace(/\s+\S*$/, '')}…` : preview;
  }
  function readIdentity() { try { const parsed = JSON.parse(localStorage.getItem('concept-approval:identity') ?? 'null'); return parsed?.kind && parsed?.name ? parsed as Identity : null; } catch { return null; } }
  function applyIdentity(next: Identity) { identity = next; localStorage.setItem('concept-approval:identity', JSON.stringify(next)); required<HTMLElement>('[data-identity-label]').textContent = next.name; required<HTMLElement>('.avatar').textContent = next.name.slice(0, 1); required<HTMLElement>('[data-management-link]').hidden = next.kind !== 'editor'; }
  function mergeDemoReviews(items: Concept[]) { if (isSupabaseConfigured) return items; try { for (const record of JSON.parse(localStorage.getItem('concept-approval:demo-reviews') ?? '[]')) { const concept = items.find(({ id }) => id === record.conceptId); if (concept) concept.reviews.push({ reviewerId: `local:${record.identity.kind}:${record.identity.name}`, reviewerName: record.identity.name, decision: record.decision, createdAt: record.createdAt }); } } catch { /* demo history is optional */ } return items; }
  function renderCounts() { const source = concepts.filter((item) => item.section === section); root.querySelectorAll<HTMLElement>('[data-filter-count]').forEach((node) => { node.textContent = String(filterConceptsByLatestDecision(source, node.dataset.filterCount ?? 'all').length); }); }
  function openPdf(concept: Concept) { if (!concept.pdfUrl) return; activeConcept = concept; readerTitle.textContent = concept.title; readerFrame.src = concept.pdfUrl; readerDialog.showModal(); }
  function openPdfFullscreen() { if (!activeConcept?.pdfUrl) return; window.open(activeConcept.pdfUrl, '_blank', 'noopener,noreferrer'); }
  function closeReader() { readerDialog.close(); readerFrame.src = 'about:blank'; }
  function openDecision(concept: Concept) { activeConcept = concept; decisionForm.reset(); notesField.hidden = true; reviewStatus.textContent = ''; required<HTMLButtonElement>('.decision-submit').disabled = true; required<HTMLElement>('[data-decision-title]').textContent = concept.title; decisionDialog.showModal(); }
  function renderCards() {
    const visible = filterConceptsByLatestDecision(concepts.filter((item) => item.section === section), filter) as Concept[];
    grid.replaceChildren(); required<HTMLElement>('[data-result-count]').textContent = `${visible.length} קונספטים`; required<HTMLElement>('[data-empty-list]').hidden = visible.length !== 0; renderCounts();
    for (const concept of visible) {
      const article = create('article', 'concept-card'); const pdf = create('button', 'concept-card-button'); pdf.type = 'button'; pdf.setAttribute('aria-label', `פתיחת PDF: ${concept.title}`); pdf.addEventListener('click', () => openPdf(concept));
      const banner = create('div', `concept-banner fallback-${(concept.priority % 3) + 1}`); if (concept.bannerUrl) { const image = create('img'); image.src = concept.bannerUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; banner.replaceChildren(image); } else { banner.append(create('span', 'banner-label', 'קונספט')); }
      const body = create('div', 'concept-card-body'); body.append(create('h3', '', concept.title), create('p', 'concept-description', compactDescription(concept.description)));
      const badges = create('div', 'reviewer-badges');
      for (const review of getReviewerBadges(concept.reviews)) badges.append(create('span', 'review-badge', `${review.reviewerName}: ${DECISIONS[review.decision as keyof typeof DECISIONS] ?? review.decision}`));
      if (badges.childElementCount) body.append(badges);
      const history = create('details', 'review-history'); const summary = create('summary', '', `היסטוריית החלטות (${concept.reviews.length})`); const historyList = create('ul');
      for (const review of [...concept.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) historyList.append(create('li', '', `${review.reviewerName} · ${DECISIONS[review.decision as keyof typeof DECISIONS] ?? review.decision} · ${new Date(review.createdAt).toLocaleDateString('he-IL')}`));
      history.append(summary, historyList); if (concept.reviews.length) body.append(history);
      const footer = create('div', 'card-footer'); footer.append(create('span', 'pdf-cue', 'PDF ↗'));
      const decision = create('button', 'decision-trigger', 'קביעת החלטה'); decision.type = 'button'; decision.addEventListener('click', () => openDecision(concept)); footer.append(decision);
      pdf.append(banner, body); article.append(pdf, footer); grid.append(article);
    }
  }
  function openDrawer() { drawer.hidden = false; scrim.hidden = false; menuButton.setAttribute('aria-expanded', 'true'); drawer.querySelector<HTMLButtonElement>('button')?.focus(); }
  function closeDrawer() { drawer.hidden = true; scrim.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); menuButton.focus(); }
  function finishOnboarding() { localStorage.setItem('concept-approval:onboarding-v2', 'complete'); if (welcomeDialog.open) welcomeDialog.close(); if (tutorialDialog.open) tutorialDialog.close(); }

  identityForm.addEventListener('change', () => { const selected = new FormData(identityForm).get('identity'); advisorField.hidden = selected !== 'advisor'; advisorInput.required = selected === 'advisor'; });
  identityForm.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(identityForm); const kind = String(data.get('identity')) as Identity['kind']; const names = { honi: 'חוני', itzik: 'איציק', editor: 'עורך תוכן', advisor: advisorInput.value.trim() }; if (!kind || !names[kind]) return; applyIdentity({ kind, name: names[kind] }); identityDialog.close(); });
  decisionForm.addEventListener('change', () => { const selected = new FormData(decisionForm).get('decision'); notesField.hidden = !selected; required<HTMLButtonElement>('.decision-submit').disabled = !selected; });
  decisionForm.addEventListener('submit', async (event) => { event.preventDefault(); if (!activeConcept) return; if (!identity) { reviewStatus.textContent = 'כדי לשמור החלטה, בוחרים איך לחתום עליה.'; identityDialog.showModal(); return; } const data = new FormData(decisionForm); const submit = required<HTMLButtonElement>('.decision-submit'); submit.disabled = true; reviewStatus.textContent = 'שומר…'; try { const decision = String(data.get('decision') ?? ''); const result = await saveReview({ conceptId: activeConcept.id, decision, notes: String(data.get('notes') ?? ''), identity }); activeConcept.reviews.push({ reviewerId: `current:${identity.kind}:${identity.name}`, reviewerName: identity.name, decision, createdAt: new Date().toISOString() }); reviewStatus.textContent = result.mode === 'demo' ? 'ההחלטה נשמרה במכשיר הזה.' : 'ההחלטה נשמרה.'; renderCards(); window.setTimeout(() => decisionDialog.close(), 450); } catch (error) { reviewStatus.textContent = error instanceof Error ? `השמירה נכשלה: ${error.message}` : 'השמירה נכשלה.'; submit.disabled = false; } });
  required<HTMLButtonElement>('[data-change-identity]').addEventListener('click', () => identityDialog.showModal()); menuButton.addEventListener('click', openDrawer); required<HTMLButtonElement>('[data-close-drawer]').addEventListener('click', closeDrawer); scrim.addEventListener('click', closeDrawer); required<HTMLButtonElement>('[data-close-reader]').addEventListener('click', closeReader); readerOpen.addEventListener('click', openPdfFullscreen); readerFullscreen.addEventListener('click', openPdfFullscreen); readerDialog.addEventListener('close', () => { readerFrame.src = 'about:blank'; }); required<HTMLButtonElement>('[data-start-tutorial]').addEventListener('click', () => { welcomeDialog.close(); tutorialDialog.showModal(); }); required<HTMLButtonElement>('[data-skip-tutorial]').addEventListener('click', finishOnboarding); required<HTMLButtonElement>('[data-finish-tutorial]').addEventListener('click', finishOnboarding);
  root.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((button) => button.addEventListener('click', () => { section = button.dataset.section ?? 'queue'; root.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((item) => { const current = item === button; item.classList.toggle('is-active', current); item.setAttribute('aria-pressed', String(current)); }); required<HTMLElement>('[data-list-overline]').textContent = section === 'queue' ? 'ממתינים להחלטה' : 'כל מה ששמרנו'; required<HTMLElement>('[data-list-title]').textContent = section === 'queue' ? 'התור הנוכחי' : 'ספריית הקונספטים'; renderCards(); }));
  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter ?? 'all'; root.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('is-active', item === button)); renderCards(); closeDrawer(); }));
  modeNotice.textContent = isSupabaseConfigured ? 'מחובר למסד הנתונים — החלטות נשמרות לצוות.' : 'מצב הדגמה מקומי — החלטות נשמרות רק בדפדפן הזה.'; modeNotice.classList.toggle('is-demo', !isSupabaseConfigured); identity = readIdentity(); if (identity) applyIdentity(identity); if (localStorage.getItem('concept-approval:onboarding-v2') !== 'complete') welcomeDialog.showModal();
  loadConcepts().then((items) => { concepts = mergeDemoReviews(items as Concept[]); renderCards(); }).catch((error) => { console.error(error); concepts = structuredClone(demoConcepts) as Concept[]; modeNotice.textContent = 'לא הצלחנו לטעון את Supabase. מוצגת תצוגת הדגמה ללא שמירה מרוחקת.'; modeNotice.classList.add('is-demo'); renderCards(); });
}
