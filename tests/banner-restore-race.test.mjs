import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/scripts/admin-app.ts',import.meta.url),'utf8');
test('restoring a banner refuses to overwrite a concurrent replacement',()=>{
 const restore=source.slice(source.indexOf("bannerRestoreButton.addEventListener('click'"));
 assert.match(restore,/\.update\(\{ banner_path: original \}\)[\s\S]*?\.eq\('id', concept.id\)[\s\S]*?\.eq\('banner_path', concept.banner_path\)[\s\S]*?\.maybeSingle\(\)/);
 assert.match(restore,/if \(!data\) throw new Error/);
});
