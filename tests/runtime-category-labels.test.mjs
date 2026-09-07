import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('runtime category display labels preserve canonical category keys in both locales', () => {
 const s=readFileSync(new URL('../src/lib/i18n.ts',import.meta.url),'utf8');
 for(const expected of ["'film-long': 'Long film (30 min)'", "digital: 'Digital film (7 min)'", "'film-long': 'סרט ארוך (30 דקות)'", "digital: 'סרט דיגיטל (7 דק׳)'", "'film-short': 'Short film'", "film: 'Film'"]) assert.ok(s.includes(expected),expected);
});
