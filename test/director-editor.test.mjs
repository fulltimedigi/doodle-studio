import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../web/js/director-editor.js';
const E=globalThis.DirectorEditor,o={id:'x',x:.2,y:.3,w:.4,h:.3};
test('hit testing respects drawing order',()=>{assert.equal(E.hit([o,{...o,id:'y'}],.3,.4),1);assert.equal(E.hit([o],.01,.01),-1);});
test('drag is immutable, clamps to bounds and snaps',()=>{const a=E.transform(o,2,-2);assert.equal(a.x,.6);assert.equal(a.y,0);assert.equal(o.x,.2);const b=E.transform(o,.037,.012,'move',.01);assert.equal(b.x,.24);assert.equal(b.y,.31);});
test('resize anchors top left and respects minimum and bounds',()=>{const a=E.transform(o,10,-10,'resize');assert.equal(a.x,.2);assert.equal(a.w,.8);assert.equal(a.h,.06);assert.throws(()=>E.transform(o,NaN,0));});
test('render plan is independent of wall clock',()=>{const p=E.framePlan(65,30);assert.equal(p.count,1950);assert.equal(p.time(300),10);assert.equal(p.time(1949),1949/30);assert.throws(()=>p.time(1950));assert.equal(E.framePlan(1.01,24).count,25);assert.throws(()=>E.framePlan(601,30));});
