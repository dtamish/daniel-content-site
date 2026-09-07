import test from 'node:test';
import assert from 'node:assert/strict';
import {CATEGORIES,CATEGORY_COLOURS,conceptCategory,groupByCategory} from '../src/lib/review-state.mjs';
import {assertCategory} from '../tools/concept-admin-core.mjs';
test('FLAGSHIP SERIES is exact independent category with distinct colour and stable grouping',()=>{
 assert.equal(CATEGORIES.filter(x=>x==='FLAGSHIP SERIES').length,1);
 assert.equal(assertCategory('FLAGSHIP SERIES'),'FLAGSHIP SERIES');
 assert.throws(()=>assertCategory('flagship series'));
 assert.equal(conceptCategory({category:'FLAGSHIP SERIES'}),'FLAGSHIP SERIES');
 assert.equal(new Set(Object.values(CATEGORY_COLOURS)).size,Object.keys(CATEGORY_COLOURS).length);
 assert.deepEqual(groupByCategory([{id:'a',category:'FLAGSHIP SERIES'},{id:'b',category:'series'}]).map(x=>[x.category,x.items[0].id]),[['FLAGSHIP SERIES','a'],['series','b']]);
});
