// Explicit local browser smoke test. No Google calls or deployment. Requires installed playwright/Chromium.
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=process.argv[2]||'output/director-check';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setContent('<html lang="ar" dir="rtl"><body style="margin:0"><canvas></canvas></body></html>');
 const font=(await readFile('assets/fonts/Cairo.ttf')).toString('base64');
 await page.evaluate(async font=>{const f=new FontFace('DirectorCairo','url(data:font/ttf;base64,'+font+')',{weight:'100 900'});await f.load();document.fonts.add(f);},font);
 await page.addScriptTag({path:'web/js/director-v3.js'});
 const report=await page.evaluate(()=>{const D=DirectorV3,c=document.querySelector('canvas'),out=[];for(const format of ['16:9','9:16']){const p=D.normalize({...D.sample,format}),d=D.dimensions(format);c.width=d.w;c.height=d.h;let t=0;for(const s of p.scenes){const r=D.frame(c.getContext('2d'),p,t+2);out.push({format,scene:s.layout,...r});t+=s.duration;}}return out;});
 assert.ok(report.every(x=>x.titleOK&&x.subOK&&x.artOK!==false),JSON.stringify(report));assert.equal(report.length,12);
 const clip=await page.evaluate(async()=>{const D=DirectorV3,c=document.querySelector('canvas');c.width=1920;c.height=1080;const p=D.normalize({...D.sample,scenes:D.sample.scenes.slice(0,2).map(s=>({...s,duration:2}))}),ctx=c.getContext('2d');const mime=D.chooseMime(m=>MediaRecorder.isTypeSupported(m),false);if(!mime)throw Error('No supported video codec');D.frame(ctx,p,0);const stream=c.captureStream(30),r=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000}),chunks=[];const done=new Promise((ok,bad)=>{r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};r.onstop=ok;r.onerror=bad});r.start();const start=performance.now();function tick(now){const t=(now-start)/1000;D.frame(ctx,p,t);if(t>=4)r.stop();else requestAnimationFrame(tick)}requestAnimationFrame(tick);await done;stream.getTracks().forEach(x=>x.stop());const blob=new Blob(chunks,{type:r.mimeType});const data=await new Promise(ok=>{const reader=new FileReader();reader.onload=()=>ok(reader.result.split(',')[1]);reader.readAsDataURL(blob)});return {mime:r.mimeType,bytes:blob.size,data};});
 assert.ok(clip.bytes>1000);assert.deepEqual(errors,[]);await writeFile(path.join(out,clip.mime.includes('mp4')?'smoke.mp4':'smoke.webm'),Buffer.from(clip.data,'base64'));console.log(JSON.stringify({report,codec:clip.mime,bytes:clip.bytes,errors},null,2));
}finally{await browser.close();}
