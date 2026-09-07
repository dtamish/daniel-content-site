import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/components/ReviewApp.astro',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles/room.css',import.meta.url),'utf8');
const labels=readFileSync(new URL('../src/scripts/compact-header.js',import.meta.url),'utf8');
test('Grid/List use matching decorative SVGs and accessible initial labels',()=>{
 for(const mode of ['grid','list']){
  const button=source.match(new RegExp(`<button[^>]*data-view="${mode}"[^>]*>[\\s\\S]*?</button>`))?.[0];
  assert.ok(button);assert.match(button,/aria-label=/);assert.match(button,/title=/);assert.match(button,/aria-pressed=/);
  assert.match(button,/<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"/);assert.match(button,/stroke-width="1.8"/);assert.doesNotMatch(button,/[▦☷]/);
 }
 assert.match(labels,/e\.title=label/);
});
test('Symmetric neutral-gray touch targets and keyboard focus are scoped to view pair',()=>{
 assert.match(css,/\.catalogue-view-buttons button\{[^}]*justify-content:center;[^}]*flex:0 0 44px;width:44px;height:44px/);
 assert.match(css,/\.catalogue-view-buttons button\.is-active\{background:#454545;border-color:#999;color:#fff\}/);
 assert.match(css,/\.catalogue-view-buttons button:focus-visible\{outline:2px solid #fff/);
});
