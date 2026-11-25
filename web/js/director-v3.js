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
function normalize(p){
 if(!p||!['16:9','9:16'].includes(p.format)||!Array.isArray(p.scenes)||p.scenes.length<1||p.scenes.length>30)throw Error('اختر مقاسًا مدعومًا ومن 1 إلى 30 مشهدًا');
 const scenes=p.scenes.map((s,i)=>{
  if(!s||!layouts.includes(s.layout)||!Number.isFinite(Number(s.duration))||Number(s.duration)<2||Number(s.duration)>60||!str(s.title,160))throw Error('راجع نوع وعنوان ومدة المشهد '+(i+1)+' (2–60 ثانية)');
  return {layout:s.layout,duration:Number(s.duration),title:str(s.title,160),subtitle:str(s.subtitle,250),narration:str(s.narration,3000),visual:str(s.visual,1400),composition:['auto','split','hero'].includes(s.composition)?s.composition:'auto',useCharacter:s.useCharacter===true,motion:['push','pan','still'].includes(s.motion)?s.motion:'push',labels:Array.isArray(s.labels)?s.labels.slice(0,3).map(v=>str(v,100)).filter(Boolean):[]};
 });
 const result={title:str(p.title,100)||'مشروع جديد',format:p.format,character:str(p.character,800),style:['editorial','cinematic','vector','product'].includes(p.style)?p.style:'editorial',scenes};
 if(duration(result)>600)throw Error('الحد الأقصى عشر دقائق');return result;
}
function locate(p,t){let start=0;t=clamp(Number(t)||0,0,duration(p));for(let i=0;i<p.scenes.length;i++){const s=p.scenes[i];if(t<start+s.duration||i===p.scenes.length-1)return {i,local:t-start,scene:s};start+=s.duration;}}
// Reading budget is a conservative editorial heuristic, not a measured reading speed.
const words=t=>String(t||'').trim().split(/\s+/).filter(Boolean).length;
function readingSeconds(s,mode='comfortable',withArt=true){const rate=mode==='quick'?2.6:mode==='silent'?1.7:2.1;const texts=[s.title,s.subtitle,...(withArt?s.labels||[]:[])];const count=texts.reduce((n,t)=>n+words(t),0);const chars=texts.reduce((n,t)=>n+String(t||'').replace(/\s/g,'').length,0);const entry=withArt&&s.layout==='assistant'?2.2:1.4;return Math.ceil(Math.max(mode==='quick'?5:mode==='silent'?8:7,entry+Math.max(count/rate,chars/(rate*5))+1.0)*10)/10;}
function paced(p,mode='comfortable',assets=new Map()){if(!['quick','comfortable','silent'].includes(mode))throw Error('إيقاع غير معروف');const q=normalize(p);q.scenes=q.scenes.map((s,i)=>({...s,duration:Math.max(s.duration,readingSeconds(s,mode,!assets.has(i)))}));return normalize(q);}
function review(p,assets=new Map()){const out=[],used=new Map(),prompts=new Map();p.scenes.forEach((s,i)=>{const a=assets.get(i),n=i+1,add=(level,text)=>out.push({level,text:'المشهد '+n+': '+text});
 if(s.layout==='media'&&(!a||a.generated))add('error','أرفق صورة أو فيديو');
 if(s.title.length>65)add('warn','العنوان طويل');
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
function art(c,s,b,t,a){c.save();const k=ease(t/1.0);c.globalAlpha=k;c.translate(b.x,b.y+(1-k)*18);const scale=Math.min(b.w/800,b.h/700);c.translate((b.w-800*scale)/2,(b.h-700*scale)/2);c.scale(scale,scale);
 let artOK=true;const card=(x,y,w,h,f=P.paper)=>rect(c,x,y,w,h,24,f,'#c6e3d3'),label=(v,x,y,w,h,col=P.ink,align='right')=>{const ok=fit(c,v,x,y,w,h,34,col,align,'rtl',16);artOK=artOK&&ok;return ok;},L=s.labels;
 if(a?.node){card(12,24,776,650);const im=a.node,iw=im.videoWidth||im.naturalWidth,ih=im.videoHeight||im.naturalHeight;if(iw&&ih){const custom=a.kind==='image'&&a.generated;const z=(custom?Math.max(736/iw,565/ih):Math.min(736/iw,565/ih))*(custom&&s.motion==='push'?1+.055*ease(t/s.duration):custom&&s.motion==='pan'?1.07:1);const dx=custom&&s.motion==='pan'?(ease(t/s.duration)-.5)*Math.min(60,Math.max(0,iw*z-736)):0;c.save();c.beginPath();c.roundRect(32,43,736,565,18);c.clip();c.drawImage(im,(800-iw*z)/2+dx,43+(565-ih*z)/2,iw*z,ih*z);c.restore();}label(a.generated?'رسم توضيحي مولّد':'وسائط مرفقة',30,615,740,38,P.ink,'center');}
 else if(s.layout==='hook'){circle(c,398,345,303,'#c9ebd7');circle(c,398,345,235,'#e6f5ec');card(150,85,500,465);rect(c,165,100,470,58,15,P.ink);label('المتجر الإلكتروني',195,108,410,42,'#fff','center');for(let j=0;j<4;j++){const x=185+j%2*220,y=180+Math.floor(j/2)*165;const enter=ease((t-j*.13)/.48);c.save();c.globalAlpha*=enter;rect(c,x,y,208,145,15,'#f3faf6');productGlyph(c,x+59,y+6,90,90,j);rect(c,x+35,y+106,138,9,4,'#8fbdab');rect(c,x+66,y+123,76,6,3,'#c3ded0');c.restore();}c.save();c.translate(635,445+(1-ease((t-.4)/.6))*25);merchantGlyph(c,0,0,1.65);c.restore();rect(c,46,495,185,76,30,'#fff','#c6e3d3');label('وش أختار؟',62,507,153,50,P.ink,'center');label(L[1]||'لحظة الاختيار',70,600,660,65,P.ink,'center');}
 else if(s.layout==='audit'){circle(c,365,342,302,'#d7eddf');c.save();c.shadowColor='rgba(11,59,51,.15)';c.shadowBlur=25;c.shadowOffsetY=14;card(65,58,535,565);c.restore();rect(c,65,58,535,74,24,P.ink);label('فحص الكتالوج',95,69,475,48,'#fff');for(let i=0;i<3;i++){const y=157+i*135;c.save();c.globalAlpha*=ease((t-i*.40)/.85);rect(c,96,y,472,110,18,'#f1f8f4');productGlyph(c,105,y+10,86,86,i);label(L[i]||['بيانات المنتج','الصور','الظهور'][i],205,y+10,305,78);line(c,211,y+87,474,y+87,'#c4dfd0',5);c.restore();}glass(c,595,355+10*Math.sin(t*.9),99);rect(c,507,545,240,65,22,'#0b3b33');label('افحص ثم قرّر',525,553,204,49,'#fff','center');label('مثال توضيحي',95,572,380,38,'#55796a','center');}
 else if(s.layout==='fix'){for(let i=0;i<3;i++){let x=535-i*255;c.save();c.globalAlpha*=ease((t-i*.45)/.85);card(x,165,235,350,i===2?P.ink:i===1?'#d6f1df':'#fff');circle(c,x+117,257,40,i===2?P.mint:P.soft);label(String(i+1),x+78,225,78,65,i===2?'#fff':P.ink,'center');label(L[i]||['راجع','وافق','نفّذ'][i],x+16,325,203,145,i===2?'#fff':P.ink,'center');c.restore();if(i<2){line(c,x-4,340,x-16,340,P.mint,5);line(c,x-16,340,x-9,333,P.mint,4);line(c,x-16,340,x-9,347,P.mint,4);}}label('القرار لك',45,565,710,80,P.ink,'center');}
 else if(s.layout==='assistant'){circle(c,410,340,303,'#d7eddf');c.save();c.shadowColor='rgba(11,59,51,.18)';c.shadowBlur=22;c.shadowOffsetY=10;card(310,26,443,645);c.restore();rect(c,323,41,417,77,18,P.ink);label('مساعد المتجر',346,54,367,51,'#fff');for(let i=0;i<3;i++){const y=143+i*139;c.save();c.globalAlpha*=ease((t-i*.75)/.85);const x=i%2?337:382;rect(c,x,y,340,116,18,i%2?P.soft:P.ink);label(L[i]||['أبحث عن منتج','أساعدك تختار','وش تفضل؟'][i],x+16,y+8,308,100,i%2?P.ink:'#fff');c.restore();}rect(c,335,576,393,52,18,'#edf5f0');circle(c,703,602,13,P.mint);c.save();c.shadowColor='rgba(11,59,51,.13)';c.shadowBlur=14;card(35,179,260,345);c.restore();bottle(c,165,346,1.2);label('مثال منتج',56,462,218,44,P.ink,'center');}
 else if(s.layout==='insights'){card(25,35,750,635);label('ماذا يريد عملاؤك؟',65,68,670,75);const list=L.length?L:['الطلب','البدائل','فرص التحسين'];list.forEach((v,i)=>{let y=165+i*140;c.save();c.globalAlpha*=ease((t-i*.4)/.85);rect(c,65,y,670,115,22,i===1?'#d4efdf':P.soft);circle(c,120,y+57,25,i===1?P.ink:P.mint);label(v,170,y+15,525,85);c.restore();});label('مؤشرات توضيحية وليست أرقام مبيعات',65,595,670,45,'#55796a','center');}
 else if(s.layout==='cta'){circle(c,400,330,290,'#104b3b');circle(c,400,330,230,'#14634b');circle(c,400,330,120,P.mint);line(c,346,332,385,373,'#fff',15);line(c,385,373,459,292,'#fff',15);fit(c,L[0]||'ابدأ الآن',40,575,720,75,36,'#fff','center','ltr');}
 else{card(35,75,730,550);label('أرفق تسجيل التطبيق',70,240,660,180,P.ink,'center');}c.restore();return artOK;}
function heroScene(c,p,t,v,a,logo){const {w,h}=dimensions(p.format),s=v.scene,vert=w<h,pad=vert?72:95,im=a.node,iw=im.naturalWidth,ih=im.naturalHeight,progress=ease(v.local/s.duration);
 c.save();c.setTransform(1,0,0,1,0,0);c.fillStyle=P.dark;c.fillRect(0,0,w,h);
 const z=Math.max(w/iw,h/ih)*(s.motion==='push'?1+.06*progress:s.motion==='pan'?1.07:1),dx=s.motion==='pan'?(progress-.5)*Math.min(iw*z-w,120):0;c.drawImage(im,(w-iw*z)/2+dx,(h-ih*z)/2,iw*z,ih*z);
 const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'rgba(6,40,33,.75)');shade.addColorStop(.25,'rgba(6,40,33,.05)');shade.addColorStop(.4,'rgba(6,40,33,.15)');shade.addColorStop(.67,'rgba(6,40,33,.94)');shade.addColorStop(1,'#062821');c.fillStyle=shade;c.fillRect(0,0,w,h);
 if(logo?.naturalWidth){const lh=56,lw=Math.min(250,lh*logo.naturalWidth/logo.naturalHeight);rect(c,pad-14,pad-8,lw+28,lh+16,14,'#ffffff');c.drawImage(logo,pad,pad,lw,lh);}else fit(c,'FullTimeDigi',pad,pad,300,65,38,'#fff','left','ltr');
 const tw=w-2*pad,ty=vert?h*.65:h*.60,th=vert?220:170;c.save();c.globalAlpha=ease(v.local/.75);const titleOK=fit(c,s.title,pad,ty,tw,th,vert?83:96,'#fff','right','rtl',24),subOK=fit(c,s.subtitle,pad,ty+th+12,tw,vert?140:105,vert?46:52,'#c4f3d9');c.restore();
 fit(c,'رسم توضيحي مولّد',pad,h-pad-48,tw,36,25,'#c4f3d9','right');rect(c,pad,h-pad/2,tw,5,2,'#356455');rect(c,pad,h-pad/2,Math.max(1,tw*clamp(t/duration(p),0,1)),5,2,P.mint);
 const fade=Math.max(1-ease(v.local/.4),1-ease((s.duration-v.local)/.4));if(fade>0){c.globalAlpha=fade;c.fillStyle=P.dark;c.fillRect(0,0,w,h);}c.restore();return {titleOK,subOK};}
function frame(c,p,t,assets=new Map(),logo=null){const {w,h}=dimensions(p.format),v=locate(p,t),s=v.scene,vert=w<h,dark=s.layout==='cta',pad=vert?72:95;
 const a=assets.get(v.i);if(s.layout!=='media'&&a?.generated&&a.kind==='image'&&a.node?.naturalWidth&&a.node?.naturalHeight&&(s.composition==='hero'||(s.composition==='auto'&&['hook','cta'].includes(s.layout))))return heroScene(c,p,t,v,a,logo);
 c.save();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,dark?P.dark:'#fff');g.addColorStop(1,dark?P.ink:'#e4f3eb');c.fillStyle=g;c.fillRect(0,0,w,h);
 if(logo?.naturalWidth){const h1=56,w1=h1*logo.naturalWidth/logo.naturalHeight;c.drawImage(logo,pad,pad,w1,h1);}else fit(c,'FullTimeDigi',pad,pad,300,65,38,dark?'#fff':P.ink,'left','ltr');
 const tb=vert?[pad,182,w-2*pad,230]:[1000,255,825,235],sb=vert?[pad,405,w-2*pad,155]:[1000,475,825,155];
 c.save();c.globalAlpha=ease(v.local/.75);c.translate(0,(1-ease(v.local/.75))*20);const titleOK=fit(c,s.title,...tb,86,dark?'#fff':P.ink,'right','rtl',24),subOK=fit(c,s.subtitle,...sb,48,dark?'#b6efce':'#386657');c.restore();
 const artOK=art(c,s,vert?{x:50,y:570,w:980,h:1180}:{x:60,y:140,w:915,h:850},v.local,assets.get(v.i));
 const progress=clamp(t/duration(p),0,1);rect(c,pad,h-pad/2,w-2*pad,5,2,dark?'#2d6e58':'#cce5d7');rect(c,pad,h-pad/2,Math.max(1,(w-2*pad)*progress),5,2,P.mint);
 fit(c,String(v.i+1).padStart(2,'0')+' / '+String(p.scenes.length).padStart(2,'0'),w-pad-200,pad,200,55,26,dark?'#b6efce':'#497368','right','ltr');
 const opacity=Math.max(1-ease(v.local/.4),1-ease((s.duration-v.local)/.4));if(opacity>0){c.globalAlpha=opacity;c.fillStyle=dark?P.dark:'#eef8f3';c.fillRect(0,0,w,h);}c.restore();return {titleOK,subOK,artOK};}
// Prefer widely compatible H.264, not unspecified MP4 (which may contain VP9).
function chooseMime(isSupported,hasAudio){const choices=hasAudio?['video/mp4;codecs=avc1.420034,mp4a.40.2','video/mp4;codecs=avc1,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']:['video/mp4;codecs=avc1.420034','video/mp4;codecs=avc1','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];return choices.find(m=>isSupported(m))||null;}
root.DirectorV3=Object.freeze({layouts,sample,normalize,duration,locate,review,dimensions,wrap,frame,chooseMime,readingSeconds,paced});
})(globalThis);