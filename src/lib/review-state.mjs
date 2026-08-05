export const DECISIONS = Object.freeze({
  'priority-approved': 'מאושר להפקה ולקדם במיידי',
  'schedule-approved': 'מאושר להפקה בסדר לוח השידורים',
  wait: 'להמתין עם זה',
  canceled: 'לא מאושר להפקה — לבטל רעיון',
});

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
