import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/scripts/admin-app.ts',import.meta.url),'utf8');
test('restoring a banner refuses to overwrite a concurrent replacement',()=>{
 const restore=source.slice(source.indexOf("bannerRestoreButton.addEventListener('click'"));
 assert.match(restore, /updateConceptIfUnchanged\(concept\.id, \{ banner_path: concept\.banner_path \}, \{ banner_path: original \}\)/);
 assert.match(source, /runTransaction\(firestore\(\), async \(tx\) => \{/);
 assert.match(source, /Object\.entries\(expected\)\.some\(\(\[key, value\]\) => snapshot\.data\(\)\[key\] !== value\)/);
});
