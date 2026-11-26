/* Director V3: deterministic, local-only visual storytelling. */
(function(root){
'use strict';
const layouts=['hook','audit','fix','assistant','insights','cta','media'];
const P={ink:'#0b3b33',mint:'#00b478',paper:'#fff',soft:'#e6f5ec',dark:'#062821'};
const sample={title:'هنا يبدأ دورنا',format:'16:9',scenes:[
{layout:'hook',duration:10,title:'أنت تجيب العميل',subtitle:'وإحنا نساعده يختار',labels:['وصول العميل','لحظة الاختيار'],narration:'أنت تستثمر في جلب العملاء لمتجرك. هنا يبدأ دورنا.'},
{layout:'audit',duration:11,title:'اطمئن على منتجاتك',subtitle:'فحص مجاني يوضح ما يحتاج انتباهك',labels:['وصف المنتج','الصور والتصنيفات','بيانات الظهور'],narration:'افحص كتالوج متجرك مجانًا، واعرف أين تحتاج بيانات منتجاتك إلى تحسين.'},
{layout:'fix',duration:10,title:'تعديلات بدون عناء',subtitle:'راجع ووافق، وننفّذ التحسينات المدعومة',labels:['راجع المقترح','وافق','تحقّق من التنفيذ'],narration:'نجهّز التحسينات المدعومة، وأنت تراجع وتوافق قبل تنفيذها.'},
{layout:'assistant',duration:14,title:'مساعدة وقت الاختيار',subtitle:'موظف مبيعات رقمي يفهم كتالوجك',labels:['أبحث عن عطر للدوام','خلّنا نختار من منتجات المتجر','ميزانيتك كم؟'],narration:'مساعد يعرف معلومات منتجاتك ويرشّح للعميل ما يناسبه من متجرك.'},
{layout:'insights',duration:11,title:'افهم ما يريده عملاؤك',subtitle:'قرارات أذكى من محادثات حقيقية',labels:['الطلب','البدائل','فرص التحسين'],narration:'اعرف ماذا يبحث عنه عملاؤك وما لم يجدوه، بجانب بيانات مبيعاتك.'},
{layout:'cta',duration:9,title:'هنا يبدأ دورنا',subtitle:'افحص كتالوج متجرك مجانًا',labels:['fulltimedigi.com'],narration:'ابدأ الآن بالفحص المجاني على زد.'}
]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),ease=t=>1-(1-clamp(t,0,1))**3;
const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const duration=p=>p.scenes.reduce((n,s)=>n+s.duration,0);
// Independent layer animation: sample absolute time, never accumulate frame-to-frame state.
const layerNames=['visual','title','subtitle'];
const curves=['linear','out','inout','smooth','hold'];
function curve(t,name){t=clamp(t,0,1);if(name==='out')return 1-(1-t)**3;if(name==='inout')return t<.5?4*t*t*t:1-(-2*t+2)**3/2;if(name==='smooth')return t*t*(3-2*t);if(name==='hold')return t===1?1:0;return t;}
function trackPreset(name='calm'){
 const make=(start,end,x,y,scale)=>[{t:0,opacity:0,x,y,scale,ease:'hold'},{t:start,opacity:0,x,y,scale,ease:'hold'},{t:end,opacity:1,x:0,y:0,scale:1,ease:'out'}].filter((v,i,a)=>i===0||v.t!==a[i-1].t);
 if(name==='static')return Object.fromEntries(layerNames.map(k=>[k,[{t:0,opacity:1,x:0,y:0,scale:1,ease:'linear'}]]));
 if(name==='editorial')return {visual:make(0,.9,-.025,0,1),title:make(.35,1.05,0,.015,1),subtitle:make(.7,1.4,0,.01,1)};
 if(name==='calm')return {visual:make(0,.85,0,.012,.99),title:make(0,.65,0,.012,1),subtitle:make(.35,1.05,0,.008,1)};
 throw Error('قالب الحركة غير معروف');
}
function normalizeTracks(input,duration){
 if(input===undefined||input===null)return trackPreset('calm');
 if(typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!layerNames.includes(k)))throw Error('طبقات الحركة غير معروفة');
 const tracks={};for(const name of layerNames){const frames=input[name];if(!Array.isArray(frames)||frames.length<1||frames.length>24)throw Error('كل طبقة تحتاج 1–24 إطارًا مفتاحيًا');
 let last=-1;tracks[name]=frames.map(k=>{if(!k||typeof k!=='object')throw Error('إطار مفتاحي غير صالح');const f={t:Number(k.t),opacity:Number(k.opacity??1),x:Number(k.x??0),y:Number(k.y??0),scale:Number(k.scale??1),ease:k.ease??'out'};
 if(![f.t,f.opacity,f.x,f.y,f.scale].every(Number.isFinite)||f.t<0||f.t>duration||f.t<=last||f.opacity<0||f.opacity>1||Math.abs(f.x)>.2||Math.abs(f.y)>.2||f.scale<.85||f.scale>1.15||!curves.includes(f.ease))throw Error('قيم أو ترتيب إطارات '+name+' غير صالح');last=f.t;return f;});if(tracks[name][0].t!==0)throw Error('أول إطار في '+name+' يجب أن يبدأ عند صفر');}
 return tracks;
}
function sampleTrack(frames,time){
 if(time<=frames[0].t)return {...frames[0]};
 for(let i=1;i<frames.length;i++){const a=frames[i-1],b=frames[i];if(time<=b.t){const f=curve((time-a.t)/(b.t-a.t),b.ease),r={};for(const k of ['opacity','x','y','scale'])r[k]=a[k]+(b[k]-a[k])*f;return r;}}
 return {...frames[frames.length-1]};
}
function layerState(s,name,t){return sampleTrack((s.motionTracks||trackPreset())[name],t);}
function finalHold(s){const tracks=s.motionTracks||trackPreset(),last=layerNames.map(k=>tracks[k].at(-1));return {start:Math.max(...last.map(k=>k.t)),visible:last.every(k=>k.opacity>=.98&&Math.abs(k.x)<.001&&Math.abs(k.y)<.001&&Math.abs(k.scale-1)<.001)};}
function layer(c,s,name,t,w,h,cx,cy,draw){const a=layerState(s,name,t);c.save();try{c.globalAlpha*=a.opacity;c.translate(a.x*w+cx,a.y*h+cy);c.scale(a.scale,a.scale);c.translate(-cx,-cy);return draw();}finally{c.restore();}}
function transitionAlpha(s,local){if(s.transition==='cut')return 0;return Math.max(1-ease(local/.4),1-ease((s.duration-local)/.4));}
// Caption times are scene-relative. Estimated cues are not word-aligned transcription.
function normalizeCaptions(input,seconds){
 if(input==null)return [];
 if(!Array.isArray(input)||input.length>40)throw Error('حد الترجمة 40 مقطعًا لكل مشهد');
 let last=0;return input.map((cue,i)=>{
 if(!cue||typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>150)throw Error('نص ترجمة غير صالح '+(i+1));
 const start=Number(cue.start),end=Number(cue.end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<last-1e-7||start<0||end>seconds+1e-7||end-start<.5)throw Error('توقيت ترجمة غير صالح '+(i+1));
 last=end;return {start,end,text:cue.text.trim()};
 });
}
function captionAt(s,t){return (s.captions||[]).find(q=>t>=q.start&&t<q.end)||null;}
function estimateCaptions(text,seconds){
 const words=String(text||'').trim().split(/\s+/).filter(Boolean);if(!words.length)return [];
 if(!Number.isFinite(seconds)||seconds<.5)throw Error('مدة الصوت قصيرة');
 const groups=[];let buf=[];
 for(const w of words){if(w.length>100)throw Error('اختصر الكلمة الطويلة في الترجمة');if(buf.length&&(buf.length>=8||[...buf,w].join(' ').length>58)){groups.push(buf.join(' '));buf=[];}buf.push(w);}if(buf.length)groups.push(buf.join(' '));
 if(groups.length>40||seconds<groups.length*.5)throw Error('قسّم التعليق إلى مشاهد أطول');
 // Allocate a minimum readable cue length, then distribute the remaining time by character weight.
 const weights=groups.map(s=>s.replace(/\s/g,'').length),total=weights.reduce((a,b)=>a+b,0),remaining=seconds-groups.length*.5;let cursor=0;
 return groups.map((text,i)=>{const start=cursor;cursor=i===groups.length-1?seconds:cursor+.5+remaining*weights[i]/total;return {start,end:cursor,text};});
}
function srt(p){const stamp=t=>{const n=Math.round(t*1000),pad=(v,d=2)=>String(v).padStart(d,'0');return pad(Math.floor(n/3600000))+':'+pad(Math.floor(n/60000)%60)+':'+pad(Math.floor(n/1000)%60)+','+pad(n%1000,3);};let offset=0,i=0;const lines=[];for(const s of p.scenes){for(const q of s.captions||[])lines.push(++i+'\n'+stamp(offset+q.start)+' --> '+stamp(offset+q.end)+'\n'+q.text+'\n');offset+=s.duration;}return lines.join('\n');}
function captionBand(c,s,t,w,h){const cues=s.captions||[];if(!cues.length)return true;const q=captionAt(s,t);if(!q)return true;const portrait=w<h,pad=portrait?65:105,band=portrait?165:126,y=h-(portrait?230:175);rect(c,pad,y,w-pad*2,band,24,'#092e27');return fit(c,q.text,pad+30,y+12,w-pad*2-60,band-24,portrait?44:43,'#fff','center','rtl',28);}
function captionCheck(c,s,w,h){let ok=true;for(const q of s.captions||[])ok=captionBand(c,s,(q.start+q.end)/2,w,h)&&ok;return ok;}
// Product-demo camera: explicitly authored focus, never automatic cropping of real evidence.
function normalizeFocus(input,seconds){
 if(input==null)return [];
 if(!Array.isArray(input)||input.length>12)throw Error('حد حركة الكاميرا 12 نقطة');
 let last=-1;return input.map((f,i)=>{
 if(!f||typeof f!=='object')throw Error('نقطة كاميرا غير صالحة');
 const n={t:Number(f.t),x:Number(f.x),y:Number(f.y),zoom:Number(f.zoom)};
 if(!Object.values(n).every(Number.isFinite)||n.t<0||n.t>seconds||n.t<=last||n.x<0||n.x>1||n.y<0||n.y>1||n.zoom<1||n.zoom>2.5)throw Error('قيمة أو توقيت كاميرا غير صالح '+(i+1));
 if(i===0&&n.t!==0)throw Error('أول نقطة كاميرا تبدأ من صفر');last=n.t;return n;
 });
}
function focusAt(frames,t){
 if(!frames?.length)return {x:.5,y:.5,zoom:1};
 if(t<=frames[0].t)return frames[0];
 for(let i=1;i<frames.length;i++){const a=frames[i-1],b=frames[i];if(t<=b.t){const k=curve((t-a.t)/(b.t-a.t),'smooth');return {x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k,zoom:a.zoom+(b.zoom-a.zoom)*k};}}
 return frames.at(-1);
}
function focusCrop(iw,ih,f){if(!Number.isFinite(iw)||!Number.isFinite(ih)||iw<=0||ih<=0)throw Error('Invalid image dimensions');const sw=iw/f.zoom,sh=ih/f.zoom;return {sx:clamp(iw*f.x-sw/2,0,iw-sw),sy:clamp(ih*f.y-sh/2,0,ih-sh),sw,sh};}
// Contained source thumbnail; pointer coordinates are relative to actual pixels, not letterbox margins.
function sourceFit(iw,ih,w,h){if(![iw,ih,w,h].every(x=>Number.isFinite(x)&&x>0))throw Error('Invalid media dimensions');const k=Math.min(w/iw,h/ih),dw=iw*k,dh=ih*k;return {x:(w-dw)/2,y:(h-dh)/2,w:dw,h:dh};}
function sourcePoint(box,x,y){if(x<box.x||x>box.x+box.w||y<box.y||y>box.y+box.h)return null;return {x:clamp((x-box.x)/box.w,0,1),y:clamp((y-box.y)/box.h,0,1)};}
function focusPreset(seconds,x=.5,y=.5,zoom=1.65){const ramp=Math.min(1.5,seconds*.2);return normalizeFocus([{t:0,x:.5,y:.5,zoom:1},{t:ramp,x:.5,y:.5,zoom:1},{t:ramp*2,x,y,zoom},{t:seconds-ramp*1.5,x,y,zoom},{t:seconds-ramp*.3,x:.5,y:.5,zoom:1}],seconds);}
function reviewTimes(s){const stable=Math.max(1.5,finalHold(s).start+.15,graphReady(s.sceneGraph)+.15),limit=s.duration-.15;return [...new Set([Math.min(limit,.4),Math.min(limit,stable),s.duration*.5,Math.max(.05,limit)].map(t=>Math.max(.05,t)))].sort((a,b)=>a-b);}
function normalize(p){
 if(!p||!['16:9','9:16'].includes(p.format)||!Array.isArray(p.scenes)||p.scenes.length<1||p.scenes.length>30)throw Error('اختر مقاسًا مدعومًا ومن 1 إلى 30 مشهدًا');
 const scenes=p.scenes.map((s,i)=>{
  if(!s||!layouts.includes(s.layout)||!Number.isFinite(Number(s.duration))||Number(s.duration)<2||Number(s.duration)>60||!str(s.title,160))throw Error('راجع نوع وعنوان ومدة المشهد '+(i+1)+' (2–60 ثانية)');
  return {layout:s.layout,duration:Number(s.duration),motionTracks:normalizeTracks(s.motionTracks,Number(s.duration)),sceneGraph:normalizeGraph(s.sceneGraph,Number(s.duration)),captions:normalizeCaptions(s.captions,Number(s.duration)),production:s.layout==='media'?'evidence':['local','image','cinema'].includes(s.production)?s.production:(s.sceneGraph?'local':'image'),focus:normalizeFocus(s.focus,Number(s.duration)),transition:s.transition==='cut'?'cut':'fade',title:str(s.title,160),subtitle:str(s.subtitle,250),narration:str(s.narration,3000),visual:str(s.visual,1400),composition:['auto','split','hero'].includes(s.composition)?s.composition:'auto',framing:['auto','split','reverse','center'].includes(s.framing)?s.framing:'auto',useCharacter:s.useCharacter===true,motion:['push','pan','still'].includes(s.motion)?s.motion:'push',labels:Array.isArray(s.labels)?s.labels.slice(0,3).map(v=>str(v,100)).filter(Boolean):[]};
 });
 const result={title:str(p.title,100)||'مشروع جديد',format:p.format,character:str(p.character,800),style:['editorial','cinematic','vector','product'].includes(p.style)?p.style:'editorial',scenes};
 if(duration(result)>600)throw Error('الحد الأقصى عشر دقائق');return result;
}
function locate(p,t){let start=0;t=clamp(Number(t)||0,0,duration(p));for(let i=0;i<p.scenes.length;i++){const s=p.scenes[i];if(t<start+s.duration||i===p.scenes.length-1)return {i,local:t-start,scene:s};start+=s.duration;}}
// Reading budget is a conservative editorial heuristic, not a measured reading speed.
const words=t=>String(t||'').trim().split(/\s+/).filter(Boolean).length;
function readingSeconds(s,mode='comfortable',withArt=true){const rate=mode==='quick'?2.6:mode==='silent'?1.7:2.1;const texts=[s.title,s.subtitle,...(withArt?(s.sceneGraph?s.sceneGraph.objects.map(o=>o.text).filter(Boolean):s.labels||[]):[])];const count=texts.reduce((n,t)=>n+words(t),0);const chars=texts.reduce((n,t)=>n+String(t||'').replace(/\s/g,'').length,0);const entry=withArt&&s.layout==='assistant'?2.2:1.4;return Math.ceil(Math.max(mode==='quick'?5:mode==='silent'?8:7,Math.max(entry,finalHold(s).start,withArt?graphReady(s.sceneGraph):0)+Math.max(count/rate,chars/(rate*5))+1.0)*10)/10;}
function paced(p,mode='comfortable',assets=new Map()){if(!['quick','comfortable','silent'].includes(mode))throw Error('إيقاع غير معروف');const q=normalize(p);q.scenes=q.scenes.map((s,i)=>({...s,duration:Math.max(s.duration,readingSeconds(s,mode,!assets.has(i)))}));return normalize(q);}
function review(p,assets=new Map()){const out=[],used=new Map(),prompts=new Map();p.scenes.forEach((s,i)=>{const a=assets.get(i),n=i+1,add=(level,text)=>out.push({level,text:'المشهد '+n+': '+text});
 if(s.layout==='media'&&(!a||a.generated))add('error','أرفق صورة أو فيديو');
 if(s.layout==='media'&&s.sceneGraph)add('error','لا تستخدم الرسم المركب في مشهد الدليل الحقيقي');
 if(s.title.length>65)add('warn','العنوان طويل');
 if(s.focus?.length&&s.layout!=='media')add('warn','كاميرا التفاصيل تعمل فقط على مشاهد تسجيل التطبيق');
 for(const q of s.captions||[]){if(q.text.split(/\s+/).length/(q.end-q.start)>3)add('warn','ترجمة سريعة؛ راجع توقيتها يدويًا');}
 if(!finalHold(s).visible)add('error','يجب أن تنتهي طبقات الحركة في وضع ظاهر ومستقر للقراءة');
 if(s.duration<readingSeconds(s,'comfortable',!a))add('warn','القراءة تحتاج نحو '+readingSeconds(s,'comfortable',!a)+' ثانية؛ زد زمن المشهد');
 if(s.narration.split(/\s+/).filter(Boolean).length>s.duration*3)add('warn','التعليق طويل بالنسبة للمدة');
 if(i&&s.layout===p.scenes[i-1].layout&&!a&&!assets.get(i-1))add('warn','تكرار الإخراج البصري');
 if(s.visual&&s.layout!=='media'){const k=s.visual.trim().toLowerCase().replace(/\s+/g,' ');if(prompts.has(k))add('warn','وصف بصري مكرر من المشهد '+prompts.get(k));else prompts.set(k,n);}
 if(a?.identity){if(used.has(a.identity))add('warn','تكرار أصل المشهد '+used.get(a.identity));else used.set(a.identity,n);}
 });return out;}
const dimensions=f=>f==='9:16'?{w:1080,h:1920}:{w:1920,h:1080};
function rect(c,x,y,w,h,r,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,Math.min(r,w/2,h/2));if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke();}}
function circle(c,x,y,r,color){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();}
function line(c,x,y,X,Y,color,width=4){c.beginPath();c.moveTo(x,y);c.lineTo(X,Y);c.strokeStyle=color;c.lineCap='round';c.lineWidth=width;c.stroke();}
function wrap(c,text,w){const out=[];for(const para of String(text).split('\n')){let a='';for(const word of para.split(/\s+/).filter(Boolean)){if(c.measureText(word).width>w){if(a){out.push(a);a='';}for(const ch of Array.from(word)){if(a&&c.measureText(a+ch).width>w){out.push(a);a=ch;}else a+=ch;}continue;}const b=a?a+' '+word:word;if(a&&c.measureText(b).width>w){out.push(a);a=word;}else a=b;}if(a)out.push(a);}return out;}
function fit(c,text,x,y,w,h,size=70,color=P.ink,align='right',direction='rtl',min=18){let lines,lh;
 for(;size>=min;size-=2){c.font='700 '+size+'px DirectorCairo,Cairo,sans-serif';lh=size*1.34;lines=wrap(c,text,w);if(lines.length*lh<=h)break;}
 if(size<min)return false;c.textAlign=align;c.textBaseline='middle';c.direction=direction;c.fillStyle=color;const px=align==='center'?x+w/2:align==='left'?x:x+w,py=y+(h-lines.length*lh)/2+lh/2;lines.forEach((v,i)=>c.fillText(v,px,py+i*lh));return true;}
function check(c,x,y){circle(c,x,y,25,P.mint);line(c,x-10,y,x-3,y+9,'#fff',5);line(c,x-3,y+9,x+13,y-11,'#fff',5);}
// Specific product silhouettes rather than interchangeable generic dots.
function productGlyph(c,x,y,w,h,kind){c.save();c.translate(x,y);c.scale(w/100,h/100);
 if(kind===0){rect(c,30,30,40,52,8,'#d9b77b');rect(c,40,17,20,17,3,'#0b3b33');rect(c,36,44,28,22,3,'#fff');}
 else if(kind===1){c.beginPath();c.moveTo(27,22);c.lineTo(8,36);c.lineTo(22,53);c.lineTo(31,46);c.lineTo(31,84);c.lineTo(69,84);c.lineTo(69,46);c.lineTo(78,53);c.lineTo(92,36);c.lineTo(73,22);c.lineTo(61,17);c.quadraticCurveTo(50,35,39,17);c.closePath();c.fillStyle='#86c9a8';c.fill();c.strokeStyle='#0b3b33';c.lineWidth=2;c.stroke();}
 else if(kind===2){rect(c,20,38,60,46,9,'#a9c9c1','#0b3b33');c.beginPath();c.arc(50,38,17,Math.PI,Math.PI*2);c.strokeStyle='#0b3b33';c.lineWidth=5;c.stroke();rect(c,43,55,14,12,3,'#d9b77b');}
 else{rect(c,26,24,48,60,8,'#0b3b33');rect(c,31,31,38,44,3,'#cce9d9');circle(c,50,79,3,'#fff');}c.restore();
}
function merchantGlyph(c,x,y,k){c.save();c.translate(x,y);c.scale(k,k);circle(c,0,-43,40,'#0b3b33');circle(c,0,-36,30,'#d7ab89');c.beginPath();c.moveTo(-66,80);c.quadraticCurveTo(-62,-2,0,-2);c.quadraticCurveTo(62,-2,66,80);c.closePath();c.fillStyle='#14674f';c.fill();rect(c,-23,8,46,78,9,'#e6f5ec','#0b3b33');rect(c,-18,14,36,60,5,'#0b3b33');circle(c,-4,40,6,'#00b478');circle(c,11,40,6,'#9bddb9');c.restore();}
// Purpose-built, layered illustration for the audit and assistant rather than generic icons.
function bottle(c,x,y,k){c.save();c.translate(x,y);c.scale(k,k);rect(c,-61,-80,122,160,20,'#d7b77c','#8f713f');rect(c,-53,-70,106,142,15,'#eed5a3');rect(c,-25,-118,50,40,7,'#173e34');rect(c,-21,-113,42,9,3,'#4d7567');rect(c,-42,-23,84,57,7,'#f8f0da');line(c,-24,-3,24,-3,'#a78a54',3);line(c,-17,10,17,10,'#a78a54',3);rect(c,-50,-61,7,102,3,'rgba(255,255,255,.7)');c.restore();}
function glass(c,x,y,r){c.save();c.shadowColor='rgba(11,59,51,.16)';c.shadowBlur=16;line(c,x+r*.68,y+r*.68,x+r*1.35,y+r*1.35,'#0b3b33',22);circle(c,x,y,r,'#d2f2e2');c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.lineWidth=12;c.strokeStyle='#0b3b33';c.stroke();c.shadowBlur=0;line(c,x-r*.5,y-r*.25,x-r*.2,y-r*.55,'#fff',9);c.restore();}
// Original scene graph and vector art. All positions are normalized within the 800 x 700 artboard.
const objectKinds=['arch','desk','merchant','shopper','laptop','phone','perfume','document','lens','bubble','seal','parcel','notebook'];
const objectMotions=['none','rise','slide','pop'],objectPoses=['idle','point','think','approve'];
const themes={emerald:{back:'#d8eee1',light:'#eff7ef',accent:'#00b478',dark:'#0b3b33',warm:'#d5a367'},sand:{back:'#ede0cd',light:'#fff8eb',accent:'#1a8a69',dark:'#16493b',warm:'#bf8955'},night:{back:'#163f36',light:'#295a4b',accent:'#65d5a0',dark:'#092c25',warm:'#d5ae72'}};
function normalizeGraph(g,seconds){
 if(g==null)return null;
 if(typeof g!=='object'||!Object.hasOwn(themes,g.theme)||!Array.isArray(g.objects)||g.objects.length<1||g.objects.length>24)throw Error('المشهد المركب يحتاج لونًا ومن 1 إلى 24 عنصرًا');
 const seen=new Set(),objects=g.objects.map((o,i)=>{
 if(!o||!objectKinds.includes(o.kind)||typeof o.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(o.id)||seen.has(o.id))throw Error('نوع أو معرّف العنصر '+(i+1)+' غير صالح');seen.add(o.id);
 const n={id:o.id,kind:o.kind,x:Number(o.x),y:Number(o.y),w:Number(o.w),h:Number(o.h),delay:Number(o.delay??0),enter:Number(o.enter??.85),motion:o.motion??'rise',pose:o.pose??'idle',text:str(o.text,90)};
 if(![n.x,n.y,n.w,n.h,n.delay,n.enter].every(Number.isFinite)||n.x<0||n.y<0||n.w<.06||n.h<.06||n.x+n.w>1.000001||n.y+n.h>1.000001||n.delay<0||n.enter<.2||n.enter>4||n.delay+n.enter>seconds||!objectMotions.includes(n.motion)||!objectPoses.includes(n.pose))throw Error('موضع أو توقيت العنصر '+(i+1)+' خارج الحدود');
 return n;
 });return {theme:g.theme,objects};
}
function objectState(o,t){const p=curve((t-o.delay)/o.enter,'out');return {visible:t>=o.delay,opacity:o.motion==='none'?1:p,dx:o.motion==='slide'?(1-p)*-.035:0,dy:o.motion==='rise'?(1-p)*.025:0,scale:o.motion==='pop'?.90+.10*p:1,poseProgress:p};}
function graphReady(g){return g?Math.max(...g.objects.map(o=>o.delay+o.enter)):0;}
function graphPreset(layout,labels=[]){
 const o=(id,kind,x,y,w,h,delay=0,pose='idle',text='',motion='rise')=>({id,kind,x,y,w,h,delay,enter:.85,pose,text,motion});
 const arch=o('arch','arch',.02,.02,.96,.95,0,'idle','','none');
 const list={
 hook:[arch,o('shopper','shopper',.48,.24,.49,.73,.15,'think'),o('phone','phone',.01,.15,.56,.81,.45),o('question','bubble',.43,.045,.54,.17,1.25,'idle',labels[1]||'وش أختار؟')],
 audit:[o('catalog','document',.025,.02,.81,.94,.15,'think',labels[0]||'بيانات المنتج'),o('lens','lens',.57,.32,.41,.48,.9,'idle','','pop'),o('question','bubble',.49,.045,.48,.145,1.35,'idle','يحتاج مراجعة')],
 fix:[o('before','document',.51,.10,.48,.79,.1,'think','قبل المراجعة'),o('after','document',.01,.10,.48,.79,.85,'approve','بعد الموافقة'),o('seal','seal',.01,.015,.22,.23,1.55,'idle','','pop')],
 assistant:[o('phone','phone',.01,.025,.63,.95,.15,'point'),o('perfume','perfume',.65,.59,.33,.38,.75),o('chat1','bubble',.53,.075,.46,.20,.95,'idle',labels[0]||'أبحث عن منتج'),o('chat2','bubble',.53,.30,.46,.25,1.7,'idle',labels[1]||'أساعدك تختار')],
 insights:[o('notebook','notebook',.01,.13,.75,.84,.15,'idle','أسئلة العملاء'),o('note','bubble',.43,.035,.56,.18,.9,'idle',labels[2]||'فرص التحسين'),o('lens','lens',.65,.47,.33,.38,1.4,'idle','','pop')],
 cta:[arch,o('seal','seal',.23,.015,.54,.66,.15,'idle','','pop'),o('url','bubble',.08,.71,.84,.23,.95,'idle',labels[0]||'fulltimedigi.com')]
 };
 if(!Object.hasOwn(list,layout))throw Error('مشهد إثبات حقيقي لا يستبدل برسم');return {theme:layout==='cta'?'night':layout==='hook'||layout==='assistant'?'sand':'emerald',objects:list[layout]};
}
function sceneGraphDemo(p=sample){const q=normalize(p);return paced({...q,scenes:q.scenes.map(s=>s.layout==='media'?s:{...s,composition:'split',sceneGraph:graphPreset(s.layout,s.labels)})},'silent');}
function oval(c,x,y,rx,ry,color){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();}
function grad(c,x,y,X,Y,a,b){const g=c.createLinearGradient(x,y,X,Y);g.addColorStop(0,a);g.addColorStop(1,b);return g;}
function poly(c,points,fill){c.beginPath();c.moveTo(points[0][0],points[0][1]);for(const p of points.slice(1))c.lineTo(p[0],p[1]);c.closePath();c.fillStyle=fill;c.fill();}
function rigPerson(c,kind,pose,k,T){
 const shopper=kind==='shopper',skin=shopper?'#b97d53':'#d6aa83',cloth=shopper?'#db9f68':'#247c62',hair='#25352f';
 oval(c,51,94,29,4,'rgba(9,44,37,.15)');rect(c,31,64,15,29,6,T.dark);rect(c,53,64,15,29,6,T.dark);rect(c,27,89,20,6,3,'#233831');rect(c,52,89,20,6,3,'#233831');
 c.beginPath();c.moveTo(27,43);c.quadraticCurveTo(50,31,73,43);c.lineTo(79,70);c.quadraticCurveTo(50,80,22,70);c.closePath();c.fillStyle=grad(c,24,38,80,78,cloth,shopper?'#b77949':'#11513e');c.fill();
 rect(c,44,30,12,13,4,skin);oval(c,50,21,17,20,hair);oval(c,50,25,14,17,skin);poly(c,[[34,21],[35,8],[45,2],[62,6],[68,18],[58,14],[46,16]],hair);
 circle(c,44,25,1.3,'#303931');circle(c,56,25,1.3,'#303931');line(c,48,33,53,33,'#89583b',1.3);
 const arm=(side,upper,lower)=>{c.save();c.translate(side===1?73:27,46);c.rotate(upper);line(c,0,0,0,19,cloth,9);c.translate(0,19);c.rotate(lower);line(c,0,0,0,16,skin,6);circle(c,0,16,4,skin);c.restore();};
 const point=pose==='point',think=pose==='think',approve=pose==='approve';arm(-1,.20+(think?.8*k:0),think?1.65*k:.18);arm(1,-.18-(point?1.3*k:approve?1.9*k:0),point?-.8*k:approve?-1.3*k:-.15);
 if(think){rect(c,46,49,12,20,2,T.dark);rect(c,47,51,10,15,1,'#c5ecdb');}
}
function vectorObject(c,o,k,T){
 switch(o.kind){
 case 'arch':c.beginPath();c.moveTo(3,95);c.lineTo(3,42);c.bezierCurveTo(3,-5,97,-5,97,42);c.lineTo(97,95);c.closePath();c.fillStyle=grad(c,0,0,100,100,T.back,T.light);c.fill();c.strokeStyle='rgba(255,255,255,.6)';c.lineWidth=.8;c.stroke();for(let j=0;j<4;j++)line(c,14+j*5,21,14+j*5,69,'rgba(255,255,255,.22)',.7);break;
 case 'desk':oval(c,50,72,48,14,'rgba(9,44,37,.13)');poly(c,[[3,35],[89,35],[98,49],[10,49]],T.warm);poly(c,[[10,49],[98,49],[98,58],[10,58]],'#a97a4d');rect(c,15,58,5,34,1,T.dark);rect(c,87,58,5,34,1,T.dark);break;
 case 'merchant':case 'shopper':rigPerson(c,o.kind,o.pose,k,T);break;
 case 'perfume':bottle(c,50,60,.31);break;
 case 'lens':glass(c,42,42,28);break;
 case 'phone':{
 oval(c,50,97,29,3,'rgba(9,44,37,.15)');c.save();c.shadowColor='rgba(9,44,37,.2)';c.shadowBlur=5;c.shadowOffsetY=3;rect(c,16,1,68,95,12,T.dark);c.restore();rect(c,20,5,60,87,9,'#fff');rect(c,40,8,20,4,2,T.dark);
 if(o.pose==='point'){rect(c,24,17,52,13,4,T.dark);circle(c,68,23.5,3,T.accent);rect(c,28,35,43,12,4,'#e1eee7');line(c,34,40,64,40,'#9eb8ab',1.4);rect(c,24,51,45,12,4,'#c4edda');line(c,30,56,61,56,'#4d9274',1.4);rect(c,24,67,45,13,4,'#e6f5ec');productGlyph(c,26,67,12,12,0);line(c,41,71,63,71,'#79ac96',1.4);line(c,41,75,57,75,'#9eb8ab',1.2);rect(c,24,84,52,5,2,'#eff4f0');}
 else{rect(c,24,17,52,13,4,T.accent);for(let j=0;j<4;j++){let x=24+j%2*27,y=34+Math.floor(j/2)*24;rect(c,x,y,25,22,4,'#e7f3ec');productGlyph(c,x+3,y+1,19,19,j);}rect(c,38,85,24,3,2,'#b9d7ca');}break;}
 case 'laptop':oval(c,50,87,48,5,'rgba(9,44,37,.2)');rect(c,12,8,76,69,5,T.dark);rect(c,16,13,68,59,2,'#fff');rect(c,19,16,62,9,2,T.accent);for(let j=0;j<3;j++){rect(c,21+j*20,31,17,29,2,'#e5f4ec');productGlyph(c,22+j*20,32,15,15,j);rect(c,23+j*20,51,12,2,1,'#91bba8');}poly(c,[[12,77],[88,77],[99,88],[1,88]],'#78988c');rect(c,38,79,24,3,1,'#d0e2d8');break;
 case 'document':{
 const good=o.pose==='approve',problem=o.pose==='think';oval(c,50,96,39,3,'rgba(9,44,37,.14)');c.save();c.shadowColor='rgba(9,44,37,.14)';c.shadowBlur=5;c.shadowOffsetY=3;rect(c,6,3,88,90,8,'#fff','#b8d4c5');c.restore();rect(c,6,3,88,15,6,T.dark);rect(c,13,9,25,3,1,'#cbe4d7');
 for(let j=0;j<3;j++){const y=24+j*20,bad=problem&&(j===0||j===2);rect(c,12,y,76,17,4,bad?'#fff1dc':'#e7f3ec');productGlyph(c,14,y+1,15,15,j);line(c,33,y+5,bad?54:69,y+5,bad?'#c7a87b':'#8ebaa6',1.8);if(!bad)line(c,33,y+11,61,y+11,'#bfd7cc',1.5);circle(c,80,y+8.5,5,bad?'#d69a43':good?T.accent:'#91b9a7');if(bad){line(c,80,y+5,80,y+9,'#fff',1.4);circle(c,80,y+11.5,.8,'#fff');}else{line(c,77,y+8,79,y+10,'#fff',1.6);line(c,79,y+10,83,y+6,'#fff',1.6);}}break;}
 case 'notebook':oval(c,50,91,46,5,'rgba(9,44,37,.14)');rect(c,5,9,90,78,6,T.dark);rect(c,9,13,82,70,4,'#fff8eb');line(c,50,15,50,82,'#c8af89',2);for(let j=0;j<4;j++){line(c,15,28+j*12,44,28+j*12,'#b6c7b2',1.5);line(c,56,28+j*12,84,28+j*12,'#b6c7b2',1.5);}circle(c,75,38,9,'#d4eddd');line(c,71,38,74,41,T.dark,2);line(c,74,41,80,34,T.dark,2);break;
 case 'parcel':oval(c,50,89,36,5,'rgba(9,44,37,.16)');poly(c,[[11,29],[53,11],[90,29],[48,47]],'#e0bb88');poly(c,[[11,29],[48,47],[48,87],[11,67]],'#bd8f5e');poly(c,[[48,47],[90,29],[90,67],[48,87]],'#d3a572');poly(c,[[28,22],[38,18],[76,36],[66,40]],'#f4e2be');break;
 case 'seal':circle(c,50,50,43,'#d9f4e5');circle(c,50,50,34,T.accent);line(c,31,50,44,63,'#fff',7);line(c,44,63,70,37,'#fff',7);break;
 }
}
function drawGraph(c,g,t){
 const T=themes[g.theme];let ok=true;
 for(const o of g.objects){const a=objectState(o,t),x=o.x*800,y=o.y*700,w=o.w*800,h=o.h*700;
 c.save();try{c.globalAlpha*=a.visible?a.opacity:0;c.translate(x+a.dx*800+w/2,y+a.dy*700+h/2);c.scale(a.scale,a.scale);c.translate(-w/2,-h/2);
 const dir=/^[a-z0-9.\/:-]+$/i.test(o.text)?'ltr':'rtl';
 if(o.kind==='bubble'){rect(c,2,2,w-4,h-4,Math.min(24,h/3),'#fff','#b4d4c2');ok=fit(c,o.text||'…',12,8,w-24,h-16,32,T.dark,'center',dir,14)&&ok;}
 else{const caption=o.text?Math.min(h*.32,85):0,z=Math.min(w,h-caption)/100;c.save();c.translate((w-z*100)/2,(h-caption-z*100)/2);c.scale(z,z);vectorObject(c,o,a.poseProgress,T);c.restore();if(o.text){rect(c,2,h-caption+2,w-4,caption-4,Math.min(14,caption/3),'#fff','#b4d4c2');ok=fit(c,o.text,8,h-caption+4,w-16,caption-8,28,T.dark,'center',dir,14)&&ok;}}
 }finally{c.restore();}
 }return ok;
}
function art(c,s,b,t,a){c.save();c.translate(b.x,b.y);const scale=Math.min(b.w/800,b.h/700);c.translate((b.w-800*scale)/2,(b.h-700*scale)/2);c.scale(scale,scale);
 let artOK=true;const card=(x,y,w,h,f=P.paper)=>rect(c,x,y,w,h,24,f,'#c6e3d3'),label=(v,x,y,w,h,col=P.ink,align='right')=>{const ok=fit(c,v,x,y,w,h,34,col,align,'rtl',16);artOK=artOK&&ok;return ok;},L=s.labels;
 if(a?.node){card(12,24,776,650);const im=a.node,iw=im.videoWidth||im.naturalWidth,ih=im.videoHeight||im.naturalHeight;if(iw&&ih){const custom=a.kind==='image'&&a.generated;const z=(custom?Math.max(736/iw,565/ih):Math.min(736/iw,565/ih))*(custom&&s.motion==='push'?1+.055*ease(t/s.duration):custom&&s.motion==='pan'?1.07:1);const dx=custom&&s.motion==='pan'?(ease(t/s.duration)-.5)*Math.min(60,Math.max(0,iw*z-736)):0;c.save();c.beginPath();c.roundRect(32,43,736,565,18);c.clip();c.drawImage(im,(800-iw*z)/2+dx,43+(565-ih*z)/2,iw*z,ih*z);c.restore();}label(a.generated?'رسم توضيحي مولّد':'وسائط مرفقة',30,615,740,38,P.ink,'center');}
 else if(s.sceneGraph&&s.layout!=='media'){artOK=drawGraph(c,s.sceneGraph,t);}
 else if(s.layout==='hook'){circle(c,398,345,303,'#c9ebd7');circle(c,398,345,235,'#e6f5ec');card(150,85,500,465);rect(c,165,100,470,58,15,P.ink);label('المتجر الإلكتروني',195,108,410,42,'#fff','center');for(let j=0;j<4;j++){const x=185+j%2*220,y=180+Math.floor(j/2)*165;const enter=ease((t-j*.13)/.48);c.save();c.globalAlpha*=enter;rect(c,x,y,208,145,15,'#f3faf6');productGlyph(c,x+59,y+6,90,90,j);rect(c,x+35,y+106,138,9,4,'#8fbdab');rect(c,x+66,y+123,76,6,3,'#c3ded0');c.restore();}c.save();c.translate(635,445+(1-ease((t-.4)/.6))*25);merchantGlyph(c,0,0,1.65);c.restore();rect(c,46,495,185,76,30,'#fff','#c6e3d3');label('وش أختار؟',62,507,153,50,P.ink,'center');label(L[1]||'لحظة الاختيار',70,600,660,65,P.ink,'center');}
 else if(s.layout==='audit'){circle(c,365,342,302,'#d7eddf');c.save();c.shadowColor='rgba(11,59,51,.15)';c.shadowBlur=25;c.shadowOffsetY=14;card(65,58,535,565);c.restore();rect(c,65,58,535,74,24,P.ink);label('فحص الكتالوج',95,69,475,48,'#fff');for(let i=0;i<3;i++){const y=157+i*135;c.save();c.globalAlpha*=ease((t-i*.40)/.85);rect(c,96,y,472,110,18,'#f1f8f4');productGlyph(c,105,y+10,86,86,i);label(L[i]||['بيانات المنتج','الصور','الظهور'][i],205,y+10,305,78);line(c,211,y+87,474,y+87,'#c4dfd0',5);c.restore();}glass(c,595,355+10*Math.sin(t*.9),99);rect(c,507,545,240,65,22,'#0b3b33');label('افحص ثم قرّر',525,553,204,49,'#fff','center');label('مثال توضيحي',95,572,380,38,'#55796a','center');}
 else if(s.layout==='fix'){for(let i=0;i<3;i++){let x=535-i*255;c.save();c.globalAlpha*=ease((t-i*.45)/.85);card(x,165,235,350,i===2?P.ink:i===1?'#d6f1df':'#fff');circle(c,x+117,257,40,i===2?P.mint:P.soft);label(String(i+1),x+78,225,78,65,i===2?'#fff':P.ink,'center');label(L[i]||['راجع','وافق','نفّذ'][i],x+16,325,203,145,i===2?'#fff':P.ink,'center');c.restore();if(i<2){line(c,x-4,340,x-16,340,P.mint,5);line(c,x-16,340,x-9,333,P.mint,4);line(c,x-16,340,x-9,347,P.mint,4);}}label('القرار لك',45,565,710,80,P.ink,'center');}
 else if(s.layout==='assistant'){circle(c,410,340,303,'#d7eddf');c.save();c.shadowColor='rgba(11,59,51,.18)';c.shadowBlur=22;c.shadowOffsetY=10;card(310,26,443,645);c.restore();rect(c,323,41,417,77,18,P.ink);label('مساعد المتجر',346,54,367,51,'#fff');for(let i=0;i<3;i++){const y=143+i*139;c.save();c.globalAlpha*=ease((t-i*.75)/.85);const x=i%2?337:382;rect(c,x,y,340,116,18,i%2?P.soft:P.ink);label(L[i]||['أبحث عن منتج','أساعدك تختار','وش تفضل؟'][i],x+16,y+8,308,100,i%2?P.ink:'#fff');c.restore();}rect(c,335,576,393,52,18,'#edf5f0');circle(c,703,602,13,P.mint);c.save();c.shadowColor='rgba(11,59,51,.13)';c.shadowBlur=14;card(35,179,260,345);c.restore();bottle(c,165,346,1.2);label('مثال منتج',56,462,218,44,P.ink,'center');}
 else if(s.layout==='insights'){card(25,35,750,635);label('ماذا يريد عملاؤك؟',65,68,670,75);const list=L.length?L:['الطلب','البدائل','فرص التحسين'];list.forEach((v,i)=>{let y=165+i*140;c.save();c.globalAlpha*=ease((t-i*.4)/.85);rect(c,65,y,670,115,22,i===1?'#d4efdf':P.soft);circle(c,120,y+57,25,i===1?P.ink:P.mint);label(v,170,y+15,525,85);c.restore();});label('مؤشرات توضيحية وليست أرقام مبيعات',65,595,670,45,'#55796a','center');}
 else if(s.layout==='cta'){circle(c,400,330,290,'#104b3b');circle(c,400,330,230,'#14634b');circle(c,400,330,120,P.mint);line(c,346,332,385,373,'#fff',15);line(c,385,373,459,292,'#fff',15);fit(c,L[0]||'ابدأ الآن',40,575,720,75,36,'#fff','center','ltr');}
 else{card(35,75,730,550);label('أرفق تسجيل التطبيق',70,240,660,180,P.ink,'center');}c.restore();return artOK;}
function heroScene(c,p,t,v,a,logo){const {w,h}=dimensions(p.format),s=v.scene,vert=w<h,pad=vert?72:95,im=a.node,iw=im.naturalWidth,ih=im.naturalHeight,progress=ease(v.local/s.duration);
 c.save();c.setTransform(1,0,0,1,0,0);c.fillStyle=P.dark;c.fillRect(0,0,w,h);
 const z=Math.max(w/iw,h/ih)*(s.motion==='push'?1+.06*progress:s.motion==='pan'?1.07:1),dx=s.motion==='pan'?(progress-.5)*Math.min(iw*z-w,120):0;layer(c,s,'visual',v.local,w,h,w/2,h/2,()=>c.drawImage(im,(w-iw*z)/2+dx,(h-ih*z)/2,iw*z,ih*z));
 const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'rgba(6,40,33,.75)');shade.addColorStop(.25,'rgba(6,40,33,.05)');shade.addColorStop(.4,'rgba(6,40,33,.15)');shade.addColorStop(.67,'rgba(6,40,33,.94)');shade.addColorStop(1,'#062821');c.fillStyle=shade;c.fillRect(0,0,w,h);
 if(logo?.naturalWidth){const lh=56,lw=Math.min(250,lh*logo.naturalWidth/logo.naturalHeight);rect(c,pad-14,pad-8,lw+28,lh+16,14,'#ffffff');c.drawImage(logo,pad,pad,lw,lh);}else fit(c,'FullTimeDigi',pad,pad,300,65,38,'#fff','left','ltr');
 const tw=w-2*pad,ty=s.captions?.length?(vert?h*.57:h*.51):(vert?h*.65:h*.60),th=vert?220:170;const titleOK=layer(c,s,'title',v.local,w,h,w/2,ty+th/2,()=>fit(c,s.title,pad,ty,tw,th,vert?83:96,'#fff','right','rtl',24)),subOK=layer(c,s,'subtitle',v.local,w,h,w/2,ty+th+70,()=>fit(c,s.subtitle,pad,ty+th+12,tw,vert?140:105,vert?46:52,'#c4f3d9'));
 fit(c,'رسم توضيحي مولّد',pad,s.captions?.length?pad:h-pad-48,tw,36,25,'#c4f3d9','right');const captionOK=captionBand(c,s,v.local,w,h);rect(c,pad,h-pad/2,tw,5,2,'#356455');rect(c,pad,h-pad/2,Math.max(1,tw*clamp(t/duration(p),0,1)),5,2,P.mint);
 const fade=transitionAlpha(s,v.local);if(fade>0){c.globalAlpha=fade;c.fillStyle=P.dark;c.fillRect(0,0,w,h);}c.restore();return {titleOK,subOK,captionOK};}
// Large uncropped evidence view; source audio remains muted. No simulated dashboard.
function evidenceScene(c,p,t,v,a,logo){
 const {w,h}=dimensions(p.format),s=v.scene,vert=w<h,pad=vert?65:85,hasCap=Boolean(s.captions?.length);
 c.save();c.setTransform(1,0,0,1,0,0);c.fillStyle='#eaf3ee';c.fillRect(0,0,w,h);
 if(logo?.naturalWidth){const lh=48,lw=Math.min(230,lh*logo.naturalWidth/logo.naturalHeight);c.drawImage(logo,pad,35,lw,lh);}else fit(c,'FullTimeDigi',pad,30,300,54,32,P.ink,'left','ltr');
 const titleOK=fit(c,s.title,pad,105,w-2*pad,vert?145:100,vert?66:70,P.ink,'right','rtl',30);
 const subOK=fit(c,s.subtitle,pad,vert?255:210,w-2*pad,vert?125:75,vert?42:40,'#386657','right','rtl',22);
 const box={x:pad,y:vert?405:310,w:w-pad*2,h:h-(vert?405:310)-(hasCap?(vert?260:195):110)};
 rect(c,box.x,box.y,box.w,box.h,22,'#fff','#c3d9cc');
 const im=a.node,iw=im.videoWidth||im.naturalWidth,ih=im.videoHeight||im.naturalHeight;let artOK=Boolean(iw&&ih);
 if(artOK){const k=Math.min((box.w-30)/iw,(box.h-30)/ih),dw=iw*k,dh=ih*k,dx=box.x+(box.w-dw)/2,dy=box.y+(box.h-dh)/2,f=focusAt(s.focus,v.local);if(f.zoom>1.0001){const q=focusCrop(iw,ih,f);c.drawImage(im,q.sx,q.sy,q.sw,q.sh,dx,dy,dw,dh);rect(c,dx+8,dy+8,156,35,10,'#092e27');fit(c,'عرض مكبّر',dx+16,dy+10,140,31,22,'#fff','center','rtl',16);}else c.drawImage(im,dx,dy,dw,dh);}
 const captionOK=captionBand(c,s,v.local,w,h);rect(c,pad,h-38,w-2*pad,5,2,'#cce5d7');rect(c,pad,h-38,Math.max(1,(w-2*pad)*clamp(t/duration(p),0,1)),5,2,P.mint);
 const opacity=transitionAlpha(s,v.local);if(opacity>0){c.globalAlpha=opacity;c.fillStyle='#eaf3ee';c.fillRect(0,0,w,h);}c.restore();return {titleOK,subOK,artOK,captionOK};
}
// Editorial framing is separate from artwork and motion. All boxes reserve the caption and brand safe zones.
const framingStyles=['auto','split','reverse','center'];
function framing(s,format){
 const {w,h}=dimensions(format),portrait=w<h,caption=Boolean(s.captions?.length),bottom=h-(caption?(portrait?260:195):110);
 let style=framingStyles.includes(s.framing)?s.framing:'auto';
 if(style==='auto')style=s.sceneGraph?({hook:'reverse',audit:'split',fix:portrait?'center':'split',assistant:'reverse',insights:'split',cta:'center'}[s.layout]||'split'):'split';
 if(portrait){
  if(style==='reverse')return {style,align:'right',title:[72,1130,936,210],subtitle:[72,1350,936,155],art:{x:50,y:160,w:980,h:930}};
  if(style==='center')return {style,align:'center',title:[72,160,936,185],subtitle:[72,350,936,145],art:{x:55,y:515,w:970,h:bottom-515}};
  return {style,align:'right',title:[72,182,936,220],subtitle:[72,410,936,145],art:{x:50,y:575,w:980,h:bottom-575}};
 }
 if(style==='center')return {style,align:'center',title:[120,105,1680,105],subtitle:[180,216,1560,72],art:{x:305,y:295,w:1310,h:bottom-295}};
 if(style==='reverse')return {style,align:'right',title:[95,250,805,235],subtitle:[95,492,805,155],art:{x:945,y:145,w:890,h:bottom-145}};
 return {style,align:'right',title:[1000,250,825,235],subtitle:[1000,492,825,155],art:{x:60,y:145,w:915,h:bottom-145}};
}
function frame(c,p,t,assets=new Map(),logo=null){const {w,h}=dimensions(p.format),v=locate(p,t),s=v.scene,vert=w<h,dark=s.layout==='cta',pad=vert?72:95;
 const a=assets.get(v.i);if(s.layout==='media'&&a?.node&&!a.generated)return evidenceScene(c,p,t,v,a,logo);if(s.layout!=='media'&&a?.generated&&a.kind==='image'&&a.node?.naturalWidth&&a.node?.naturalHeight&&(s.composition==='hero'||(s.composition==='auto'&&['hook','cta'].includes(s.layout))))return heroScene(c,p,t,v,a,logo);
 c.save();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,dark?P.dark:'#fff');g.addColorStop(1,dark?P.ink:'#e4f3eb');c.fillStyle=g;c.fillRect(0,0,w,h);
 if(logo?.naturalWidth){const h1=56,w1=h1*logo.naturalWidth/logo.naturalHeight;c.drawImage(logo,pad,pad,w1,h1);}else fit(c,'FullTimeDigi',pad,pad,300,65,38,dark?'#fff':P.ink,'left','ltr');
 const F=framing(s,p.format),tb=F.title,sb=F.subtitle;
 const titleOK=layer(c,s,'title',v.local,w,h,tb[0]+tb[2]/2,tb[1]+tb[3]/2,()=>fit(c,s.title,...tb,F.style==='center'&&!vert?76:86,dark?'#fff':P.ink,F.align,'rtl',24)),subOK=layer(c,s,'subtitle',v.local,w,h,sb[0]+sb[2]/2,sb[1]+sb[3]/2,()=>fit(c,s.subtitle,...sb,48,dark?'#b6efce':'#386657',F.align));
 const ab=F.art;const artOK=layer(c,s,'visual',v.local,w,h,ab.x+ab.w/2,ab.y+ab.h/2,()=>art(c,s,ab,v.local,assets.get(v.i)));
 const progress=clamp(t/duration(p),0,1);rect(c,pad,h-pad/2,w-2*pad,5,2,dark?'#2d6e58':'#cce5d7');rect(c,pad,h-pad/2,Math.max(1,(w-2*pad)*progress),5,2,P.mint);
 fit(c,String(v.i+1).padStart(2,'0')+' / '+String(p.scenes.length).padStart(2,'0'),w-pad-200,pad,200,55,26,dark?'#b6efce':'#497368','right','ltr');
 const captionOK=captionBand(c,s,v.local,w,h);const opacity=transitionAlpha(s,v.local);if(opacity>0){c.globalAlpha=opacity;c.fillStyle=dark?P.dark:'#eef8f3';c.fillRect(0,0,w,h);}c.restore();return {titleOK,subOK,artOK,captionOK};}
// Prefer widely compatible H.264, not unspecified MP4 (which may contain VP9).
function chooseMime(isSupported,hasAudio){const choices=hasAudio?['video/mp4;codecs=avc1.420034,mp4a.40.2','video/mp4;codecs=avc1,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']:['video/mp4;codecs=avc1.420034','video/mp4;codecs=avc1','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];return choices.find(m=>isSupported(m))||null;}
root.DirectorV3=Object.freeze({layouts,sample,normalize,duration,locate,review,dimensions,wrap,frame,chooseMime,readingSeconds,paced,trackPreset,normalizeTracks,sampleTrack,layerState,finalHold,transitionAlpha,objectKinds,objectMotions,objectPoses,normalizeGraph,objectState,graphReady,graphPreset,sceneGraphDemo,drawGraph,normalizeCaptions,captionAt,estimateCaptions,srt,captionCheck,framing,normalizeFocus,focusAt,focusCrop,focusPreset,reviewTimes,sourceFit,sourcePoint});
})(globalThis);