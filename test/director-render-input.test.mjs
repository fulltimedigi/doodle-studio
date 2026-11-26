import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mediaRange,readProject,targetTime} from '../src/director-render-input.mjs';
import '../web/js/director-v3.js';
import '../web/js/director-bundle.js';
import '../web/js/director-ai.js';
const D=globalThis.DirectorV3,B=globalThis.DirectorBundle,A=globalThis.DirectorAI;
test('bounded HTTP ranges and suffixes',()=>{assert.deepEqual(mediaRange(100),{status:200,start:0,end:99});assert.deepEqual(mediaRange(100,'bytes=25-'),{status:206,start:25,end:99});assert.deepEqual(mediaRange(100,'bytes=-20'),{status:206,start:80,end:99});assert.deepEqual(mediaRange(100,'bytes=0-500'),{status:206,start:0,end:99});for(const s of ['bytes=100-','bytes=20-10','bytes=-0','bytes=0-1,4-5','bytes=-'])assert.equal(mediaRange(100,s).status,416);});
test('video timing holds at end',()=>{assert.equal(targetTime(3,2),1.95);assert.equal(targetTime(-1,2),0);assert.equal(targetTime(0,.01),0);assert.throws(()=>targetTime(1,NaN));});
test('bundle reader rejects stale voice and missing real media',async()=>{const p=D.normalize(D.sample);p.scenes.forEach(s=>s.production='local');p.scenes[0].layout='media';await assert.rejects(()=>readProject(new Blob([JSON.stringify(p)]),'.json',D,B,A));const media={role:'scene',scene:0,name:'clip.webm',generated:false,blob:new Blob(['test'],{type:'video/webm'})};const q=await readProject(B.pack(p,[media],{gain:18,duck:28}),'.ftdproject',D,B,A,{allowDraft:true});assert.equal(q.items.length,1);await assert.rejects(()=>readProject(B.pack(p,[{...media,generated:true}],{gain:18,duck:28}),'.ftdproject',D,B,A));const voice={role:'voice',name:'voice.wav',blob:new Blob(['test'],{type:'audio/wav'})};await assert.rejects(()=>readProject(B.pack(p,[media,voice],{gain:18,duck:28},'stale'),'.ftdproject',D,B,A));});

test('strict renderer rejects incomplete cinema but permits explicit draft',async()=>{const p=A.enrich(D.sample);p.scenes.forEach(s=>{s.layout='hook';s.production='local';s.narration='';});p.scenes[0].production='cinema';const blob=new Blob([JSON.stringify(p)]);await assert.rejects(()=>readProject(blob,'.json',D,B,A));const q=await readProject(blob,'.json',D,B,A,{allowDraft:true});assert.equal(q.readiness.ready,false);assert.deepEqual(q.readiness.missingCinema,[0]);});
