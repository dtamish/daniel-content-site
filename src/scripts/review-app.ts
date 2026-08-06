import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  conceptStatus, countByStatus, conceptsWithStatus, decisionLabels, latestReview,
} from '../lib/review-state.mjs';
import { DEFAULT_LOCALE, STRINGS, direction, isLocale, type Locale } from '../lib/i18n';
import { isSupabaseConfigured, loadConcepts, saveReview, type Identity } from '../lib/concept-repository';
import { withBase } from '../lib/urls';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Review = { reviewerId: string; reviewerName: string; decision: string; notes?: string; createdAt: string };
type Concept = {
  id: string; title: string; description: string; priority: number;
  bannerUrl: string; pdfUrl: string; reviews: Review[];
};
type Status = 'pending' | 'approved' | 'rejected';

const IDENTITY_KEY = 'concept-approval:identity';
const LOCALE_KEY = 'concept-approval:locale';
const MAX_ZOOM = 4;
const MIN_ZOOM = 1;

const appRoot = document.querySelector<HTMLElement>('[data-review-app]');
if (appRoot) {
  const root = appRoot;
  const need = <T extends Element>(selector: string) => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing concept room element: ${selector}`);
    return node;
  };
  const el = {
    grid: need<HTMLElement>('[data-concept-grid]'),
    empty: need<HTMLElement>('[data-empty]'),
    notice: need<HTMLElement>('[data-mode-notice]'),
    tabs: need<HTMLElement>('[data-tabs]'),
    identityDialog: need<HTMLDialogElement>('[data-identity-dialog]'),
    identityForm: need<HTMLFormElement>('[data-identity-form]'),
    advisorField: need<HTMLElement>('[data-advisor-field]'),
    advisorInput: need<HTMLInputElement>('#advisor-name'),
    identityLabel: need<HTMLElement>('[data-identity-label]'),
    identityInitial: need<HTMLElement>('[data-identity-initial]'),
    manageLink: need<HTMLAnchorElement>('[data-manage-link]'),
    localeToggle: need<HTMLButtonElement>('[data-locale-toggle]'),
    localeLabel: need<HTMLElement>('[data-locale-label]'),
    reader: need<HTMLElement>('[data-reader]'),
    readerTitle: need<HTMLElement>('[data-reader-title]'),
    pageCount: need<HTMLElement>('[data-page-count]'),
    stage: need<HTMLElement>('[data-stage]'),
    track: need<HTMLElement>('[data-track]'),
    pageSlide: need<HTMLElement>('[data-page-slide]'),
    canvas: need<HTMLCanvasElement>('[data-page-canvas]'),
    readerState: need<HTMLElement>('[data-reader-state]'),
    dots: need<HTMLElement>('[data-dots]'),
    prev: need<HTMLButtonElement>('[data-prev]'),
    next: need<HTMLButtonElement>('[data-next]'),
    decisionForm: need<HTMLFormElement>('[data-decision-form]'),
    decisionTitle: need<HTMLElement>('[data-decision-title]'),
    decisionStatus: need<HTMLElement>('[data-decision-status]'),
  };

  let locale: Locale = readLocale();
  let strings = STRINGS[locale];
  let concepts: Concept[] = [];
  const cache = new Map<Locale, Concept[]>();
  let tab: Status = 'pending';
  let identity: Identity | null = readIdentity();

  let pdf: pdfjs.PDFDocumentProxy | null = null;
  let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
  let active: Concept | null = null;
  let view = 0;            // 0..pageCount-1 are pages, pageCount is the decision panel
  let pageCount = 0;
  let zoom = 1;
  let renderToken = 0;

  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  // ---------------------------------------------------------------- identity
  function readIdentity(): Identity | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? 'null');
      return parsed?.kind && parsed?.name ? (parsed as Identity) : null;
    } catch {
      return null;
    }
  }

  function identityName(kind: Identity['kind'], custom: string) {
    return kind === 'advisor' ? custom.trim() || strings.people.advisor : strings.people[kind];
  }

  function applyIdentity(next: Identity) {
    identity = next;
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(next));
    el.identityLabel.textContent = next.name;
    el.identityInitial.textContent = [...next.name][0] ?? '?';
    el.manageLink.hidden = next.kind !== 'editor';
  }

  // ------------------------------------------------------------------ locale
  function readLocale(): Locale {
    const stored = localStorage.getItem(LOCALE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  }

  const I18N_TARGETS: Record<string, () => string> = {
    brand: () => strings.brand,
    manage: () => strings.manage,
    identityQuestion: () => strings.identityQuestion,
    identityHelp: () => strings.identityHelp,
    identityEnter: () => strings.identityEnter,
    identityAdvisorName: () => strings.identityAdvisorName,
    'person.honi': () => strings.people.honi,
    'person.itzik': () => strings.people.itzik,
    'person.advisor': () => strings.people.advisor,
    'person.editor': () => strings.people.editor,
    'tab.pending': () => strings.tabs.pending,
    'tab.approved': () => strings.tabs.approved,
    'tab.rejected': () => strings.tabs.rejected,
    decisionFor: () => strings.decisionFor,
    decisionNote: () => strings.decisionNote,
    decisionNoteOptional: () => strings.decisionNoteOptional,
    decisionSave: () => strings.decisionSave,
  };

  function applyStrings() {
    strings = STRINGS[locale];
    document.documentElement.lang = locale;
    document.documentElement.dir = direction(locale);
    for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const value = I18N_TARGETS[node.dataset.i18n ?? ''];
      if (value) node.textContent = value();
    }
    const labels = decisionLabels(locale);
    for (const node of root.querySelectorAll<HTMLElement>('[data-decision-label]')) {
      node.textContent = labels[node.dataset.decisionLabel as keyof typeof labels] ?? '';
    }
    el.localeLabel.textContent = strings.languageSwitchTo;
    el.localeToggle.setAttribute('aria-label', strings.languageSwitchLabel);
    el.identityLabel.textContent = identity
      ? (identity.kind === 'advisor' ? identity.name : strings.people[identity.kind])
      : strings.identityQuestion;
    el.prev.setAttribute('aria-label', strings.prevPage);
    el.next.setAttribute('aria-label', strings.nextPage);
    need<HTMLButtonElement>('[data-close-reader]').setAttribute('aria-label', strings.close);
    el.notice.textContent = isSupabaseConfigured ? strings.liveNotice : strings.demoNotice;
    el.notice.hidden = !el.notice.textContent;
  }

  async function setLocale(next: Locale) {
    if (next === locale) return;
    locale = next;
    localStorage.setItem(LOCALE_KEY, next);
    // The reader holds a signed URL for the other language's document; drop it on the switch.
    if (!el.reader.hidden) closeReader();
    applyStrings();
    root.classList.add('is-swapping');
    await loadCatalogue();
    render();
    window.requestAnimationFrame(() => root.classList.remove('is-swapping'));
  }

  // --------------------------------------------------------------- catalogue
  function mergeDemoReviews(items: Concept[]) {
    if (isSupabaseConfigured) return items;
    try {
      const stored = JSON.parse(localStorage.getItem('concept-approval:demo-reviews') ?? '[]');
      for (const record of stored) {
        const concept = items.find(({ id }) => id === record.conceptId);
        if (!concept) continue;
        concept.reviews.push({
          reviewerId: `local:${record.identity.kind}:${record.identity.name}`,
          reviewerName: record.identity.name,
          decision: record.decision,
          notes: record.notes ?? '',
          createdAt: record.createdAt,
        });
      }
    } catch {
      // demo history is a convenience, never a source of truth
    }
    return items;
  }

  async function loadCatalogue() {
    const cached = cache.get(locale);
    if (cached) {
      concepts = cached;
      return;
    }
    try {
      concepts = mergeDemoReviews((await loadConcepts(locale)) as Concept[]);
    } catch (error) {
      console.error(error);
      concepts = [];
      el.notice.textContent = strings.loadFailed;
      el.notice.hidden = false;
    }
    cache.set(locale, concepts);
  }

  // ------------------------------------------------------------------ render
  function summary(value: string) {
    const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= 132) return normalized;
    return `${normalized.slice(0, 132).replace(/\s+\S*$/, '')}…`;
  }

  function render() {
    const counts = countByStatus(concepts);
    for (const node of el.tabs.querySelectorAll<HTMLElement>('[data-count]')) {
      node.textContent = String(counts[node.dataset.count as Status] ?? 0);
    }
    for (const button of el.tabs.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      const current = button.dataset.tab === tab;
      button.classList.toggle('is-active', current);
      button.setAttribute('aria-pressed', String(current));
    }

    const visible = conceptsWithStatus(concepts, tab) as Concept[];
    el.grid.replaceChildren();
    el.empty.hidden = visible.length > 0;
    el.empty.textContent = strings.empty[tab];

    const labels = decisionLabels(locale);
    for (const concept of visible) {
      const card = create('button', 'card');
      card.type = 'button';
      card.addEventListener('click', () => openReader(concept));

      const banner = create('span', 'card-banner');
      if (concept.bannerUrl) {
        const image = document.createElement('img');
        image.src = concept.bannerUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        banner.append(image);
      }
      const body = create('span', 'card-body');
      body.append(create('span', 'card-title', concept.title));
      body.append(create('span', 'card-summary', summary(concept.description)));

      const latest = latestReview(concept.reviews);
      const status = create('span', `card-status is-${conceptStatus(concept)}`);
      status.textContent = latest
        ? `${latest.reviewerName} · ${labels[latest.decision as keyof typeof labels] ?? latest.decision}`
        : strings.noDecisionYet;
      body.append(status);

      card.append(banner, body);
      el.grid.append(card);
    }
  }

  // ------------------------------------------------------------------ reader
  function setReaderState(message: string) {
    el.readerState.textContent = message;
    el.readerState.hidden = !message;
  }

  function fitScale(page: pdfjs.PDFPageProxy) {
    const base = page.getViewport({ scale: 1 });
    const box = el.stage.getBoundingClientRect();
    const pad = box.width < 620 ? 16 : 40;
    return Math.min((box.width - pad) / base.width, (box.height - pad) / base.height);
  }

  async function paint() {
    if (!pdf || view >= pageCount) return;
    const token = ++renderToken;
    const page = await pdf.getPage(view + 1);
    if (token !== renderToken) return;
    const css = fitScale(page) * zoom;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: css * ratio });
    el.canvas.width = viewport.width;
    el.canvas.height = viewport.height;
    el.canvas.style.width = `${viewport.width / ratio}px`;
    try {
      // pdf.js renders into the canvas itself; passing a 2D context as well is rejected.
      await page.render({ canvas: el.canvas, viewport }).promise;
    } catch (error) {
      if (token !== renderToken) return;   // superseded by a newer page or zoom level
      console.error(error);
      setReaderState(strings.documentFailed);
      return;
    }
  }

  function renderDots() {
    el.dots.replaceChildren();
    for (let index = 0; index <= pageCount; index += 1) {
      const dot = create('span', `dot${index === view ? ' is-on' : ''}${index === pageCount ? ' is-end' : ''}`);
      el.dots.append(dot);
    }
  }

  function syncView() {
    const onDecision = view === pageCount;
    el.pageSlide.hidden = onDecision;
    need<HTMLElement>('[data-decision-slide]').hidden = !onDecision;
    el.pageCount.textContent = onDecision ? strings.decideHere : strings.pageOf(view + 1, pageCount);
    el.prev.disabled = view === 0;
    el.next.disabled = view === pageCount;
    renderDots();
    if (!onDecision) void paint();
  }

  function goTo(next: number) {
    const target = Math.max(0, Math.min(pageCount, next));
    if (target === view) return;
    zoom = 1;
    el.pageSlide.scrollTo({ top: 0, left: 0 });
    view = target;
    el.track.classList.remove('slide-in');
    void el.track.offsetWidth;
    el.track.classList.add('slide-in');
    syncView();
  }

  async function openReader(concept: Concept) {
    active = concept;
    view = 0;
    zoom = 1;
    el.readerTitle.textContent = concept.title;
    el.decisionTitle.textContent = concept.title;
    el.decisionForm.reset();
    el.decisionStatus.textContent = '';
    need<HTMLButtonElement>('[data-decision-form] button[type="submit"]').disabled = true;
    el.reader.hidden = false;
    document.body.classList.add('reader-open');
    setReaderState(strings.loadingDocument);

    if (!concept.pdfUrl) {
      pdf = null;
      pageCount = 0;
      view = 0;
      setReaderState(strings.documentFailed);
      el.pageSlide.hidden = true;
      need<HTMLElement>('[data-decision-slide]').hidden = false;
      el.pageCount.textContent = strings.decideHere;
      renderDots();
      return;
    }

    try {
      const url = /^https?:/.test(concept.pdfUrl) ? concept.pdfUrl : withBase(concept.pdfUrl);
      loadingTask = pdfjs.getDocument({ url });
      pdf = await loadingTask.promise;
      pageCount = pdf.numPages;
      setReaderState('');
      syncView();
    } catch (error) {
      console.error(error);
      pdf = null;
      pageCount = 0;
      setReaderState(strings.documentFailed);
    }
  }

  function closeReader() {
    el.reader.hidden = true;
    document.body.classList.remove('reader-open');
    renderToken += 1;
    // Never leave a signed document URL alive behind a closed reader.
    void loadingTask?.destroy();
    loadingTask = null;
    pdf = null;
    active = null;
    pageCount = 0;
    view = 0;
    const context = el.canvas.getContext('2d');
    context?.clearRect(0, 0, el.canvas.width, el.canvas.height);
    el.canvas.width = 0;
    el.canvas.height = 0;
  }

  function setZoom(next: number) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    if (Math.abs(clamped - zoom) < 0.01) return;
    zoom = clamped;
    el.pageSlide.classList.toggle('is-zoomed', zoom > 1);
    void paint();
  }

  // --------------------------------------------------------------- gestures
  let pointerStartX = 0;
  let pointerStartY = 0;
  let dragging = false;
  const pinch = new Map<number, PointerEvent>();
  let pinchStart = 0;
  let pinchZoom = 1;

  el.stage.addEventListener('pointerdown', (event) => {
    pinch.set(event.pointerId, event);
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchZoom = zoom;
      dragging = false;
      return;
    }
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    dragging = zoom === 1 && view < pageCount;
  });

  el.stage.addEventListener('pointermove', (event) => {
    if (pinch.has(event.pointerId)) pinch.set(event.pointerId, event);
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchStart > 0) setZoom(pinchZoom * (distance / pinchStart));
      event.preventDefault();
      return;
    }
    if (!dragging) return;
    const dx = event.clientX - pointerStartX;
    const dy = event.clientY - pointerStartY;
    if (Math.abs(dx) < Math.abs(dy)) return;
    el.track.style.transform = `translateX(${dx * 0.35}px)`;
  });

  function endPointer(event: PointerEvent) {
    pinch.delete(event.pointerId);
    if (pinch.size < 2) pinchStart = 0;
    if (!dragging) return;
    dragging = false;
    el.track.style.transform = '';
    const dx = event.clientX - pointerStartX;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(event.clientY - pointerStartY)) return;
    const forward = document.documentElement.dir === 'rtl' ? dx > 0 : dx < 0;
    goTo(view + (forward ? 1 : -1));
  }

  el.stage.addEventListener('pointerup', endPointer);
  el.stage.addEventListener('pointercancel', endPointer);

  el.stage.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && zoom > 1) return;   // plain wheel pans a zoomed page
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  el.stage.addEventListener('dblclick', () => setZoom(zoom > 1 ? 1 : 2.4));

  // ----------------------------------------------------------------- events
  el.tabs.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
    if (!button) return;
    tab = (button.dataset.tab as Status) ?? 'pending';
    render();
  });

  el.localeToggle.addEventListener('click', () => void setLocale(locale === 'he' ? 'en' : 'he'));
  need<HTMLButtonElement>('[data-change-identity]').addEventListener('click', () => el.identityDialog.showModal());
  need<HTMLButtonElement>('[data-close-reader]').addEventListener('click', closeReader);
  el.prev.addEventListener('click', () => goTo(view - 1));
  el.next.addEventListener('click', () => goTo(view + 1));

  window.addEventListener('keydown', (event) => {
    if (el.reader.hidden) return;
    if (event.key === 'Escape') { closeReader(); return; }
    const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = forward === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward) goTo(view + 1);
    else if (event.key === back) goTo(view - 1);
    else if (event.key === '+' || event.key === '=') setZoom(zoom * 1.25);
    else if (event.key === '-') setZoom(zoom / 1.25);
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (el.reader.hidden) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void paint(), 140);
  });

  el.identityForm.addEventListener('change', () => {
    const selected = new FormData(el.identityForm).get('identity');
    el.advisorField.hidden = selected !== 'advisor';
    el.advisorInput.required = selected === 'advisor';
  });

  el.identityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const kind = String(new FormData(el.identityForm).get('identity')) as Identity['kind'];
    if (!kind || !(kind in strings.people)) return;
    applyIdentity({ kind, name: identityName(kind, el.advisorInput.value) });
    el.identityDialog.close();
  });

  el.decisionForm.addEventListener('change', () => {
    const chosen = new FormData(el.decisionForm).get('decision');
    need<HTMLButtonElement>('[data-decision-form] button[type="submit"]').disabled = !chosen;
  });

  el.decisionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!active) return;
    if (!identity) {
      el.decisionStatus.textContent = strings.decisionNeedsIdentity;
      el.identityDialog.showModal();
      return;
    }
    const submit = need<HTMLButtonElement>('[data-decision-form] button[type="submit"]');
    const data = new FormData(el.decisionForm);
    const decision = String(data.get('decision') ?? '');
    submit.disabled = true;
    el.decisionStatus.textContent = strings.decisionSaving;
    try {
      const result = await saveReview({
        conceptId: active.id, decision, notes: String(data.get('notes') ?? ''), identity,
      });
      active.reviews.push({
        reviewerId: `current:${identity.kind}:${identity.name}`,
        reviewerName: identity.name,
        decision,
        notes: String(data.get('notes') ?? ''),
        createdAt: new Date().toISOString(),
      });
      el.decisionStatus.textContent = result.mode === 'demo' ? strings.decisionSavedLocal : strings.decisionSaved;
      render();
      window.setTimeout(closeReader, 620);
    } catch (error) {
      el.decisionStatus.textContent = error instanceof Error
        ? `${strings.decisionFailed} ${error.message}`
        : strings.decisionFailed;
      submit.disabled = false;
    }
  });

  // ------------------------------------------------------------------- boot
  applyStrings();
  if (identity) applyIdentity(identity); else el.identityDialog.showModal();
  void loadCatalogue().then(render);
}
