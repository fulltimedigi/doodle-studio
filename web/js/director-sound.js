/* Offline mastering, no external provider. */
(function(root){
'use strict';
const RATE=24000,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function master(voice,music,seconds,{musicGain=.18,duck=.28,rate=RATE}={}){
 if(!Number.isFinite(seconds)||seconds<=0||seconds>600||!Number.isInteger(rate)||rate<8000||rate>48000)throw Error('مدة أو معدل صوت غير صالح');
 if(!(voice instanceof Float32Array)||!(music instanceof Float32Array)||!Number.isFinite(musicGain)||!Number.isFinite(duck))throw Error('مسارات أو مستوى صوت غير صالح');
 const n=Math.round(seconds*rate),out=new Float32Array(n),block=Math.max(1,Math.round(rate*.02)),fade=Math.max(1,Math.round(rate*.35)),edge=Math.min(Math.floor(music.length/4),Math.round(rate*.035));
 musicGain=clamp(musicGain,0,.5);duck=clamp(duck,0,1);
 const peak=a=>{let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]));return m;};
 const vp=peak(voice),mp=peak(music),vg=vp?Math.min(4,.78/vp):1,mg=mp?Math.min(3,.85/mp):1;
 let env=1,overall=0;
 for(let i=0;i<n;i+=block){let power=0,k=0;for(let j=i;j<Math.min(n,voice.length,i+block*5);j++){const x=voice[j]*vg;power+=x*x;k++;}
 const target=k&&Math.sqrt(power/k)>.025?duck:1;
 for(let j=i;j<Math.min(n,i+block);j++){env+=(target-env)/(target<env?Math.max(1,rate*.025):Math.max(1,rate*.25));let m=0;if(music.length){const z=j%music.length,seam=edge?Math.min(1,z/edge,(music.length-1-z)/edge):1;m=music[z]*mg*musicGain*env*seam*Math.min(1,j/fade,(n-1-j)/fade);}out[j]=(j<voice.length?voice[j]*vg:0)+m;overall=Math.max(overall,Math.abs(out[j]));}}
 if(overall>.95){const g=.95/overall;for(let i=0;i<n;i++)out[i]*=g;}return out;
}
async function decode(blob){const ac=new OfflineAudioContext(1,1,RATE),b=await ac.decodeAudioData(await blob.arrayBuffer());if(b.duration>600)throw Error('حد المسار عشر دقائق');const out=new Float32Array(b.length);for(let k=0;k<b.numberOfChannels;k++){const ch=b.getChannelData(k);for(let i=0;i<out.length;i++)out[i]+=ch[i]/b.numberOfChannels;}return out;}
root.DirectorSound=Object.freeze({RATE,master,decode});
})(globalThis);