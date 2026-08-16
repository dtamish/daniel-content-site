import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  CATEGORY_COLOURS, conceptCategory, conceptStatus, countByStatus, conceptsWithStatus,
  decisionLabels, groupByCategory, latestReview, sortApprovedConcepts, visibleCommentReviews,
} from '../lib/review-state.mjs';
import { DEFAULT_LOCALE, STRINGS, direction, isLocale, type Locale, type ReviewerRole } from '../lib/i18n';
import {
  isSupabaseConfigured, loadConcepts, saveConceptAssessment, saveReview,
  type BudgetLevel, type ConceptAssessment, type Identity, type ProductionSpeed,
} from '../lib/concept-repository';
import { withBase } from '../lib/urls';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Review = {
  id?: string;
  reviewerId: string; reviewerName: string; reviewerRole?: ReviewerRole; isOwn?: boolean;
  decision: string; notes?: string; affectsDecision?: boolean; clearPriorNotes?: boolean;
  supersedesReviewId?: string | null; createdAt: string;
};
type Concept = {
  id: string; title: string; description: string; priority: number; category: string;
  bannerUrl: string; pdfUrl: string; reviews: Review[]; assessment: ConceptAssessment | null;
};
type Status = 'pending' | 'approved' | 'rejected';

const IDENTITY_KEY = 'concept-approval:identity';
const LOCALE_KEY = 'concept-approval:locale';
const REVIEWER_ID_KEY = 'concept-approval:reviewer-id';
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
    viewButtons: need<HTMLElement>('.catalogue-tools'),
    approvedSort: need<HTMLElement>('[data-approved-sort]'),
    approvedSortLabel: need<HTMLElement>('[data-approved-sort-label]'),
    approvedSortSelect: need<HTMLSelectElement>('[data-approved-sort-select]'),
    identityDialog: need<HTMLDialogElement>('[data-identity-dialog]'),
    identityForm: need<HTMLFormElement>('[data-identity-form]'),

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
    documentPanel: need<HTMLElement>('[data-document-panel]'),
    commentsPanel: need<HTMLElement>('[data-comments-panel]'),
    commentsList: need<HTMLElement>('[data-comments-list]'),
    commentsEmpty: need<HTMLElement>('[data-comments-empty]'),
    commentsForm: need<HTMLFormElement>('[data-comments-form]'),
    commentsInput: need<HTMLTextAreaElement>('[data-comments-input]'),
    commentsStatus: need<HTMLElement>('[data-comments-status]'),
    commentsSubmit: need<HTMLButtonElement>('[data-comments-submit]'),
    pendingDecision: need<HTMLElement>('[data-pending-decision]'),
    commentsTitle: need<HTMLElement>('[data-comments-concept-title]'),
    commentsLock: need<HTMLElement>('[data-comments-lock]'),
    openComments: need<HTMLButtonElement>('[data-open-comments]'),
    viewDocument: need<HTMLButtonElement>('[data-view-document]'),
    resetDecision: need<HTMLButtonElement>('[data-reset-decision]'),
    resetDialog: need<HTMLDialogElement>('[data-reset-dialog]'),
    resetForm: need<HTMLFormElement>('[data-reset-form]'),
    resetCancel: need<HTMLButtonElement>('[data-reset-cancel]'),
    resetSubmit: need<HTMLButtonElement>('[data-reset-submit]'),
    resetStatus: need<HTMLElement>('[data-reset-status]'),
  };

  let locale: Locale = readLocale();
  let strings = STRINGS[locale];
  let concepts: Concept[] = [];
  const cache = new Map<Locale, Concept[]>();
  let tab: Status = 'pending';
  let catalogueView: 'grid' | 'list' = 'grid';
  let approvedSort: 'default' | 'speed' | 'budget' | 'viability' = 'default';
  let identity: Identity | null = readIdentity();
  let pendingDecision = '';
  let editingDecision = '';
  let editingReviewId: string | null = null;
  let resetTarget: Concept | null = null;
  const localReviewerId = readReviewerId();
  let readerPreviousFocus: HTMLElement | null = null;

  let pdf: pdfjs.PDFDocumentProxy | null = null;
  let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
  let active: Concept | null = null;
  let view = 0;            // 0..pageCount-1 are pages, pageCount is the decision panel
  let pageCount = 0;
  let zoom = 1;
  let renderToken = 0;
  let renderTask: pdfjs.RenderTask | null = null;
  let paintChain: Promise<unknown> = Promise.resolve();

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
      const legacy: Record<string, ReviewerRole> = {
        honi: 'management', itzik: 'management', editor: 'content_editor', advisor: 'advisor',
      };
      const kind = legacy[parsed?.kind] ?? parsed?.kind;
      return ['management', 'content_editor', 'advisor'].includes(kind)
        ? { kind, name: STRINGS[readLocale()].people[kind as ReviewerRole] }
        : null;
    } catch {
      return null;
    }
  }

  function readReviewerId() {
    const existing = localStorage.getItem(REVIEWER_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(REVIEWER_ID_KEY, created);
    return created;
  }

  function identityName(kind: Identity['kind'], custom: string) {
    void custom;
    return strings.people[kind];
  }

  function applyIdentity(next: Identity) {
    identity = next;
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(next));
    el.identityLabel.textContent = next.name;
    el.identityInitial.textContent = [...next.name][0] ?? '?';
    el.manageLink.hidden = next.kind !== 'content_editor';
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
    'person.management': () => strings.people.management,
    'person.content_editor': () => strings.people.content_editor,
    'person.advisor': () => strings.people.advisor,
    'tab.pending': () => strings.tabs.pending,
    'tab.approved': () => strings.tabs.approved,
    'tab.rejected': () => strings.tabs.rejected,
    decisionFor: () => strings.decisionFor,
    decisionHelp: () => strings.decisionHelp,
    decisionContinue: () => strings.decisionContinue,
    gridView: () => strings.gridView,
    listView: () => strings.listView,
    documentView: () => strings.documentView,
    commentsView: () => strings.commentsView,
    commentsTitle: () => strings.commentsTitle,
    commentsEmpty: () => strings.commentsEmpty,
    commentsHelp: () => strings.commentsHelp,
    commentsOptional: () => strings.commentsOptional,
    resetTitle: () => strings.resetTitle,
    resetHelp: () => strings.resetHelp,
    resetKeepNotes: () => strings.resetKeepNotes,
    resetClearNotes: () => strings.resetClearNotes,
  };

  function applyStrings() {
    strings = STRINGS[locale];
    document.documentElement.lang = locale;
    document.documentElement.dir = direction(locale);
    for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const value = I18N_TARGETS[node.dataset.i18n ?? ''];
      if (value) node.textContent = value();
    }
    const labels = decisionLabels(locale) as Record<string, string>;
    for (const node of root.querySelectorAll<HTMLElement>('[data-decision-label]')) {
      node.textContent = labels[node.dataset.decisionLabel as keyof typeof labels] ?? '';
    }
    el.localeLabel.textContent = strings.languageSwitchTo;
    el.localeToggle.setAttribute('aria-label', strings.languageSwitchLabel);
    if (identity) identity = { ...identity, name: strings.people[identity.kind] };
    el.identityLabel.textContent = identity ? strings.people[identity.kind] : strings.identityQuestion;
    el.prev.setAttribute('aria-label', strings.prevPage);
    el.next.setAttribute('aria-label', strings.nextPage);
    need<HTMLButtonElement>('[data-close-reader]').setAttribute('aria-label', strings.close);
    el.notice.textContent = isSupabaseConfigured ? strings.liveNotice : strings.demoNotice;
    el.notice.hidden = !el.notice.textContent;
    el.commentsInput.placeholder = strings.commentsPlaceholder;
    el.viewDocument.textContent = strings.viewDocument;
    el.resetDecision.textContent = strings.resetDecision;
    el.resetCancel.textContent = strings.resetCancel;
    el.resetSubmit.textContent = strings.resetSubmit;
    el.commentsLock.textContent = strings.commentsLocked;
    el.approvedSortLabel.textContent = strings.approvedSortLabel;
    for (const option of el.approvedSortSelect.options) {
      option.textContent = strings.approvedSorts[option.value as keyof typeof strings.approvedSorts];
    }
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
        const roleMap: Record<string, ReviewerRole> = { honi: 'management', itzik: 'management', editor: 'content_editor', advisor: 'advisor' };
        const role = roleMap[record.identity.kind] ?? record.identity.kind;
        const decision = record.decision;
        concept.reviews.push({
          id: record.id ?? `legacy:${record.createdAt}`,
          reviewerId: record.reviewerId ?? `legacy:${record.createdAt}`,
          reviewerName: strings.people[role as ReviewerRole],
          reviewerRole: role,
          isOwn: record.reviewerId === localReviewerId,
          decision,
          notes: record.notes ?? '',
          affectsDecision: record.affectsDecision !== false,
          clearPriorNotes: record.clearPriorNotes === true,
          supersedesReviewId: record.supersedesReviewId ?? null,
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
    el.grid.classList.toggle('room-view-list', catalogueView === 'list');
    const counts = countByStatus(concepts);
    for (const node of el.tabs.querySelectorAll<HTMLElement>('[data-count]')) {
      node.textContent = String(counts[node.dataset.count as Status] ?? 0);
    }
    for (const button of el.tabs.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      const current = button.dataset.tab === tab;
      button.classList.toggle('is-active', current);
      button.setAttribute('aria-pressed', String(current));
    }

    const baseVisible = conceptsWithStatus(concepts, tab) as Concept[];
    const visible = tab === 'approved'
      ? sortApprovedConcepts(baseVisible, approvedSort) as Concept[]
      : baseVisible;
    el.approvedSort.hidden = tab !== 'approved';
    el.grid.replaceChildren();
    el.empty.hidden = visible.length > 0;
    el.empty.textContent = strings.empty[tab];

    const labels = decisionLabels(locale) as Record<string, string>;
    if (tab === 'approved' && approvedSort !== 'default') {
      const row = create('div', 'group-grid sorted-grid');
      el.grid.append(row);
      renderCards(visible, row, labels, '#3d7f73');
      return;
    }
    for (const { category, items } of groupByCategory(visible)) {
      const colour = CATEGORY_COLOURS[category as keyof typeof CATEGORY_COLOURS];
      const section = create('section', 'group');
      section.style.setProperty('--group', colour);
      const head = create('h2', 'group-head');
      head.append(create('span', 'group-dot'),
                  create('span', 'group-name', strings.categories[category as keyof typeof strings.categories]),
                  create('b', 'group-count', String(items.length)));
      const row = create('div', 'group-grid');
      section.append(head, row);
      el.grid.append(section);
      renderCards(items, row, labels, colour);
    }
  }

  function renderCards(visible: Concept[], target: HTMLElement, labels: Record<string, string>, colour: string) {
    for (const concept of visible) {
      const status = conceptStatus(concept);
      const article = create('article', 'card');
      article.style.setProperty('--group', CATEGORY_COLOURS[conceptCategory(concept) as keyof typeof CATEGORY_COLOURS] ?? colour);
      if (status === 'approved') article.append(renderAssessment(concept));
      const card = create('button', 'card-open');
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
      body.append(create('span', 'card-category', strings.categories[conceptCategory(concept) as keyof typeof strings.categories]));
      body.append(create('span', 'card-summary', summary(concept.description)));

      const latest = latestReview(concept.reviews);
      const latestRole = (latest?.reviewerRole ?? 'advisor') as ReviewerRole;
      const mark = create('span', `card-status is-${status}`);
      mark.textContent = latest
        ? `${strings.people[latestRole]} · ${labels[latest.decision as keyof typeof labels] ?? strings.tabs.pending}`
        : strings.noDecisionYet;
      body.append(mark);

      card.append(banner, body);
      article.append(card);

      const commentCount = visibleCommentReviews(concept.reviews).length;
      if (status !== 'pending' || commentCount > 0) {
        const actions = create('div', 'card-actions');
        const comments = create('button', 'card-comments', strings.commentsAction(commentCount));
        comments.type = 'button';
        comments.addEventListener('click', () => void openReader(concept, 'comments'));
        actions.append(comments);
        if (status !== 'pending') {
          const reset = create('button', 'card-reset', strings.resetDecision);
          reset.type = 'button';
          reset.addEventListener('click', () => openResetDialog(concept));
          actions.append(reset);
        }
        article.append(actions);
      }

      target.append(article);
    }
  }

  function renderAssessment(concept: Concept) {
    const panel = create('div', 'assessment-panel');
    const chips = create('div', 'assessment-chips');
    const speedChip = create('span', 'assessment-chip assessment-speed');
    const budgetChip = create('span', 'assessment-chip assessment-budget');
    const updateChips = () => {
      speedChip.textContent = `${strings.assessment.productionSpeed} · ${concept.assessment
        ? strings.assessment.speed[concept.assessment.productionSpeed]
        : strings.assessment.unassessed}`;
      budgetChip.textContent = `${strings.assessment.budget} · ${concept.assessment
        ? strings.assessment.budgetValues[concept.assessment.budgetLevel]
        : strings.assessment.unassessed}`;
    };
    updateChips();
    chips.append(speedChip, budgetChip);
    panel.append(chips);

    if (identity?.kind === 'content_editor') {
      const editor = create('details', 'assessment-editor');
      editor.setAttribute('data-assessment-editor', '');
      editor.append(create('summary', '', strings.assessment.edit));
      const form = create('form', 'assessment-form');
      const speed = create('select', 'assessment-select') as HTMLSelectElement;
      speed.name = 'production-speed';
      speed.setAttribute('aria-label', strings.assessment.productionSpeed);
      for (const value of ['fast', 'medium', 'slow'] as ProductionSpeed[]) {
        const option = new Option(strings.assessment.speed[value], value);
        option.selected = value === (concept.assessment?.productionSpeed ?? 'medium');
        speed.add(option);
      }
      const budget = create('select', 'assessment-select') as HTMLSelectElement;
      budget.name = 'budget-level';
      budget.setAttribute('aria-label', strings.assessment.budget);
      for (const value of ['low', 'medium', 'high'] as BudgetLevel[]) {
        const option = new Option(strings.assessment.budgetValues[value], value);
        option.selected = value === (concept.assessment?.budgetLevel ?? 'medium');
        budget.add(option);
      }
      const save = create('button', 'assessment-save', strings.assessment.save);
      save.type = 'submit';
      const status = create('span', 'assessment-status');
      status.setAttribute('role', 'status');
      form.append(speed, budget, save, status);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!identity || identity.kind !== 'content_editor') return;
        save.setAttribute('disabled', '');
        status.textContent = strings.assessment.saving;
        try {
          const result = await saveConceptAssessment({
            conceptId: concept.id,
            productionSpeed: speed.value as ProductionSpeed,
            budgetLevel: budget.value as BudgetLevel,
            identity,
          });
          concept.assessment = result;
          updateChips();
          status.textContent = strings.assessment.saved;
          if (approvedSort !== 'default') render();
        } catch (error) {
          console.error(error);
          status.textContent = strings.assessment.failed;
        } finally {
          save.removeAttribute('disabled');
        }
      });
      editor.append(form);
      panel.append(editor);
    }
    return panel;
  }

  // ------------------------------------------------------------------ reader
  function openResetDialog(concept: Concept) {
    resetTarget = concept;
    el.resetForm.reset();
    el.resetStatus.textContent = '';
    el.resetSubmit.disabled = false;
    el.resetDialog.showModal();
  }

  function switchReaderView(next: 'document' | 'comments') {
    const comments = next === 'comments';
    el.documentPanel.hidden = comments;
    el.commentsPanel.hidden = !comments;
    root.classList.toggle('reader-comments-open', comments);
    if (comments) {
      renderComments();
      el.openComments.hidden = true;
    } else if (active) {
      const count = visibleCommentReviews(active.reviews).length;
      el.openComments.textContent = strings.commentsAction(count);
      el.openComments.hidden = conceptStatus(active) === 'pending' && count === 0;
    }
  }

  function ownLatestReview() {
    if (!active) return null;
    return [...active.reviews].reverse().find((review) => review.isOwn && review.decision !== 'reset') ?? null;
  }

  function renderComments() {
    if (!active) return;
    const labels = decisionLabels(locale) as Record<string, string>;
    const comments = visibleCommentReviews(active.reviews) as Review[];
    const status = conceptStatus(active) as Status;
    el.commentsTitle.textContent = active.title;
    el.openComments.textContent = strings.commentsAction(comments.length);
    el.openComments.hidden = root.classList.contains('reader-comments-open') || (status === 'pending' && comments.length === 0);
    el.resetDecision.hidden = status === 'pending';
    el.commentsList.replaceChildren();
    el.commentsEmpty.hidden = comments.length > 0;
    for (const review of comments) {
      const role = review.reviewerRole ?? 'advisor';
      const article = create('article', `comment comment-role-${role}`);
      const head = create('div', 'comment-head');
      head.append(
        create('strong', '', strings.people[role]),
        create('span', '', labels[review.decision] ?? strings.tabs.pending),
      );
      article.append(head, create('p', 'comment-body', review.notes));
      if (review.isOwn && status !== 'pending') {
        const edit = create('button', 'comment-edit', strings.editComment);
        edit.type = 'button';
        edit.addEventListener('click', () => {
          el.commentsInput.value = review.notes ?? '';
          editingDecision = review.decision;
          editingReviewId = review.id ?? null;
          el.commentsInput.focus();
          el.commentsSubmit.textContent = strings.saveComment;
        });
        article.append(edit);
      }
      el.commentsList.append(article);
    }
    const canWrite = Boolean(pendingDecision) || status !== 'pending';
    el.commentsSubmit.textContent = pendingDecision ? strings.saveDecision : (editingReviewId ? strings.saveComment : strings.addComment);
    el.commentsSubmit.hidden = !canWrite;
    el.commentsInput.disabled = !canWrite;
    el.commentsLock.hidden = canWrite;
    el.pendingDecision.hidden = !pendingDecision;
    el.pendingDecision.textContent = pendingDecision ? `${strings.lastDecision}: ${labels[pendingDecision] ?? pendingDecision}` : '';
  }

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

  /**
   * pdf.js refuses a second render onto a canvas while the first is still running, so the
   * previous task is always cancelled first. Nothing ever awaits a render promise: a render
   * that never settles would otherwise block every later paint, which is exactly what made
   * zooming look like it did nothing.
   */
  function requestPaint() {
    paintChain = paintChain.catch(() => undefined).then(paint);
    return paintChain;
  }

  function cancelRender() {
    const task = renderTask;
    renderTask = null;
    if (!task) return;
    try {
      task.cancel();
    } catch {
      // already finished
    }
  }

  async function paint() {
    if (!pdf || view >= pageCount) return;
    const token = ++renderToken;
    cancelRender();
    const page = await pdf.getPage(view + 1);
    if (token !== renderToken) return;
    const css = fitScale(page) * zoom;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: css * ratio });
    // Each render gets its own canvas. cancel() does not release a canvas synchronously, so
    // sharing one makes pdf.js reject the next render as "the same canvas" whenever a zoom,
    // a page change and a resize overlap. The finished bitmap is copied across on success.
    const buffer = document.createElement('canvas');
    buffer.width = viewport.width;
    buffer.height = viewport.height;
    const task = page.render({ canvas: buffer, viewport });
    renderTask = task;
    const done = () => { if (renderTask === task) renderTask = null; };
    task.promise.then(() => {
      done();
      if (token !== renderToken) return;
      el.canvas.width = buffer.width;
      el.canvas.height = buffer.height;
      el.canvas.style.width = `${buffer.width / ratio}px`;
      el.canvas.getContext('2d')?.drawImage(buffer, 0, 0);
    }, (error: unknown) => {
      done();
      if (token !== renderToken) return;   // superseded by a newer page or zoom level
      if (error && (error as { name?: string }).name === 'RenderingCancelledException') return;
      console.error(error);
      setReaderState(strings.documentFailed);
    });
  }

  function renderDots() {
    el.dots.replaceChildren();
    for (let index = 0; index < pageCount; index += 1) {
      el.dots.append(create('span', `dot${index === view ? ' is-on' : ''}`));
    }
    // The decision is the point of reading the document, so it is a labelled stop on the
    // pager rather than one more anonymous dot.
    const decide = create('button', `decide-stop${view === pageCount ? ' is-on' : ''}`);
    decide.type = 'button';
    decide.append(create('span', 'decide-icon'), create('span', 'decide-cap', strings.decisionMarker));
    decide.addEventListener('click', () => goTo(pageCount));
    el.dots.append(decide);
  }

  function syncView() {
    clearTrack();
    const onDecision = view === pageCount;
    el.pageSlide.hidden = onDecision;
    need<HTMLElement>('[data-decision-slide]').hidden = !onDecision;
    el.pageCount.textContent = onDecision ? strings.decideHere : strings.pageOf(view + 1, pageCount);
    el.prev.disabled = view === 0;
    el.next.disabled = view === pageCount;
    renderDots();
    if (!onDecision) void requestPaint();
  }

  function goTo(next: number, animate = true) {
    const target = Math.max(0, Math.min(pageCount, next));
    if (target === view) return;
    zoom = 1;
    el.pageSlide.classList.remove('is-zoomed');
    el.pageSlide.scrollTo({ top: 0, left: 0 });
    view = target;
    if (animate) {
      // A swipe animates the track itself, so it must not also run this keyframe.
      el.track.classList.remove('slide-in');
      void el.track.offsetWidth;
      el.track.classList.add('slide-in');
    }
    syncView();
  }

  async function openReader(concept: Concept, initialView: 'document' | 'comments' = 'document') {
    readerPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active = concept;
    pendingDecision = '';
    editingDecision = '';
    editingReviewId = null;
    view = 0;
    zoom = 1;
    el.readerTitle.textContent = concept.title;
    el.decisionTitle.textContent = concept.title;
    el.decisionForm.reset();
    el.commentsForm.reset();
    el.decisionStatus.textContent = '';
    need<HTMLButtonElement>('[data-decision-form] button[type="submit"]').disabled = true;
    el.reader.hidden = false;
    switchReaderView(initialView);
    document.body.classList.add('reader-open');
    need<HTMLButtonElement>('[data-close-reader]').focus();
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
    void cancelRender();
    // Never leave a signed document URL alive behind a closed reader.
    void loadingTask?.destroy();
    loadingTask = null;
    pdf = null;
    active = null;
    pendingDecision = '';
    editingDecision = '';
    editingReviewId = null;
    pageCount = 0;
    view = 0;
    const context = el.canvas.getContext('2d');
    context?.clearRect(0, 0, el.canvas.width, el.canvas.height);
    el.canvas.width = 0;
    el.canvas.height = 0;
    readerPreviousFocus?.focus();
    readerPreviousFocus = null;
  }

  /** Keeps the same point of the page under the finger or cursor while scaling. */
  function setZoom(next: number, anchor?: { x: number; y: number }) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    if (Math.abs(clamped - zoom) < 0.005) return;
    const previous = zoom;
    const box = el.pageSlide.getBoundingClientRect();
    const point = anchor ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const beforeX = el.pageSlide.scrollLeft + (point.x - box.left);
    const beforeY = el.pageSlide.scrollTop + (point.y - box.top);
    zoom = clamped;
    el.pageSlide.classList.toggle('is-zoomed', zoom > 1.01);
    void requestPaint().then(() => {
      const growth = zoom / previous;
      el.pageSlide.scrollLeft = beforeX * growth - (point.x - box.left);
      el.pageSlide.scrollTop = beforeY * growth - (point.y - box.top);
    });
  }

  // --------------------------------------------------------------- gestures
  const points = new Map<number, { x: number; y: number }>();
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let startScrollTop = 0;
  let gesture: 'none' | 'undecided' | 'swipe' | 'pan' | 'pinch' = 'none';
  let pinchDistance = 0;
  let pinchZoom = 1;
  let lastTap = 0;


  // The distance travelled is measured from the last movement, never from the ending
  // event: pointercancel and touchcancel commonly carry clientX 0, which would read as a
  // large swipe in whichever direction happens to be negative.
  let lastX = 0;
  let lastY = 0;

  function beginGesture(x: number, y: number) {
    startX = lastX = x;
    startY = lastY = y;
    startScrollLeft = el.pageSlide.scrollLeft;
    startScrollTop = el.pageSlide.scrollTop;
    gesture = 'undecided';
  }

  function moveGesture(x: number, y: number, prevent: () => void) {
    lastX = x;
    lastY = y;
    const dx = x - startX;
    const dy = y - startY;
    if (gesture === 'undecided') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // A zoomed page is dragged around; an unzoomed one is swiped between pages.
      gesture = zoom > 1.01 ? 'pan' : (Math.abs(dx) > Math.abs(dy) * 0.8 ? 'swipe' : 'none');
    }
    if (gesture === 'pan') {
      prevent();
      el.pageSlide.scrollLeft = startScrollLeft - dx;
      el.pageSlide.scrollTop = startScrollTop - dy;
      return;
    }
    if (gesture === 'swipe') {
      prevent();
      const limit = el.stage.clientWidth || 1;
      const resisted = Math.sign(dx) * Math.min(Math.abs(dx), limit) * 0.9;
      el.track.style.transition = 'none';
      el.track.style.transform = `translateX(${resisted}px)`;
      el.track.style.opacity = String(Math.max(0.35, 1 - Math.abs(resisted) / limit));
    }
  }

  function endGesture(timeStamp: number) {
    const dx = lastX - startX;
    const dy = lastY - startY;
    if (gesture === 'swipe') {
      releaseSwipe(dx);
    } else if (gesture === 'undecided' && Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      if (timeStamp - lastTap < 320) {
        setZoom(zoom > 1.01 ? 1 : 2.6, { x: lastX, y: lastY });
        lastTap = 0;
      } else {
        lastTap = timeStamp;
      }
    }
    gesture = 'none';
  }

  function releaseSwipe(dx: number) {
    const width = el.stage.clientWidth || 1;
    // In Hebrew a page is turned the way a Hebrew book is: rightwards moves forward.
    const forward = document.documentElement.dir === 'rtl' ? dx > 0 : dx < 0;
    const target = Math.max(0, Math.min(pageCount, view + (forward ? 1 : -1)));
    const far = Math.abs(dx) > Math.min(70, width * 0.16);

    el.track.style.transition = 'transform .16s ease, opacity .16s ease';
    if (!far || target === view) {
      clearTrack();
      return;
    }
    el.track.style.transform = `translateX(${Math.sign(dx) * width * 0.5}px)`;
    el.track.style.opacity = '0';
    // The incoming page uses the ordinary slide-in keyframe. Nothing here waits on
    // requestAnimationFrame, so a throttled frame can never leave the page invisible.
    window.setTimeout(() => {
      clearTrack();
      goTo(target);
    }, 150);
  }

  function clearTrack() {
    el.track.style.transition = '';
    el.track.style.transform = '';
    el.track.style.opacity = '';
  }

  // Touch is handled through touch events rather than pointer events: they are the most
  // widely reliable on phones, and they avoid pointer capture entirely.
  el.stage.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      gesture = 'pinch';
      pinchDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchZoom = zoom;
      return;
    }
    if (event.touches.length > 2) return;
    beginGesture(event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: false });

  el.stage.addEventListener('touchmove', (event) => {
    if (gesture === 'pinch') {
      if (event.touches.length < 2 || pinchDistance <= 0) return;
      const [a, b] = [event.touches[0], event.touches[1]];
      event.preventDefault();
      setZoom(pinchZoom * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinchDistance),
        { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
      return;
    }
    if (!event.touches.length) return;
    moveGesture(event.touches[0].clientX, event.touches[0].clientY, () => event.preventDefault());
  }, { passive: false });

  const finishTouch = (event: TouchEvent) => {
    if (event.touches.length) return;   // a finger is still down
    if (gesture === 'pinch') { gesture = 'none'; pinchDistance = 0; return; }
    endGesture(event.timeStamp);
  };
  el.stage.addEventListener('touchend', finishTouch);
  el.stage.addEventListener('touchcancel', finishTouch);

  // Mouse keeps using pointer events; touch input is already handled above.
  el.stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture(event.clientX, event.clientY);
  });

  el.stage.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || !points.has(event.pointerId)) return;
    moveGesture(event.clientX, event.clientY, () => event.preventDefault());
  });

  function endPointer(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !points.has(event.pointerId)) return;
    points.delete(event.pointerId);
    endGesture(event.timeStamp);
  }

  el.stage.addEventListener('pointerup', endPointer);
  el.stage.addEventListener('pointercancel', endPointer);

  el.stage.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && zoom > 1.01) return;   // plain wheel pans a zoomed page
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), { x: event.clientX, y: event.clientY });
  }, { passive: false });

  need<HTMLButtonElement>('[data-zoom-in]').addEventListener('click', () => setZoom(zoom * 1.4));
  need<HTMLButtonElement>('[data-zoom-out]').addEventListener('click', () => setZoom(zoom / 1.4));

  el.stage.addEventListener('dblclick', () => setZoom(zoom > 1 ? 1 : 2.4));

  // ----------------------------------------------------------------- events
  el.tabs.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
    if (!button) return;
    tab = (button.dataset.tab as Status) ?? 'pending';
    render();
  });

  el.viewButtons.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
    if (!button) return;
    catalogueView = button.dataset.view === 'list' ? 'list' : 'grid';
    for (const candidate of el.viewButtons.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      const current = candidate === button;
      candidate.classList.toggle('is-active', current);
      candidate.setAttribute('aria-pressed', String(current));
    }
    render();
  });

  el.approvedSortSelect.addEventListener('change', () => {
    approvedSort = el.approvedSortSelect.value as typeof approvedSort;
    render();
  });

  el.localeToggle.addEventListener('click', () => void setLocale(locale === 'he' ? 'en' : 'he'));
  need<HTMLButtonElement>('[data-change-identity]').addEventListener('click', () => el.identityDialog.showModal());
  need<HTMLButtonElement>('[data-close-reader]').addEventListener('click', closeReader);
  el.openComments.addEventListener('click', () => switchReaderView('comments'));
  el.viewDocument.addEventListener('click', () => switchReaderView('document'));
  el.resetDecision.addEventListener('click', () => { if (active) openResetDialog(active); });
  el.resetCancel.addEventListener('click', () => { resetTarget = null; el.resetDialog.close(); });
  el.resetDialog.addEventListener('close', () => { resetTarget = null; });
  el.prev.addEventListener('click', () => goTo(view - 1));
  el.next.addEventListener('click', () => goTo(view + 1));

  window.addEventListener('keydown', (event) => {
    // Let an open native modal own its focus cycle and Escape key. Without this
    // guard the reader trap reaches behind reset/identity dialogs.
    if (root.querySelector<HTMLDialogElement>('dialog[open]')) return;
    if (el.reader.hidden) return;
    if (event.key === 'Escape') { closeReader(); return; }
    if (event.key === 'Tab') {
      const focusable = [...el.reader.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.closest('[hidden]') && node.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); el.reader.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
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
    resizeTimer = window.setTimeout(() => void requestPaint(), 140);
  });

  el.identityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const kind = String(new FormData(el.identityForm).get('identity')) as Identity['kind'];
    if (!kind || !(kind in strings.people)) return;
    applyIdentity({ kind, name: identityName(kind, '') });
    el.identityDialog.close();
    render();
  });

  el.decisionForm.addEventListener('change', () => {
    const chosen = new FormData(el.decisionForm).get('decision');
    need<HTMLButtonElement>('[data-decision-form] button[type="submit"]').disabled = !chosen;
  });

  el.decisionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!active) return;
    if (!identity) {
      el.decisionStatus.textContent = strings.decisionNeedsIdentity;
      el.identityDialog.showModal();
      return;
    }
    pendingDecision = String(new FormData(el.decisionForm).get('decision') ?? '');
    if (!pendingDecision) return;
    editingDecision = '';
    editingReviewId = null;
    el.commentsInput.value = '';
    el.decisionStatus.textContent = '';
    switchReaderView('comments');
    window.setTimeout(() => el.commentsInput.focus(), 0);
  });

  el.resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const concept = resetTarget;
    if (!concept) return;
    if (!identity) {
      el.resetDialog.close();
      el.identityDialog.showModal();
      return;
    }
    const clearPriorNotes = new FormData(el.resetForm).get('reset-notes') === 'clear';
    el.resetSubmit.disabled = true;
    el.resetStatus.textContent = strings.resetSaving;
    try {
      const result = await saveReview({
        conceptId: concept.id,
        decision: 'reset',
        notes: '',
        identity,
        reviewerId: localReviewerId,
        clearPriorNotes,
      });
      concept.reviews.push({
        id: result.id,
        reviewerId: result.reviewerId,
        reviewerName: strings.people[result.reviewerRole],
        reviewerRole: result.reviewerRole,
        isOwn: true,
        decision: 'reset',
        notes: '',
        affectsDecision: true,
        clearPriorNotes,
        supersedesReviewId: null,
        createdAt: result.createdAt,
      });
      el.resetStatus.textContent = strings.resetSaved;
      resetTarget = null;
      el.resetDialog.close();
      tab = 'pending';
      if (active?.id === concept.id) closeReader();
      render();
    } catch (error) {
      el.resetStatus.textContent = error instanceof Error
        ? `${strings.resetFailed} ${error.message}`
        : strings.resetFailed;
      el.resetSubmit.disabled = false;
    }
  });

  el.commentsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!active) return;
    if (!identity) {
      el.commentsStatus.textContent = strings.decisionNeedsIdentity;
      el.identityDialog.showModal();
      return;
    }
    const wasDecision = Boolean(pendingDecision);
    const decision = pendingDecision || editingDecision || ownLatestReview()?.decision || '';
    if (!decision) {
      el.commentsStatus.textContent = strings.chooseDecisionFirst;
      switchReaderView('document');
      goTo(pageCount);
      return;
    }
    const notes = el.commentsInput.value.trim();
    el.commentsSubmit.disabled = true;
    el.commentsStatus.textContent = strings.decisionSaving;
    try {
      const result = await saveReview({
        conceptId: active.id,
        decision,
        notes,
        identity,
        reviewerId: localReviewerId,
        affectsDecision: wasDecision,
        supersedesReviewId: editingReviewId,
      });
      active.reviews.push({
        id: result.id,
        reviewerId: result.reviewerId,
        reviewerName: strings.people[result.reviewerRole],
        reviewerRole: result.reviewerRole,
        isOwn: true,
        decision,
        notes,
        affectsDecision: wasDecision,
        clearPriorNotes: false,
        supersedesReviewId: editingReviewId,
        createdAt: result.createdAt,
      });
      el.commentsStatus.textContent = result.mode === 'demo'
        ? strings.decisionSavedLocal
        : (pendingDecision ? strings.decisionSaved : strings.commentSaved);
      pendingDecision = '';
      editingDecision = '';
      editingReviewId = null;
      el.commentsInput.value = '';
      if (wasDecision) {
        tab = decision === 'canceled' ? 'rejected' : 'approved';
        closeReader();
        render();
      } else {
        renderComments();
        render();
      }
    } catch (error) {
      el.commentsStatus.textContent = error instanceof Error
        ? `${strings.decisionFailed} ${error.message}`
        : strings.decisionFailed;
    } finally {
      el.commentsSubmit.disabled = false;
    }
  });

  // ------------------------------------------------------------------- boot
  applyStrings();
  if (identity) applyIdentity(identity); else el.identityDialog.showModal();
  void loadCatalogue().then(render);
}
