import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../web/js/director-v3.js';
const D=globalThis.DirectorV3;
test('framing reserves caption area and avoids box overlaps at rest',()=>{for(const format of ['16:9','9:16'])for(const framing of ['split','reverse','center'])for(const captions of [[],[{start:0,end:2,text:'نص'}]]){const {w,h}=D.dimensions(format),F=D.framing({framing,captions},format),A=F.art,boxes=[F.title,F.subtitle,[A.x,A.y,A.w,A.h]],limit=h-(captions.length?(w<h?230:175):60);for(const [x,y,bw,bh] of boxes)assert.ok(x>=0&&y>=0&&x+bw<=w&&y+bh<=limit&&bw>0&&bh>0);for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const [x,y,bw,bh]=boxes[i],[X,Y,BW,BH]=boxes[j];assert.ok(x+bw<=X||X+BW<=x||y+bh<=Y||Y+BH<=y);}}});
test('composed story auto varies framing and keeps old projects compatible',()=>{const p=D.sceneGraphDemo();assert.equal(new Set(p.scenes.map(s=>D.framing(s,p.format).style)).size,3);assert.equal(D.framing(D.normalize(D.sample).scenes[0],'16:9').style,'split');});
test('selected editorial framing survives project normalization',()=>{const p=D.normalize(D.sample);p.scenes[0].framing='reverse';assert.equal(D.normalize(p).scenes[0].framing,'reverse');});
