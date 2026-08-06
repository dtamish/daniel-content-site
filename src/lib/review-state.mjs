export const DECISIONS = Object.freeze({
  'priority-approved': 'מאושר להפקה ולקדם במיידי',
  'schedule-approved': 'מאושר להפקה בסדר לוח השידורים',
  wait: 'להמתין עם זה',
  canceled: 'לא מאושר להפקה — לבטל רעיון',
});

const DECISIONS_EN = Object.freeze({
  'priority-approved': 'Approved — fast-track production',
  'schedule-approved': 'Approved — schedule in the normal slate',
  wait: 'Hold for now',
  canceled: 'Not approved — drop the idea',
});

/** Decision labels are content, so they are translated, while the stored keys never change. */
export function decisionLabels(locale = 'he') {
  return locale === 'en' ? DECISIONS_EN : DECISIONS;
}

export function decisionLabel(decision, locale = 'he') {
  return decisionLabels(locale)[decision] ?? decision;
}

/** The three review tabs. A concept sits in exactly one of them. */
export const STATUSES = Object.freeze(['pending', 'approved', 'rejected']);

const STATUS_OF_DECISION = Object.freeze({
  'priority-approved': 'approved',
  'schedule-approved': 'approved',
  wait: 'pending',
  canceled: 'rejected',
});

export function latestReview(reviews = []) {
  let latest = null;
  for (const review of reviews) {
    if (!latest || new Date(review.createdAt).valueOf() >= new Date(latest.createdAt).valueOf()) {
      latest = review;
    }
  }
  return latest;
}

export function conceptStatus(concept) {
  const latest = latestReview(concept?.reviews);
  return latest ? STATUS_OF_DECISION[latest.decision] ?? 'pending' : 'pending';
}

export function countByStatus(concepts = []) {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const concept of concepts) counts[conceptStatus(concept)] += 1;
  return counts;
}

export function conceptsWithStatus(concepts = [], status) {
  return concepts.filter((concept) => conceptStatus(concept) === status);
}

export const MAX_DESCRIPTION_LENGTH = 500;

export function isDecision(value) {
  return Object.hasOwn(DECISIONS, value);
}

export function createReview({ conceptId, reviewerId, reviewerName, decision, notes = '', createdAt }) {
  if (!isDecision(decision)) throw new TypeError('Invalid decision');
  if (!conceptId || !reviewerId || !reviewerName) throw new TypeError('Missing review identity');

  return {
    conceptId,
    reviewerId,
    reviewerName,
    decision,
    notes: String(notes).trim(),
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

export function latestReviewsByReviewer(reviews = []) {
  const latest = new Map();
  for (const review of reviews) {
    const current = latest.get(review.reviewerId);
    if (!current || new Date(review.createdAt).valueOf() >= new Date(current.createdAt).valueOf()) {
      latest.set(review.reviewerId, review);
    }
  }
  return [...latest.values()];
}

export function getReviewerBadges(reviews = []) {
  return latestReviewsByReviewer(reviews)
    .map(({ reviewerId, reviewerName, decision }) => ({ reviewerId, reviewerName, decision }))
    .sort((a, b) => a.reviewerId.localeCompare(b.reviewerId));
}

export function filterConceptsByLatestDecision(concepts, filter) {
  if (!filter || filter === 'all') return [...concepts];
  return concepts.filter((concept) => {
    const latest = latestReviewsByReviewer(concept.reviews);
    return filter === 'pending' ? latest.length === 0 : latest.some((review) => review.decision === filter);
  });
}

export function validateConceptDescription(value) {
  return typeof value === 'string' && value.length <= MAX_DESCRIPTION_LENGTH;
}
