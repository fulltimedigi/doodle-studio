import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../web/js/director-v3.js';
const D=globalThis.DirectorV3;
test('focus is optional, bounded and restores full context',()=>{assert.deepEqual(D.focusAt([],1),{x:.5,y:.5,zoom:1});const f=D.focusPreset(10,.8,.2,2);assert.equal(D.focusAt(f,0).zoom,1);assert.equal(D.focusAt(f,4).zoom,2);assert.equal(D.focusAt(f,10).zoom,1);assert.throws(()=>D.focusPreset(10,2,.5,2));});
test('focus crop preserves aspect and stays inside actual media',()=>{for(const x of [0,.5,1])for(const y of [0,.5,1]){const q=D.focusCrop(1920,1080,{x,y,zoom:2.5});assert.ok(q.sx>=0&&q.sy>=0&&q.sx+q.sw<=1920&&q.sy+q.sh<=1080);assert.ok(Math.abs(q.sw/q.sh-1920/1080)<.001);}});
test('camera timing and zoom reject invalid values',()=>{assert.throws(()=>D.normalizeFocus([{t:1,x:.5,y:.5,zoom:1}],5));assert.throws(()=>D.normalizeFocus([{t:0,x:.5,y:.5,zoom:3}],5));assert.throws(()=>D.normalizeFocus([{t:0,x:.5,y:.5,zoom:1},{t:0,x:.5,y:.5,zoom:1}],5));});
test('review points include stable and late frames',()=>{const p=D.sceneGraphDemo();for(const s of p.scenes){const t=D.reviewTimes(s);assert.ok(t.every(x=>x>=0&&x<s.duration));assert.ok(t.some(x=>x>=D.graphReady(s.sceneGraph)));assert.ok(t.at(-1)>s.duration-.2);}});
test('project normalization preserves focus with older projects compatible',()=>{const p=D.normalize(D.sample);assert.deepEqual(p.scenes[0].focus,[]);p.scenes[0].layout='media';p.scenes[0].focus=D.focusPreset(10,.3,.7,2);assert.deepEqual(D.normalize(p).scenes[0].focus,p.scenes[0].focus);});

test('source picker ignores letterboxing and maps displayed pixels',()=>{const b=D.sourceFit(1600,900,400,400);assert.equal(b.y,87.5);assert.equal(D.sourcePoint(b,200,20),null);assert.deepEqual(D.sourcePoint(b,200,200),{x:.5,y:.5});assert.deepEqual(D.sourcePoint(b,400,312.5),{x:1,y:1});});
