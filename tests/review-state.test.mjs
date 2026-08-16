import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DECISIONS,
  conceptStatus,
  createReview,
  filterConceptsByLatestDecision,
  getReviewerBadges,
  sortApprovedConcepts,
  visibleCommentReviews,
  validateConceptDescription,
} from '../src/lib/review-state.mjs';

const decisions = [
  'priority-approved',
  'schedule-approved',
  'canceled',
];

test('accepts exactly the three production decisions', () => {
  assert.deepEqual(Object.keys(DECISIONS), decisions);

  for (const decision of decisions) {
    const review = createReview({
      conceptId: 'concept-1',
      reviewerId: 'reviewer-1',
      reviewerName: 'נועה',
      decision,
    });
    assert.equal(review.decision, decision);
  }
});

test('rejects an invalid decision', () => {
  assert.throws(
    () => createReview({
      conceptId: 'concept-1',
      reviewerId: 'reviewer-1',
      reviewerName: 'נועה',
      decision: 'maybe',
    }),
    /invalid decision/i,
  );
  assert.throws(
    () => createReview({
      conceptId: 'concept-1',
      reviewerId: 'reviewer-1',
      reviewerName: 'Reviewer',
      decision: 'wait',
    }),
    /invalid decision/i,
  );
});

test('creates one distinct badge per reviewer using the latest review', () => {
  const badges = getReviewerBadges([
    { reviewerId: 'a', reviewerName: 'חוני', decision: 'wait', createdAt: '2026-08-01T08:00:00Z' },
    { reviewerId: 'b', reviewerName: 'איציק', decision: 'schedule-approved', createdAt: '2026-08-01T09:00:00Z' },
    { reviewerId: 'a', reviewerName: 'חוני', decision: 'priority-approved', createdAt: '2026-08-01T10:00:00Z' },
  ]);

  assert.deepEqual(badges, [
    { reviewerId: 'a', reviewerName: 'חוני', decision: 'priority-approved' },
    { reviewerId: 'b', reviewerName: 'איציק', decision: 'schedule-approved' },
  ]);
});

test('filters concepts by each reviewer latest decision only', () => {
  const concepts = [
    {
      id: 'one',
      reviews: [
        { reviewerId: 'a', decision: 'canceled', createdAt: '2026-08-01T08:00:00Z' },
        { reviewerId: 'a', decision: 'priority-approved', createdAt: '2026-08-01T10:00:00Z' },
      ],
    },
    {
      id: 'two',
      reviews: [{ reviewerId: 'b', decision: 'canceled', createdAt: '2026-08-01T09:00:00Z' }],
    },
    { id: 'three', reviews: [] },
  ];

  assert.deepEqual(filterConceptsByLatestDecision(concepts, 'priority-approved').map(({ id }) => id), ['one']);
  assert.deepEqual(filterConceptsByLatestDecision(concepts, 'canceled').map(({ id }) => id), ['two']);
  assert.deepEqual(filterConceptsByLatestDecision(concepts, 'pending').map(({ id }) => id), ['three']);
});

test('a reset event returns the concept to pending without becoming a fourth user decision', () => {
  const concept = {
    reviews: [
      { id: 'approved', reviewerId: 'a', decision: 'priority-approved', createdAt: '2026-08-01T08:00:00Z' },
      { id: 'reset', reviewerId: 'a', decision: 'reset', createdAt: '2026-08-01T09:00:00Z' },
    ],
  };

  assert.deepEqual(Object.keys(DECISIONS), decisions);
  assert.equal(conceptStatus(concept), 'pending');
});

test('resetting notes hides earlier comments while preserving later comments', () => {
  const comments = visibleCommentReviews([
    { id: 'old', decision: 'priority-approved', notes: 'old note', createdAt: '2026-08-01T08:00:00Z' },
    { id: 'reset', decision: 'reset', notes: '', clearPriorNotes: true, createdAt: '2026-08-01T09:00:00Z' },
    { id: 'new', decision: 'schedule-approved', notes: 'new note', createdAt: '2026-08-01T10:00:00Z' },
  ]);

  assert.deepEqual(comments.map(({ id }) => id), ['new']);
});

test('an edited comment replaces the earlier visible version without deleting history', () => {
  const comments = visibleCommentReviews([
    { id: 'original', decision: 'priority-approved', notes: 'first draft', createdAt: '2026-08-01T08:00:00Z' },
    { id: 'revision', supersedesReviewId: 'original', decision: 'priority-approved', notes: 'revised note', createdAt: '2026-08-01T09:00:00Z' },
  ]);

  assert.deepEqual(comments.map(({ id, notes }) => ({ id, notes })), [
    { id: 'revision', notes: 'revised note' },
  ]);
});

test('adding or editing a comment never changes the project decision', () => {
  const reviews = [
    { id: 'decision', reviewerId: 'management', decision: 'schedule-approved', affectsDecision: true, createdAt: '2026-08-16T10:00:00Z' },
    { id: 'comment', reviewerId: 'advisor', decision: 'canceled', notes: 'A later note', affectsDecision: false, createdAt: '2026-08-16T11:00:00Z' },
  ];

  assert.equal(conceptStatus({ reviews }), 'approved');
});

test('approved concepts sort by production speed with unassessed concepts last', () => {
  const concepts = [
    { id: 'slow', assessment: { productionSpeed: 'slow', budgetLevel: 'low' } },
    { id: 'none', assessment: null },
    { id: 'fast', assessment: { productionSpeed: 'fast', budgetLevel: 'high' } },
    { id: 'medium', assessment: { productionSpeed: 'medium', budgetLevel: 'medium' } },
  ];

  assert.deepEqual(sortApprovedConcepts(concepts, 'speed').map(({ id }) => id), ['fast', 'medium', 'slow', 'none']);
});

test('approved concepts sort by budget from low to high', () => {
  const concepts = [
    { id: 'high', assessment: { productionSpeed: 'fast', budgetLevel: 'high' } },
    { id: 'low', assessment: { productionSpeed: 'slow', budgetLevel: 'low' } },
    { id: 'medium', assessment: { productionSpeed: 'medium', budgetLevel: 'medium' } },
  ];

  assert.deepEqual(sortApprovedConcepts(concepts, 'budget').map(({ id }) => id), ['low', 'medium', 'high']);
});

test('viability prioritizes the combined fastest and cheapest estimates', () => {
  const concepts = [
    { id: 'slow-cheap', assessment: { productionSpeed: 'slow', budgetLevel: 'low' } },
    { id: 'fast-cheap', assessment: { productionSpeed: 'fast', budgetLevel: 'low' } },
    { id: 'fast-expensive', assessment: { productionSpeed: 'fast', budgetLevel: 'high' } },
    { id: 'medium-mid', assessment: { productionSpeed: 'medium', budgetLevel: 'medium' } },
    { id: 'none', assessment: null },
  ];

  assert.deepEqual(sortApprovedConcepts(concepts, 'viability').map(({ id }) => id), [
    'fast-cheap', 'fast-expensive', 'medium-mid', 'slow-cheap', 'none',
  ]);
});

test('accepts descriptions up to 500 characters and rejects longer text', () => {
  assert.equal(validateConceptDescription('א'.repeat(500)), true);
  assert.equal(validateConceptDescription('א'.repeat(501)), false);
});
