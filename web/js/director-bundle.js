/* Portable local project: versioned manifest followed by raw binary media.
   No compression, remote URLs, credentials, executable code or decompression expansion. */
(function(root){
'use strict';
const MAGIC='FTDPROJECT1\n',MAX=300*1024*1024,MANIFEST_MAX=2*1024*1024;
function validate(m){
 if(!m||m.version!==1||!m.project||!Array.isArray(m.project.scenes)||!Array.isArray(m.media)||m.media.length>32)throw Error('صيغة مشروع غير مدعومة');
 const seen=new Set();let total=0;
 for(const a of m.media){
  if(!a||!['scene','voice','music'].includes(a.role)||typeof a.name!=='string'||a.name.length>200||!Number.isInteger(a.size)||a.size<=0||a.size>200*1024*1024)throw Error('بيانات وسائط غير صالحة');
  const key=a.role==='scene'?'scene:'+a.scene:a.role;if(seen.has(key))throw Error('وسائط مكررة');seen.add(key);
  if(a.role==='scene'){if(!Number.isInteger(a.scene)||a.scene<0||a.scene>=m.project.scenes.length||!/^image\/(png|jpeg|webp)$|^video\/(mp4|webm)$/.test(a.type))throw Error('وسائط مشهد غير صالحة');}
  else if(!/^audio\/[a-zA-Z0-9.+-]+$/.test(a.type)||a.size>100*1024*1024)throw Error('صوت غير صالح');
  if(a.cinemaSignature!=null&&(a.role!=='scene'||a.type!=='video/mp4'||a.generated!==true||typeof a.cinemaSignature!=='string'||a.cinemaSignature.length>5000))throw Error('توقيع لقطة غير صالح');
  if(a.artIdentity!=null&&(a.role!=='scene'||!a.type.startsWith('image/')||a.generated!==true||typeof a.artIdentity!=='string'||a.artIdentity.length>6000))throw Error('توقيع رسم غير صالح');
  total+=a.size;if(total>MAX)throw Error('حجم الوسائط يتجاوز 300 MB');
 }
 if(!m.mix||!Number.isFinite(m.mix.gain)||m.mix.gain<0||m.mix.gain>50||!Number.isFinite(m.mix.duck)||m.mix.duck<0||m.mix.duck>100)throw Error('إعدادات مزج غير صالحة');
 if(m.voiceSignature!==null&&(typeof m.voiceSignature!=='string'||m.voiceSignature.length>200000||!seen.has('voice')))throw Error('توقيع صوت غير صالح');
 return total;
}
function pack(project,items,mix,voiceSignature=null){
 const m={version:1,project,media:items.map(a=>({role:a.role,scene:a.scene,name:a.name,type:a.blob.type,size:a.blob.size,generated:a.generated===true,...(a.cinemaSignature?{cinemaSignature:a.cinemaSignature}:{}),...(a.artIdentity?{artIdentity:a.artIdentity}:{})})),mix,voiceSignature};
 validate(m);const json=new Blob([JSON.stringify(m)]);if(json.size>MANIFEST_MAX)throw Error('بيانات المشروع كبيرة جدًا');
 const head=MAGIC+String(json.size).padStart(8,'0')+'\n';
 return new Blob([head,json,...items.map(a=>a.blob)],{type:'application/octet-stream'});
}
async function unpack(file){
 const headerLength=MAGIC.length+9;if(file.size>MAX+MANIFEST_MAX+headerLength)throw Error('ملف المشروع كبير جدًا');
 const h=await file.slice(0,headerLength).text();if(!h.startsWith(MAGIC)||!/^\d{8}\n$/.test(h.slice(MAGIC.length)))throw Error('ملف مشروع غير معروف');
 const length=Number(h.slice(MAGIC.length));if(length<2||length>MANIFEST_MAX||headerLength+length>file.size)throw Error('طول البيانات غير صالح');
 const m=JSON.parse(await file.slice(headerLength,headerLength+length).text());const total=validate(m);
 if(headerLength+length+total!==file.size)throw Error('ملف المشروع ناقص أو تالف');
 let offset=headerLength+length;const items=m.media.map(a=>{const blob=file.slice(offset,offset+a.size,a.type);offset+=a.size;return {...a,blob};});
 return {manifest:m,items};
}
root.DirectorBundle=Object.freeze({pack,unpack,validate,MAX});
})(globalThis);