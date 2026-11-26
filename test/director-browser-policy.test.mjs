import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../web/js/director-v3.js';
const D=globalThis.DirectorV3;
test('export never guesses the codec of unspecified MP4',()=>{assert.equal(D.chooseMime(m=>m==='video/mp4',true),null);assert.equal(D.chooseMime(m=>m==='video/mp4;codecs=avc1.420034',false),'video/mp4;codecs=avc1.420034');assert.equal(D.chooseMime(m=>m==='video/webm;codecs=vp9,opus',true),'video/webm;codecs=vp9,opus');});
test('all fallback art reports fit result',()=>{const c=new Proxy({measureText:s=>({width:s.length*25}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});let t=0;const p=D.normalize(D.sample);for(const s of p.scenes){assert.equal(typeof D.frame(c,p,t+2).artOK,'boolean');t+=s.duration;}});
