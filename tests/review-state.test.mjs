import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DECISIONS,
  canManageOwnComment,
  canWriteComment,
  conceptStatus,
  countByStatus,
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

test('a withdrawn comment leaves the thread while both rows stay in the history', () => {
  const history = [
    { id: 'original', reviewerId: 'author', decision: 'priority-approved', notes: 'please reconsider the runtime', affectsDecision: true, createdAt: '2026-08-01T08:00:00Z' },
    { id: 'tombstone', reviewerId: 'author', supersedesReviewId: 'original', decision: 'priority-approved', notes: '', affectsDecision: false, createdAt: '2026-08-01T09:00:00Z' },
  ];

  assert.deepEqual(visibleCommentReviews(history), []);
  // The delete is an added row, not a removal: nothing was dropped from the record.
  assert.equal(history.length, 2);
  assert.equal(history[0].notes, 'please reconsider the runtime');
});

test('withdrawing a comment never changes the project decision', () => {
  const reviews = [
    { id: 'decision', reviewerId: 'management', decision: 'schedule-approved', affectsDecision: true, createdAt: '2026-08-16T10:00:00Z' },
    { id: 'comment', reviewerId: 'advisor', decision: 'canceled', notes: 'A later note', affectsDecision: false, createdAt: '2026-08-16T11:00:00Z' },
    { id: 'withdrawn', reviewerId: 'advisor', supersedesReviewId: 'comment', decision: 'canceled', notes: '', affectsDecision: false, createdAt: '2026-08-16T12:00:00Z' },
  ];

  assert.equal(conceptStatus({ reviews }), 'approved');
  assert.deepEqual(visibleCommentReviews(reviews), []);
});

test('withdrawing one comment leaves every other author untouched', () => {
  const reviews = [
    { id: 'mine', reviewerId: 'advisor', decision: 'canceled', notes: 'my note', affectsDecision: false, createdAt: '2026-08-16T10:00:00Z' },
    { id: 'theirs', reviewerId: 'management', decision: 'schedule-approved', notes: 'their note', affectsDecision: true, createdAt: '2026-08-16T11:00:00Z' },
    { id: 'withdrawn', reviewerId: 'advisor', supersedesReviewId: 'mine', decision: 'canceled', notes: '', affectsDecision: false, createdAt: '2026-08-16T12:00:00Z' },
  ];

  assert.deepEqual(visibleCommentReviews(reviews).map(({ id }) => id), ['theirs']);
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

// --------------------------------------------- own comments after a reset to Pending
// A reset that keeps the notes returns the concept to Pending while the author's own
// comment stays on the thread. The author must keep the controls on that retained
// comment: it is still theirs and still visible. Concept status is not a factor.

const retainedAfterReset = [
  { id: 'decision', reviewerId: 'management', decision: 'schedule-approved', notes: 'approving this', affectsDecision: true, createdAt: '2026-09-01T10:00:00Z' },
  { id: 'mine', reviewerId: 'advisor', isOwn: true, decision: 'schedule-approved', notes: 'my note on the runtime', affectsDecision: false, createdAt: '2026-09-01T11:00:00Z' },
  { id: 'reset', reviewerId: 'management', decision: 'reset', notes: '', affectsDecision: true, clearPriorNotes: false, createdAt: '2026-09-01T12:00:00Z' },
];

test('a reset that keeps notes returns the concept to Pending with the comments retained', () => {
  assert.equal(conceptStatus({ reviews: retainedAfterReset }), 'pending');
  assert.deepEqual(visibleCommentReviews(retainedAfterReset).map(({ id }) => id), ['decision', 'mine']);
});

test('the author keeps edit and withdraw on a comment retained into Pending', () => {
  const [, mine] = retainedAfterReset;
  assert.equal(conceptStatus({ reviews: retainedAfterReset }), 'pending');
  assert.equal(canManageOwnComment(mine), true);
});

test('a comment by another author is never manageable, in any status', () => {
  const [theirs] = retainedAfterReset;
  for (const reviews of [retainedAfterReset, retainedAfterReset.slice(0, 2)]) {
    assert.equal(canManageOwnComment(theirs), false, conceptStatus({ reviews }));
  }
  assert.equal(canManageOwnComment({ id: 'x', isOwn: false }), false);
  // isOwn is the backend's answer about authorship; a row with no id cannot be superseded.
  assert.equal(canManageOwnComment({ isOwn: true }), false);
  assert.equal(canManageOwnComment(null), false);
});

test('revising a retained comment opens the box without granting a new comment in Pending', () => {
  // No decision staged and nothing being revised: Pending still refuses a new comment.
  assert.equal(canWriteComment({ status: 'pending' }), false);
  // Revising the author's own retained comment opens the box for that revision alone.
  assert.equal(canWriteComment({ status: 'pending', editingReviewId: 'mine' }), true);
  // Once the revision is saved the box closes again: no standing new-comment permission.
  assert.equal(canWriteComment({ status: 'pending', editingReviewId: null }), false);
  // The existing gates are unchanged: a staged decision opens it, and so does any
  // concept that has left Pending.
  assert.equal(canWriteComment({ status: 'pending', pendingDecision: 'canceled' }), true);
  assert.equal(canWriteComment({ status: 'approved' }), true);
  assert.equal(canWriteComment({ status: 'rejected' }), true);
  // The gate fails closed: an unrecognised or absent status is treated as Pending.
  assert.equal(canWriteComment(), false);
  assert.equal(canWriteComment({}), false);
});

test('a revision of a comment retained into Pending leaves the concept in Pending', () => {
  const revised = [
    ...retainedAfterReset,
    { id: 'revision', reviewerId: 'advisor', isOwn: true, supersedesReviewId: 'mine', decision: 'schedule-approved', notes: 'my revised note', affectsDecision: false, createdAt: '2026-09-01T13:00:00Z' },
  ];

  // The revision repeats the decision its comment was attached to, but carries no
  // decision weight, so the concept does not leave Pending and the tab counts hold.
  assert.equal(conceptStatus({ reviews: revised }), 'pending');
  assert.deepEqual(countByStatus([{ reviews: revised }]), { pending: 1, approved: 0, rejected: 0 });
  assert.deepEqual(visibleCommentReviews(revised).map(({ id }) => id), ['decision', 'revision']);
  // Nothing was removed: the superseded row is still on record.
  assert.equal(revised.length, 4);
  assert.equal(revised[1].notes, 'my note on the runtime');
});

test('withdrawing a comment retained into Pending leaves the concept in Pending', () => {
  const withdrawn = [
    ...retainedAfterReset,
    { id: 'tombstone', reviewerId: 'advisor', isOwn: true, supersedesReviewId: 'mine', decision: 'schedule-approved', notes: '', affectsDecision: false, createdAt: '2026-09-01T13:00:00Z' },
  ];

  assert.equal(conceptStatus({ reviews: withdrawn }), 'pending');
  assert.deepEqual(countByStatus([{ reviews: withdrawn }]), { pending: 1, approved: 0, rejected: 0 });
  // The author's comment leaves the thread; the other author's comment survives.
  assert.deepEqual(visibleCommentReviews(withdrawn).map(({ id }) => id), ['decision']);
  assert.equal(withdrawn.length, 4);
});
