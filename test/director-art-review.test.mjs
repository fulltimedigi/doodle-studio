import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../web/js/director-v3.js';
const D=globalThis.DirectorV3;
test('reviewed story uses distinct purposeful graphics without decorative desks',()=>{const p=D.sceneGraphDemo();assert.ok(p.scenes.every(s=>!s.sceneGraph.objects.some(o=>o.kind==='desk')));const [before,after]=p.scenes[2].sceneGraph.objects;assert.equal(before.pose,'think');assert.equal(after.pose,'approve');assert.ok(before.x>after.x);assert.equal(p.scenes[3].sceneGraph.objects[0].pose,'point');});
