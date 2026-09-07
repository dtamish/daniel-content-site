import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/scripts/review-app.ts',import.meta.url),'utf8');
const cards=app.slice(app.indexOf('  function renderCards('),app.indexOf('  /**',app.indexOf('  function renderCards(')));
test('all cards append comparison footer after original content and actions',()=>{
 assert.ok(cards.indexOf('article.append(card)')<cards.indexOf('article.append(footer)'));
 assert.ok(cards.indexOf('article.append(actions)')<cards.indexOf('article.append(footer)'));
 assert.match(cards,/footer.classList.add\('card-assessment-footer'\)/);
 assert.doesNotMatch(cards,/article.append\(renderAssessment/);
});
test('category display removed only from card chips, not editor or reader',()=>{
 assert.match(app,/function renderAssessmentChips\(concept: Concept, includeCategory = true\)/);
 assert.match(app,/if \(includeCategory\) chips.append\(categoryChip\)/);
 assert.match(app,/renderAssessmentChips\(concept, false\)/);
 assert.match(app,/category.name = 'category'/);
 assert.match(cards,/strings.categories\[conceptCategory/);
});
