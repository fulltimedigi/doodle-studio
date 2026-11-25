// Deterministic local MP4 rendering: one canvas PNG per exact timestamp, streamed to FFmpeg.
// Usage: node scripts/render-director.mjs project.json output.mp4 [--fps 30] [--audio mix.wav] [--size 720]
// Accepts complete .ftdproject bundles or procedural JSON; no external network.
import {readFile,writeFile,mkdir,mkdtemp,link,rm,access,stat} from 'node:fs/promises';
import {resolve,dirname,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import {readProject,targetTime} from '../src/director-render-input.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
await import('../web/js/director-v3.js');
await import('../web/js/director-editor.js');
for(const f of ['director-bundle','director-ai','director-sound'])await import('../web/js/'+f+'.js');
const D=globalThis.DirectorV3,E=globalThis.DirectorEditor,B=globalThis.DirectorBundle,A=globalThis.DirectorAI;
const [input,output,...args]=process.argv.slice(2);
if(!input||!output||extname(output).toLowerCase()!=='.mp4')throw Error('Usage: node scripts/render-director.mjs project.json output.mp4 [--fps 30] [--audio mix.wav] [--size 720]');
const opts={fps:30,size:1080,audio:null};
for(let i=0;i<args.length;i+=2){const [k,v]=args.slice(i,i+2);if(!v)throw Error('Missing argument '+k);if(k==='--fps')opts.fps=Number(v);else if(k==='--size')opts.size=Number(v);else if(k==='--audio')opts.audio=resolve(v);else throw Error('Unknown argument '+k);}
if(![720,1080].includes(opts.size))throw Error('Size must be 720 or 1080');
const source=resolve(input);if((await stat(source)).size>B.MAX+2*1024*1024+32)throw Error('Project too large');
const {project:p,items,mix,issues}=await readProject(new Blob([await readFile(source)]),extname(source).toLowerCase(),D,B,A);
if(issues.length)console.warn('Project warnings:',issues.map(x=>x.text).join('; '));
const plan=E.framePlan(D.duration(p),opts.fps),d=D.dimensions(p.format),ratio=opts.size/1080,w=Math.round(d.w*ratio/2)*2,h=Math.round(d.h*ratio/2)*2;
const out=resolve(output);
if(source===out||opts.audio===out)throw Error('Input and output must differ');
if(opts.audio){if(extname(opts.audio).toLowerCase()!=='.wav')throw Error('Audio override must be WAV');await access(opts.audio);if((await stat(opts.audio)).size>100*1024*1024)throw Error('Audio too large');}
await mkdir(dirname(out),{recursive:true});
try{await access(out);throw Error('Output already exists: '+out);}catch(e){if(e.code!=='ENOENT')throw e;}
const work=await mkdtemp(join(dirname(out),'.director-render-')),tmp=join(work,'film.mp4');
let browser,ff,done;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:d.w,height:d.h}});
 // Transfer bounded chunks through the local Playwright channel, then create browser-owned Blob URLs.
 // No HTTP navigation, server, or network media requests are required.
 await page.route('**/*',route=>route.abort());
 await page.setContent('<!doctype html><html lang="ar" dir="rtl"><body style="margin:0"><canvas></canvas></body></html>');
 const refs=[];
 async function attach(bytes,type){
  await page.evaluate(()=>{globalThis.directorParts=[];});
  for(let offset=0;offset<bytes.length;offset+=512*1024){
   await page.evaluate(data=>{const s=atob(data),a=new Uint8Array(s.length);for(let k=0;k<s.length;k++)a[k]=s.charCodeAt(k);directorParts.push(a);},bytes.subarray(offset,offset+512*1024).toString('base64'));
  }
  return page.evaluate(type=>{const url=URL.createObjectURL(new Blob(directorParts,{type}));directorParts=[];return url;},type);
 }
 for(const a of items){const url=await attach(Buffer.from(await a.blob.arrayBuffer()),a.type);refs.push({role:a.role,scene:a.scene,generated:a.generated===true,type:a.type,url});}
 if(opts.audio){const url=await attach(await readFile(opts.audio),'audio/wav');refs.push({role:'override',url});}
 await page.addScriptTag({content:'globalThis.directorTargetTime='+targetTime.toString()+';'});
 const font=(await readFile(resolve(ROOT,'assets/fonts/Cairo.ttf'))).toString('base64'),logo=(await readFile(resolve(ROOT,'assets/brand/fd-logo.png'))).toString('base64');
 await page.evaluate(async ({font,logo,d,p})=>{const f=new FontFace('DirectorCairo','url(data:font/ttf;base64,'+font+')',{weight:'100 900'});await f.load();document.fonts.add(f);const im=new Image();im.src='data:image/png;base64,'+logo;await im.decode();globalThis.renderLogo=im;globalThis.renderProject=p;const c=document.querySelector('canvas');c.width=d.w;c.height=d.h;},{font,logo,d,p});
 await page.addScriptTag({content:await readFile(resolve(ROOT,'web/js/director-v3.js'),'utf8')});
 for(const f of ['director-ai','director-sound'])await page.addScriptTag({content:await readFile(resolve(ROOT,'web/js/'+f+'.js'),'utf8')});
 await page.evaluate(async refs=>{globalThis.renderAssets=new Map();
 for(const a of refs.filter(x=>x.role==='scene')){const video=a.type.startsWith('video/'),node=document.createElement(video?'video':'img');if(video){node.muted=true;node.preload='auto';node.playsInline=true;}
 await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('Media load timeout: '+a.scene)),20000);const end=fn=>()=>{clearTimeout(timer);fn();};node.addEventListener(video?'loadeddata':'load',end(ok),{once:true});node.addEventListener('error',end(()=>bad(Error('Media decode failed: '+a.scene))),{once:true});node.src=a.url;});
 if(video&&(!Number.isFinite(node.duration)||node.duration<=0))throw Error('Invalid video duration');renderAssets.set(a.scene,{node,kind:video?'video':'image',generated:a.generated});}
 globalThis.renderAt=async t=>{const D=DirectorV3,v=D.locate(renderProject,t),a=renderAssets.get(v.i);
 if(a?.kind==='video'){const node=a.node,at=directorTargetTime(v.local,node.duration);if(Math.abs(node.currentTime-at)>.0001||node.seeking){await new Promise((ok,bad)=>{const finish=err=>{clearTimeout(timer);node.removeEventListener('seeked',onSeek);node.removeEventListener('error',onError);err?bad(err):ok();},onSeek=()=>finish(),onError=()=>finish(Error('Video seek failed')),timer=setTimeout(()=>finish(Error('Video seek timed out')),15000);node.addEventListener('seeked',onSeek);node.addEventListener('error',onError);node.currentTime=at;});}}
 return D.frame(document.querySelector('canvas').getContext('2d'),renderProject,t,renderAssets,renderLogo);};
 },refs);
 const quality=await page.evaluate(async()=>{const D=DirectorV3,p=renderProject,r=[];let t=0;for(const s of p.scenes){const result=await renderAt(t+Math.min(s.duration-.45,Math.max(1.5,D.graphReady(s.sceneGraph)+.2,D.finalHold(s).start+.1)));const canvas=document.querySelector('canvas');result.captionOK=D.captionCheck(canvas.getContext('2d'),s,canvas.width,canvas.height)&&result.captionOK!==false;r.push(result);t+=s.duration;}return r;});
 if(!quality.every(x=>x.titleOK&&x.subOK&&x.artOK!==false&&x.captionOK!==false))throw Error('Text fit failed: '+JSON.stringify(quality));
 let audio=null;
 if(refs.some(x=>['voice','music','override'].includes(x.role))){
 const bytes=await page.evaluate(async ({refs,mix,seconds})=>{const S=DirectorSound,A=DirectorAI,load=async role=>{const a=refs.find(x=>x.role===role);if(!a)return new Float32Array(0);const r=await fetch(a.url);if(!r.ok)throw Error('Cannot read local audio');return S.decode(await r.blob());};const override=refs.some(x=>x.role==='override');const v=await load(override?'override':'voice'),m=override?new Float32Array(0):await load('music');
 if(v.length&&Math.abs(v.length/S.RATE-seconds)>.5)throw Error('Narration/mix duration does not match project');const pcm=m.length?S.master(v,m,seconds,{musicGain:mix.gain/100,duck:mix.duck/100}):v;
 return new Promise((ok,bad)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result.split(',')[1]);reader.onerror=bad;reader.readAsDataURL(new Blob([A.wav(pcm,S.RATE)],{type:'audio/wav'}));});},{refs,mix,seconds:D.duration(p)});
 audio=join(work,'audio.wav');await writeFile(audio,Buffer.from(bytes,'base64'));
 }
 const ffargs=['-hide_banner','-loglevel','error','-n','-f','image2pipe','-vcodec','png','-framerate',String(opts.fps),'-i','pipe:0'];
 if(audio)ffargs.push('-i',audio,'-map','0:v:0','-map','1:a:0','-af','apad','-c:a','aac','-b:a','192k');
 else ffargs.push('-an');
 ffargs.push('-vf','scale='+w+':'+h,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-frames:v',String(plan.count),'-t',String(plan.seconds),'-movflags','+faststart',tmp);
 ff=spawn(process.env.FFMPEG_PATH||ffmpegPath||'ffmpeg',ffargs,{stdio:['pipe','inherit','inherit']});
 done=new Promise((ok,bad)=>{ff.once('error',bad);ff.once('close',code=>code===0?ok():bad(Error('FFmpeg exited '+code)));});done.catch(()=>{});ff.stdin.on('error',()=>{});
 for(let k=0;k<plan.count;k++){if(ff.exitCode!==null||ff.stdin.destroyed)throw Error('Encoder closed early');
 const png=await page.evaluate(async t=>{await renderAt(t);return document.querySelector('canvas').toDataURL('image/png').split(',')[1];},plan.time(k));
 if(!ff.stdin.write(Buffer.from(png,'base64')))await Promise.race([once(ff.stdin,'drain'),done.then(()=>{throw Error('Encoder closed early');})]);
 if(k%opts.fps===0)process.stderr.write('\r'+k+'/'+plan.count+' frames');
 }
 ff.stdin.end();await done;await link(tmp,out);console.log('\nRendered '+plan.count+' frames at '+opts.fps+' fps: '+out);
} finally{if(ff&&ff.exitCode===null&&ff.signalCode===null)ff.kill();if(done)await done.catch(()=>{});if(browser)await browser.close();await rm(work,{recursive:true,force:true});}
