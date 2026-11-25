// Deterministic local MP4 rendering: one canvas PNG per exact timestamp, streamed to FFmpeg.
// Usage: node scripts/render-director.mjs project.json output.mp4 [--fps 30] [--audio mix.wav] [--size 720]
// Does not use network services or fetch project assets. Browser-attached images/videos are NOT in JSON.
import {readFile,mkdir,rename,rm,access} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import ffmpegPath from 'ffmpeg-static';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
await import('../web/js/director-v3.js');
await import('../web/js/director-editor.js');
const D=globalThis.DirectorV3,E=globalThis.DirectorEditor;
const [input,output,...args]=process.argv.slice(2);
if(!input||!output||extname(output).toLowerCase()!=='.mp4')throw Error('Usage: node scripts/render-director.mjs project.json output.mp4 [--fps 30] [--audio mix.wav] [--size 720]');
const opts={fps:30,size:1080,audio:null};
for(let i=0;i<args.length;i+=2){const [k,v]=args.slice(i,i+2);if(!v)throw Error('Missing argument '+k);if(k==='--fps')opts.fps=Number(v);else if(k==='--size')opts.size=Number(v);else if(k==='--audio')opts.audio=resolve(v);else throw Error('Unknown argument '+k);}
if(![720,1080].includes(opts.size))throw Error('Size must be 720 or 1080');
const p=D.normalize(JSON.parse(await readFile(resolve(input),'utf8')));
if(p.scenes.some(s=>s.layout==='media'))throw Error('Evidence/media scenes require a real attachment; this JSON-only renderer will not invent one. Use the browser exporter.');
if(D.review(p).some(x=>x.level==='error'))throw Error('Project has blocking quality errors');
const plan=E.framePlan(D.duration(p),opts.fps),d=D.dimensions(p.format),ratio=opts.size/1080,w=Math.round(d.w*ratio/2)*2,h=Math.round(d.h*ratio/2)*2;
const out=resolve(output),tmp=out+'.partial.mp4';
if(opts.audio){if(opts.audio===out||opts.audio===tmp)throw Error('Audio and output must differ');await access(opts.audio);}
if(resolve(input)===out||resolve(input)===tmp)throw Error('Input and output must differ');
await mkdir(dirname(out),{recursive:true});
// Do not overwrite the output or someone else's partial render.
for(const f of [out,tmp]){try{await access(f);throw Error('Output already exists: '+f);}catch(e){if(e.code!=='ENOENT')throw e;}}
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
let ff,done;
try{
 const page=await browser.newPage({viewport:{width:d.w,height:d.h}});await page.route('**/*',route=>route.abort());
 await page.setContent('<html lang="ar" dir="rtl"><body style="margin:0"><canvas></canvas></body></html>');
 const font=(await readFile(resolve(ROOT,'assets/fonts/Cairo.ttf'))).toString('base64'),logo=(await readFile(resolve(ROOT,'assets/brand/fd-logo.png'))).toString('base64');
 await page.evaluate(async ({font,logo,d,p})=>{const f=new FontFace('DirectorCairo','url(data:font/ttf;base64,'+font+')',{weight:'100 900'});await f.load();document.fonts.add(f);const im=new Image();im.src='data:image/png;base64,'+logo;await im.decode();globalThis.renderLogo=im;globalThis.renderProject=p;const c=document.querySelector('canvas');c.width=d.w;c.height=d.h;},{font,logo,d,p});
 await page.addScriptTag({content:await readFile(resolve(ROOT,'web/js/director-v3.js'),'utf8')});
 const quality=await page.evaluate(()=>{const D=DirectorV3,p=renderProject,c=document.querySelector('canvas').getContext('2d'),r=[];let t=0;for(const s of p.scenes){const x=D.frame(c,p,t+Math.min(s.duration-.45,Math.max(1.5,D.graphReady(s.sceneGraph)+.2)),new Map(),renderLogo);r.push(x);t+=s.duration;}return r;});
 if(!quality.every(x=>x.titleOK&&x.subOK&&x.artOK!==false))throw Error('Text fit failed: '+JSON.stringify(quality));
 const ffargs=['-hide_banner','-loglevel','error','-n','-f','image2pipe','-vcodec','png','-framerate',String(opts.fps),'-i','pipe:0'];
 if(opts.audio)ffargs.push('-i',opts.audio,'-map','0:v:0','-map','1:a:0','-af','apad','-c:a','aac','-b:a','192k');
 else ffargs.push('-an');
 ffargs.push('-vf','scale='+w+':'+h,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-t',String(plan.seconds),'-movflags','+faststart',tmp);
 ff=spawn(process.env.FFMPEG_PATH||ffmpegPath||'ffmpeg',ffargs,{stdio:['pipe','inherit','inherit']});
 done=new Promise((ok,bad)=>{ff.once('error',bad);ff.once('close',code=>code===0?ok():bad(Error('FFmpeg exited '+code)));});done.catch(()=>{});ff.stdin.on('error',()=>{});
 for(let k=0;k<plan.count;k++){if(ff.exitCode!==null||ff.stdin.destroyed)throw Error('Encoder closed early');
 const png=await page.evaluate(t=>{const c=document.querySelector('canvas');DirectorV3.frame(c.getContext('2d'),renderProject,t,new Map(),renderLogo);return c.toDataURL('image/png').split(',')[1];},plan.time(k));
 if(!ff.stdin.write(Buffer.from(png,'base64')))await Promise.race([once(ff.stdin,'drain'),done.then(()=>{throw Error('Encoder closed early');})]);
 if(k%opts.fps===0)process.stderr.write('\r'+k+'/'+plan.count+' frames');
 }
 ff.stdin.end();await done;await rename(tmp,out);console.log('\nRendered '+plan.count+' frames at '+opts.fps+' fps: '+out);
} catch(e){ff?.kill();if(done)await done.catch(()=>{});await rm(tmp,{force:true});throw e;} finally{await browser.close();}
