// Real integration test for a complete local checkout. No paid APIs or internet.
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import ffmpegPath from 'ffmpeg-static';
import '../web/js/director-v3.js';
import '../web/js/director-bundle.js';
import '../web/js/director-ai.js';
const D=globalThis.DirectorV3,B=globalThis.DirectorBundle,A=globalThis.DirectorAI;
const ff=process.env.FFMPEG_PATH||ffmpegPath||'ffmpeg',dir=await mkdtemp(join(tmpdir(),'director-production-'));
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});if(r.error)throw r.error;if(r.status!==0)throw Error(r.stderr||r.stdout||cmd+' failed');return r;};
const media=async (role,name,type,scene)=>({role,name,scene,blob:new Blob([await readFile(join(dir,name))],{type}),generated:false});
try{
 // Synthetic media is test footage only, never represented as actual product evidence.
 run(ff,['-v','error','-f','lavfi','-i','color=c=red:s=320x180:r=24:d=1','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libvpx-vp9','-pix_fmt','yuv420p',join(dir,'clip.webm')]);
 run(ff,['-v','error','-f','lavfi','-i','color=c=green:s=320x180','-frames:v','1','-threads','1',join(dir,'still.png')]);
 run(ff,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6:sample_rate=24000','-c:a','pcm_s16le',join(dir,'voice.wav')]);
 run(ff,['-v','error','-f','lavfi','-i','sine=frequency=220:duration=2:sample_rate=24000','-c:a','pcm_s16le',join(dir,'music.wav')]);
 const base=D.normalize({title:'اختبار محلي',format:'16:9',scenes:[{layout:'hook',duration:2,title:'اختبار الرسم',subtitle:'',transition:'cut',motionTracks:D.trackPreset('static')},{layout:'media',duration:2,title:'اختبار الفيديو',subtitle:'',transition:'cut',motionTracks:D.trackPreset('static')},{layout:'media',duration:2,title:'اختبار الصورة',subtitle:'',transition:'cut',motionTracks:D.trackPreset('static')}]});
 const items=[await media('scene','clip.webm','video/webm',1),await media('scene','still.png','image/png',2),await media('voice','voice.wav','audio/wav'),await media('music','music.wav','audio/wav')];
 const bundle=join(dir,'fixture.ftdproject'),out=join(dir,'fixture.mp4');await writeFile(bundle,Buffer.from(await B.pack(base,items,{gain:18,duck:28},A.signature(base)).arrayBuffer()));
 run(process.execPath,[fileURLToPath(new URL('render-director.mjs',import.meta.url)),bundle,out,'--fps','24','--size','720']);
 assert.ok((await stat(out)).size>1000);
 const probe=run(ff,['-hide_banner','-i',out,'-map','0:v:0','-map','0:a:0','-f','null','-']);assert.match(probe.stderr,/Video: h264/);assert.match(probe.stderr,/Audio: aac/);
 const decoded=run(ff,['-v','error','-i',out,'-map','0:v:0','-f','framemd5','-']);const frames=decoded.stdout.split('\n').filter(l=>/^\s*\d+,/.test(l));assert.equal(frames.length,144);
 console.log('Complete bundle render passed: vector + video + still + mixed audio; 144 decoded frames; H.264/AAC.');
}finally{await rm(dir,{recursive:true,force:true});}
