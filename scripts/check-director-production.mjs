// Real integration test for a complete local checkout. No paid APIs or internet.
import {mkdtemp,readFile,writeFile,rm,stat,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import ffmpegPath from 'ffmpeg-static';
import '../web/js/director-v3.js';
import '../web/js/director-bundle.js';
import '../web/js/director-ai.js';
const D=globalThis.DirectorV3,B=globalThis.DirectorBundle,A=globalThis.DirectorAI;
const ff=process.env.FFMPEG_PATH||ffmpegPath||'ffmpeg',dir=await mkdtemp(join(tmpdir(),'director-production-'));
const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000,...options});if(r.error)throw r.error;if(r.status!==0)throw Error(r.stderr||r.stdout||cmd+' failed');return r;};
const media=async (role,name,type,scene)=>({role,name,scene,blob:new Blob([await readFile(join(dir,name))],{type}),generated:false});
try{
 // Synthetic media is test footage only, never represented as actual product evidence.
 run(ff,['-v','error','-f','lavfi','-i','color=c=red:s=320x180:r=24:d=1','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libvpx-vp9','-pix_fmt','yuv420p',join(dir,'clip.webm')]);
 run(ff,['-v','error','-f','lavfi','-i','color=c=green:s=320x180','-frames:v','1','-threads','1',join(dir,'still.png')]);
 run(ff,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6:sample_rate=24000','-c:a','pcm_s16le',join(dir,'voice.wav')]);
 run(ff,['-v','error','-f','lavfi','-i','sine=frequency=220:duration=2:sample_rate=24000','-c:a','pcm_s16le',join(dir,'music.wav')]);
 const base=D.normalize({title:'اختبار محلي',format:'16:9',scenes:[{layout:'hook',production:'local',duration:2,title:'اختبار الرسم',subtitle:'',transition:'cut',motionTracks:D.trackPreset('static')},{layout:'media',duration:2,title:'اختبار الفيديو',subtitle:'',transition:'cut',motionTracks:D.trackPreset('static')},{layout:'media',duration:2,title:'اختبار الصورة',subtitle:'',transition:'cut',motionTracks:D.trackPreset('static')}]});
 const items=[await media('scene','clip.webm','video/webm',1),await media('scene','still.png','image/png',2),await media('voice','voice.wav','audio/wav'),await media('music','music.wav','audio/wav')];
 const artifactDir=process.argv[2]?resolve(process.argv[2]):dir;
 await mkdir(artifactDir,{recursive:true});
 const combinations=[
  ['16:9',1920,1080,24],
  ['16:9',1920,1080,30],
  ['9:16',1080,1920,24],
  ['9:16',1080,1920,30],
 ];
 for(const [format,width,height,fps] of combinations){
  const label=`${width}x${height}-${fps}`;
  const project=D.normalize({...base,format});
  const bundle=join(dir,label+'.ftdproject'),out=join(artifactDir,label+'.mp4');
  await writeFile(bundle,Buffer.from(await B.pack(project,items,{gain:18,duck:28},A.signature(project)).arrayBuffer()));
  run(process.execPath,[fileURLToPath(new URL('render-director.mjs',import.meta.url)),bundle,out,'--fps',String(fps),'--size','1080']);
  assert.ok((await stat(out)).size>1000);
  const probe=JSON.parse(run(process.env.FFPROBE_PATH||'ffprobe',[
   '-v','error','-count_frames','-show_streams','-of','json',out
  ]).stdout);
  const video=probe.streams.find(s=>s.codec_type==='video');
  const audio=probe.streams.find(s=>s.codec_type==='audio');
  assert.ok(video&&audio,'expected one video and one audio stream');
  assert.deepEqual([video.codec_name,video.width,video.height,video.avg_frame_rate,Number(video.nb_read_frames)],['h264',width,height,fps+'/1',fps*6]);
  assert.equal(audio.codec_name,'aac');
  assert.ok(Math.abs(Number(video.duration)-6)<=1/fps);
  assert.ok(Math.abs(Number(audio.duration)-Number(video.duration))<=1/fps);
  assert.ok(Math.abs(Number(audio.start_time)-Number(video.start_time))<=1/fps);
  const black=run(ff,['-hide_banner','-i',out,'-map','0:v:0','-vf','blackdetect=d=0:pic_th=0.99','-f','null','-']);
  assert.doesNotMatch(black.stderr,/black_start:/);
  for(const [second,channel] of [[2.5,0],[3.5,2],[5,1]]){
   const pixel=run(ff,[
    '-v','error','-ss',String(second),'-i',out,'-vf','crop=2:2,scale=1:1',
    '-frames:v','1','-threads','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'
   ],{encoding:'buffer'}).stdout;
   assert.ok(pixel.length===3&&pixel[channel]>pixel[(channel+1)%3]+70&&pixel[channel]>pixel[(channel+2)%3]+70,
    label+' unexpected content at '+second+'s: '+Array.from(pixel));
  }
  if(artifactDir!==dir){
   for(const second of [1,3,5]){
    run(ff,['-v','error','-ss',String(second),'-i',out,'-frames:v','1','-threads','1',join(artifactDir,label+'-'+second+'s.png')]);
   }
  }
  console.log(`${label}: H.264/AAC; ${video.nb_read_frames} decoded frames; video ${video.duration}s, audio ${audio.duration}s; no black frames.`);
 }
}finally{await rm(dir,{recursive:true,force:true});}
