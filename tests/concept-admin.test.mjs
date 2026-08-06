import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDeleteConfirmation,
  assertDecision,
  parseConceptManifest,
  resolveActingEditor,
} from '../tools/concept-admin-core.mjs';

test('manifest parsing rejects a concept without both private assets', () => {
  assert.throws(
    () => parseConceptManifest({ items: [{ title: 'חסר PDF', banner: 'banners/item.png' }] }),
    /PDF/i,
  );
});

test('manifest parsing creates an immutable import plan from a valid item', () => {
  const plan = parseConceptManifest({
    concept_count: 1,
    items: [{
      title: 'קונספט לדוגמה',
      description_draft: 'תיאור קצר',
      priority: 7,
      banner: 'banners/example.png',
      pdf: 'pdf/example.pdf',
    }],
  });

  assert.deepEqual(plan, [{
    title: 'קונספט לדוגמה',
    description: 'תיאור קצר',
    priority: 7,
    banner: 'banners/example.png',
    pdf: 'pdf/example.pdf',
  }]);
});

test('acting editor selection refuses ambiguity instead of attributing changes to the wrong person', () => {
  assert.throws(
    () => resolveActingEditor([
      { id: 'editor-one', is_editor: true, approved: true },
      { id: 'editor-two', is_editor: true, approved: true },
    ]),
    /CONCEPT_ADMIN_CREATED_BY/i,
  );
  assert.equal(
    resolveActingEditor([{ id: 'editor-one', is_editor: true, approved: true }]),
    'editor-one',
  );
});

test('agent accepts only the four production decisions', () => {
  assert.equal(assertDecision('priority-approved'), 'priority-approved');
  assert.equal(assertDecision('schedule-approved'), 'schedule-approved');
  assert.equal(assertDecision('wait'), 'wait');
  assert.equal(assertDecision('canceled'), 'canceled');
  assert.throws(() => assertDecision('publish-now'), /decision/i);
});

test('deletion requires repeating the exact target id', () => {
  assert.throws(() => assertDeleteConfirmation('concept-123', 'other-concept'), /אימות/i);
  assert.doesNotThrow(() => assertDeleteConfirmation('concept-123', 'concept-123'));
});
