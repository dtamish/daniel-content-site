import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { demoConcepts } from '../data/demo-concepts.mjs';
import { filterConceptsByLatestDecision, getReviewerBadges } from '../lib/review-state.mjs';
import { isSupabaseConfigured, loadConcepts, saveReview, type Identity } from '../lib/concept-repository';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Base path helper for local assets (respects GitHub Pages subdirectory deployment)
const basePath = import.meta.env.BASE_URL;
function withBase(path: string): string {
  if (!path || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) {
    return path; // External/absolute URLs unchanged
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return basePath === '/' ? cleanPath : `${basePath.replace(/\/$/, '')}${cleanPath}`;
}

type Review = { reviewerId: string; reviewerName: string; decision: string; createdAt: string };
type DemoPage = { kicker: string; title: string; body: string };
type Concept = {
  id: string; title: string; description: string; section: string; priority: number;
  bannerUrl: string; pdfUrl: string; pages: DemoPage[]; reviews: Review[];
};

const app = document.querySelector<HTMLElement>('[data-review-app]');
if (app) {
  const root = app;
  const required = <T extends Element>(selector: string) => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing review app element: ${selector}`);
    return node;
  };

  const welcomeDialog = required<HTMLDialogElement>('[data-welcome-dialog]');
  const tutorialDialog = required<HTMLDialogElement>('[data-tutorial-dialog]');
  const identityDialog = required<HTMLDialogElement>('[data-identity-dialog]');
  const identityForm = required<HTMLFormElement>('[data-identity-form]');
  const advisorField = required<HTMLElement>('[data-advisor-name]');
  const advisorInput = required<HTMLInputElement>('#advisor-name');
  const grid = required<HTMLElement>('[data-concept-grid]');
  const detail = required<HTMLElement>('[data-detail-view]');
  const main = required<HTMLElement>('.app-main');
  const drawer = required<HTMLElement>('[data-drawer]');
  const scrim = required<HTMLElement>('[data-drawer-scrim]');
  const openDrawerButton = required<HTMLButtonElement>('[data-open-drawer]');
  const reviewForm = required<HTMLFormElement>('[data-decision-form]');
  const notesField = required<HTMLElement>('[data-notes-field]');
  const reviewStatus = required<HTMLElement>('[data-review-status]');
  const viewer = required<HTMLElement>('[data-document-viewer]');
  const canvas = required<HTMLCanvasElement>('[data-pdf-canvas]');
  const readingProgress = required<HTMLProgressElement>('[data-reading-progress]');
  const readerNextCue = required<HTMLElement>('[data-reader-next-cue]');
  const demoPage = required<HTMLElement>('[data-demo-page]');
  const modeNotice = required<HTMLElement>('[data-mode-notice]');

  let concepts: Concept[] = [];
  let section = 'queue';
  let filter = 'all';
  let identity: Identity | null = null;
  let activeConcept: Concept | null = null;
  let pageNumber = 1;
  let pageCount = 1;
  let pdfDocument: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']> | null = null;
  let pointerStart: { x: number; y: number } | null = null;
  let resizeFrame: number | null = null;

  const decisionLabels: Record<string, string> = {
    'priority-approved': 'פריוריטי',
    'schedule-approved': 'לוח שידורים',
    wait: 'להמתין',
    canceled: 'לבטל',
  };

  function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function readIdentity() {
    try {
      const parsed = JSON.parse(localStorage.getItem('concept-approval:identity') ?? 'null');
      if (parsed?.kind && parsed?.name) return parsed as Identity;
    } catch { /* A corrupt preference should simply reopen identity entry. */ }
    return null;
  }

  function applyIdentity(nextIdentity: Identity) {
    identity = nextIdentity;
    localStorage.setItem('concept-approval:identity', JSON.stringify(identity));
    required<HTMLElement>('[data-identity-label]').textContent = identity.name;
    required<HTMLElement>('.avatar').textContent = identity.name.slice(0, 1);
    required<HTMLElement>('[data-management-link]').hidden = identity.kind !== 'editor';
  }

  function mergeDemoReviews(items: Concept[]) {
    if (isSupabaseConfigured) return items;
    try {
      const saved = JSON.parse(localStorage.getItem('concept-approval:demo-reviews') ?? '[]');
      for (const record of saved) {
        const concept = items.find(({ id }) => id === record.conceptId);
        if (concept) concept.reviews.push({
          reviewerId: `local:${record.identity.kind}:${record.identity.name}`,
          reviewerName: record.identity.name,
          decision: record.decision,
          createdAt: record.createdAt,
        });
      }
    } catch { /* Ignore invalid local demo history. */ }
    return items;
  }

  function renderCounts() {
    const inSection = concepts.filter((concept) => concept.section === section);
    for (const button of root.querySelectorAll<HTMLElement>('[data-filter-count]')) {
      const value = button.dataset.filterCount ?? 'all';
      button.textContent = String(filterConceptsByLatestDecision(inSection, value).length);
    }
  }

  function renderCards() {
    const candidates = concepts.filter((concept) => concept.section === section);
    const visible = filterConceptsByLatestDecision(candidates, filter) as Concept[];
    grid.replaceChildren();
    required<HTMLElement>('[data-result-count]').textContent = `${visible.length} קונספטים`;
    required<HTMLElement>('[data-empty-list]').hidden = visible.length !== 0;
    renderCounts();

    for (const concept of visible) {
      const article = createElement('article', 'concept-card');
      const button = createElement('button', 'concept-card-button');
      button.type = 'button';
      button.setAttribute('aria-label', `פתיחת הקונספט: ${concept.title}`);
      button.addEventListener('click', () => openConcept(concept));

      const banner = createElement('div', `concept-banner fallback-${(concept.priority % 3) + 1}`);
      if (concept.bannerUrl) {
        const image = createElement('img');
        image.src = withBase(concept.bannerUrl);
        image.alt = '';
        banner.replaceChildren(image);
      } else {
        banner.append(createElement('span', 'banner-label', 'קונספט'));
        banner.append(createElement('span', 'banner-number', String(concept.priority).padStart(2, '0')));
      }

      const body = createElement('div', 'concept-card-body');
      const meta = createElement('div', 'concept-meta');
      meta.append(createElement('span', '', concept.section === 'queue' ? 'בתור לסקירה' : 'בספרייה'));
      meta.append(createElement('span', '', concept.pdfUrl ? 'PDF' : 'הדגמה'));
      body.append(meta, createElement('h3', '', concept.title), createElement('p', 'concept-description', concept.description));

      const badges = createElement('div', 'reviewer-badges');
      badges.setAttribute('aria-label', 'החלטות סוקרים');
      const distinct = getReviewerBadges(concept.reviews);
      if (!distinct.length) badges.append(createElement('span', 'pending-badge', 'טרם נסקר'));
      for (const badge of distinct) {
        const badgeNode = createElement('span', `reviewer-badge decision-${badge.decision}`);
        badgeNode.title = `${badge.reviewerName}: ${decisionLabels[badge.decision] ?? badge.decision}`;
        badgeNode.append(createElement('b', '', badge.reviewerName.slice(0, 1)), createElement('span', '', decisionLabels[badge.decision] ?? badge.decision));
        badges.append(badgeNode);
      }
      body.append(badges);
      button.append(banner, body);
      article.append(button);
      grid.append(article);
    }
  }

  function updatePageControls() {
    const pageLabel = `עמוד ${pageNumber} מתוך ${pageCount}`;
    required<HTMLOutputElement>('[data-page-counter]').value = pageLabel;
    readingProgress.max = pageCount;
    readingProgress.value = pageNumber;
    readingProgress.setAttribute('aria-valuetext', pageLabel);
    readerNextCue.hidden = pageNumber !== pageCount;
    required<HTMLButtonElement>('[data-prev-page]').disabled = pageNumber <= 1;
    required<HTMLButtonElement>('[data-next-page]').disabled = pageNumber >= pageCount;
    // The decision follows the document, rather than competing with it while reading.
    reviewForm.hidden = pageNumber < pageCount;
  }

  async function renderPage() {
    if (!activeConcept) return;
    updatePageControls();
    if (pdfDocument) {
      const page = await pdfDocument.getPage(pageNumber);
      const availableWidth = Math.min(viewer.clientWidth - 32, 980);
      const initial = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.max(0.5, availableWidth / initial.width) });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0],
      }).promise;
      return;
    }
    const pages = activeConcept.pages.length ? activeConcept.pages : [{
      kicker: 'תצוגת הדגמה', title: activeConcept.title, body: activeConcept.description,
    }];
    const current = pages[pageNumber - 1];
    required<HTMLElement>('[data-demo-kicker]').textContent = current.kicker;
    required<HTMLElement>('[data-demo-title]').textContent = current.title;
    required<HTMLElement>('[data-demo-body]').textContent = current.body;
  }

  async function openConcept(concept: Concept) {
    activeConcept = concept;
    pageNumber = 1;
    pdfDocument = null;
    reviewForm.reset();
    notesField.hidden = true;
    required<HTMLButtonElement>('.decision-submit').disabled = true;
    reviewStatus.textContent = '';
    required<HTMLElement>('[data-detail-title]').textContent = concept.title;
    required<HTMLElement>('[data-detail-description]').textContent = concept.description;
    const position = concepts.filter((item) => item.section === concept.section).findIndex((item) => item.id === concept.id) + 1;
    required<HTMLElement>('[data-detail-position]').textContent = `${position} / ${concepts.filter((item) => item.section === concept.section).length}`;
    main.hidden = true;
    detail.hidden = false;
    document.body.classList.add('detail-open');
    history.replaceState(null, '', `#concept=${encodeURIComponent(concept.id)}`);
    detail.focus();

    canvas.hidden = true;
    demoPage.hidden = false;
    const loading = required<HTMLElement>('[data-viewer-loading]');
    if (concept.pdfUrl) {
      loading.hidden = false;
      demoPage.hidden = true;
      try {
        pdfDocument = await pdfjsLib.getDocument({ url: concept.pdfUrl }).promise;
        pageCount = pdfDocument.numPages;
        canvas.hidden = false;
      } catch (error) {
        console.error(error);
        pdfDocument = null;
        demoPage.hidden = false;
        pageCount = concept.pages.length || 1;
        reviewStatus.textContent = 'ה־PDF לא נטען, לכן מוצגת תצוגת HTML חלופית.';
      } finally {
        loading.hidden = true;
      }
    } else {
      pageCount = concept.pages.length || 1;
    }
    await renderPage();
  }

  function closeDetail() {
    detail.hidden = true;
    main.hidden = false;
    document.body.classList.remove('detail-open');
    history.replaceState(null, '', location.pathname + location.search);
    activeConcept = null;
    pdfDocument?.cleanup();
    pdfDocument = null;
    grid.querySelector<HTMLButtonElement>('button')?.focus();
  }

  async function changePage(delta: number) {
    const target = Math.max(1, Math.min(pageCount, pageNumber + delta));
    if (target === pageNumber) return;
    pageNumber = target;
    await renderPage();
  }

  function openDrawer() {
    drawer.hidden = false;
    scrim.hidden = false;
    openDrawerButton.setAttribute('aria-expanded', 'true');
    drawer.querySelector<HTMLButtonElement>('button')?.focus();
  }

  function closeDrawer() {
    drawer.hidden = true;
    scrim.hidden = true;
    openDrawerButton.setAttribute('aria-expanded', 'false');
    openDrawerButton.focus();
  }

  identityForm.addEventListener('change', () => {
    const selected = new FormData(identityForm).get('identity');
    advisorField.hidden = selected !== 'advisor';
    advisorInput.required = selected === 'advisor';
  });
  identityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(identityForm);
    const kind = String(data.get('identity')) as Identity['kind'];
    const names = { honi: 'חוני', itzik: 'איציק', editor: 'עורך תוכן', advisor: advisorInput.value.trim() };
    if (!kind || !names[kind]) return;
    applyIdentity({ kind, name: names[kind] });
    identityDialog.close();
  });

  function finishOnboarding() {
    localStorage.setItem('concept-approval:onboarding-v1', 'complete');
    if (welcomeDialog.open) welcomeDialog.close();
    if (tutorialDialog.open) tutorialDialog.close();
  }

  required<HTMLButtonElement>('[data-start-tutorial]').addEventListener('click', () => {
    welcomeDialog.close();
    tutorialDialog.showModal();
  });
  required<HTMLButtonElement>('[data-skip-tutorial]').addEventListener('click', finishOnboarding);
  required<HTMLButtonElement>('[data-finish-tutorial]').addEventListener('click', finishOnboarding);

  required<HTMLButtonElement>('[data-change-identity]').addEventListener('click', () => identityDialog.showModal());
  openDrawerButton.addEventListener('click', openDrawer);
  required<HTMLButtonElement>('[data-close-drawer]').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  required<HTMLButtonElement>('[data-close-detail]').addEventListener('click', closeDetail);
  required<HTMLButtonElement>('[data-prev-page]').addEventListener('click', () => changePage(-1));
  required<HTMLButtonElement>('[data-next-page]').addEventListener('click', () => changePage(1));
  required<HTMLButtonElement>('[data-dismiss-tip]').addEventListener('click', (event) => {
    (event.currentTarget as HTMLElement).closest<HTMLElement>('.swipe-tip')!.hidden = true;
  });

  root.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((button) => button.addEventListener('click', () => {
    section = button.dataset.section ?? 'queue';
    root.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    required<HTMLElement>('[data-list-overline]').textContent = section === 'queue' ? 'ממתינים להחלטה' : 'כל מה ששמרנו';
    required<HTMLElement>('[data-list-title]').textContent = section === 'queue' ? 'התור הנוכחי' : 'ספריית הקונספטים';
    renderCards();
  }));

  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter ?? 'all';
    root.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
    renderCards();
    closeDrawer();
  }));

  reviewForm.addEventListener('change', () => {
    const selected = new FormData(reviewForm).get('decision');
    notesField.hidden = !selected;
    required<HTMLButtonElement>('.decision-submit').disabled = !selected;
  });
  reviewForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeConcept) return;
    if (!identity) {
      reviewStatus.textContent = 'כדי לשמור את ההחלטה, בוחרים איך לחתום עליה.';
      identityDialog.showModal();
      return;
    }
    const data = new FormData(reviewForm);
    const decision = String(data.get('decision') ?? '');
    const notes = String(data.get('notes') ?? '');
    const submit = required<HTMLButtonElement>('.decision-submit');
    submit.disabled = true;
    reviewStatus.textContent = 'שומר…';
    try {
      const result = await saveReview({ conceptId: activeConcept.id, decision, notes, identity });
      activeConcept.reviews.push({
        reviewerId: `current:${identity.kind}:${identity.name}`,
        reviewerName: identity.name,
        decision,
        createdAt: new Date().toISOString(),
      });
      reviewStatus.textContent = result.mode === 'demo'
        ? 'ההחלטה נשמרה מקומית במכשיר הזה (מצב הדגמה).'
        : 'ההחלטה נשמרה בהצלחה.';
      submit.textContent = 'ההחלטה נשמרה';
      renderCounts();
      // A completed choice must return the reviewer to the queue, not leave them
      // sitting in the document with a finished action.
      closeDetail();
      section = 'queue';
      required<HTMLElement>('[data-list-overline]').textContent = 'ממתינים להחלטה';
      required<HTMLElement>('[data-list-title]').textContent = 'התור הנוכחי';
      root.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((item) => {
        const active = item.dataset.section === 'queue';
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      renderCards();
    } catch (error) {
      reviewStatus.textContent = error instanceof Error ? `השמירה נכשלה: ${error.message}` : 'השמירה נכשלה.';
      submit.disabled = false;
    }
  });

  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); changePage(1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); changePage(-1); }
  });
  viewer.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return;
    pointerStart = { x: event.clientX, y: event.clientY };
    viewer.setPointerCapture?.(event.pointerId);
  });
  viewer.addEventListener('pointerup', (event) => {
    if (!pointerStart || !event.isPrimary) return;
    const horizontalDistance = event.clientX - pointerStart.x;
    const verticalDistance = event.clientY - pointerStart.y;
    pointerStart = null;
    // Only an intentional horizontal gesture turns a page; normal vertical reading still scrolls.
    if (Math.abs(horizontalDistance) > 56 && Math.abs(horizontalDistance) > Math.abs(verticalDistance) * 1.35) {
      changePage(horizontalDistance < 0 ? 1 : -1);
    }
  });
  viewer.addEventListener('pointercancel', () => { pointerStart = null; });

  new ResizeObserver(() => {
    if (!pdfDocument || !activeConcept) return;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      renderPage().catch((error) => console.error('PDF rerender failed', error));
    });
  }).observe(viewer);

  modeNotice.textContent = isSupabaseConfigured
    ? 'מחובר למסד הנתונים — החלטות נשמרות לצוות.'
    : 'מצב הדגמה מקומי — Supabase לא הוגדר, והחלטות נשמרות רק בדפדפן הזה.';
  modeNotice.classList.toggle('is-demo', !isSupabaseConfigured);

  identity = readIdentity();
  if (identity) applyIdentity(identity);
  if (localStorage.getItem('concept-approval:onboarding-v1') !== 'complete') {
    welcomeDialog.showModal();
  }

  loadConcepts()
    .then((items) => {
      concepts = mergeDemoReviews(items as Concept[]);
      renderCards();
      const requested = new URLSearchParams(location.hash.replace(/^#/, '')).get('concept');
      const concept = concepts.find(({ id }) => id === requested);
      if (concept) openConcept(concept);
    })
    .catch((error) => {
      console.error(error);
      concepts = structuredClone(demoConcepts) as Concept[];
      modeNotice.textContent = 'לא הצלחנו לטעון את Supabase. מוצגת תצוגת הדגמה ללא שמירה מרוחקת.';
      modeNotice.classList.add('is-demo');
      renderCards();
    });
}
