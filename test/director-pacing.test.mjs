import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../web/js/director-v3.js';
import '../web/js/director-ai.js';
const D=globalThis.DirectorV3,A=globalThis.DirectorAI;
test('silent reading mode extends a rushed scene and preserves long scenes',()=>{const p=D.normalize(D.sample);p.scenes[0].duration=2;p.scenes[1].duration=35;const q=D.paced(p,'silent');assert.ok(q.scenes[0].duration>=8);assert.ok(q.scenes[1].duration>=35);assert.ok(q.scenes.every((s,i)=>s.duration>=p.scenes[i].duration));});
test('more text needs more time and silent is slower',()=>{const a={layout:'hook',title:'عنوان',subtitle:'',labels:[]},b={...a,subtitle:'هذه جملة طويلة جدًا '.repeat(8)};assert.ok(D.readingSeconds(b,'silent')>D.readingSeconds(a,'silent'));assert.ok(D.readingSeconds(b,'silent')>D.readingSeconds(b,'quick'));});
test('audio never shortens any scene, long voice extends',()=>{const p=D.normalize(D.sample);const q=A.audioTimeline(p,[24000,24000,24000,24000,24000,480000]);assert.ok(q.project.scenes.every((s,i)=>s.duration>=p.scenes[i].duration));assert.ok(q.project.scenes[5].duration>=21.1);});
test('quality flags a two second reading scene',()=>{const p=D.normalize(D.sample);p.scenes[0].duration=2;assert.ok(D.review(p).some(x=>x.text.includes('القراءة تحتاج')));});
