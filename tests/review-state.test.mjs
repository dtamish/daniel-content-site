import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DECISIONS,
  createReview,
  filterConceptsByLatestDecision,
  getReviewerBadges,
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

test('accepts descriptions up to 500 characters and rejects longer text', () => {
  assert.equal(validateConceptDescription('א'.repeat(500)), true);
  assert.equal(validateConceptDescription('א'.repeat(501)), false);
});
