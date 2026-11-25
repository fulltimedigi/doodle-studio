/* Director V3: deterministic, local-only visual storytelling. */
(function(root){
'use strict';
const layouts=['hook','audit','fix','assistant','insights','cta','media'];
const P={ink:'#0b3b33',mint:'#00b478',paper:'#fff',soft:'#e6f5ec',dark:'#062821'};
const sample={title:'هنا يبدأ دورنا',format:'16:9',scenes:[
{layout:'hook',duration:6,title:'أنت تجيب العميل',subtitle:'وإحنا نساعده يختار',labels:['وصول العميل','لحظة الاختيار'],narration:'أنت تستثمر في جلب العملاء لمتجرك. هنا يبدأ دورنا.'},
{layout:'audit',duration:7,title:'اطمئن على منتجاتك',subtitle:'فحص مجاني يوضح ما يحتاج انتباهك',labels:['وصف المنتج','الصور والتصنيفات','بيانات الظهور'],narration:'افحص كتالوج متجرك مجانًا، واعرف أين تحتاج بيانات منتجاتك إلى تحسين.'},
{layout:'fix',duration:7,title:'تعديلات بدون عناء',subtitle:'راجع ووافق، وننفّذ التحسينات المدعومة',labels:['راجع المقترح','وافق','تحقّق من التنفيذ'],narration:'نجهّز التحسينات المدعومة، وأنت تراجع وتوافق قبل تنفيذها.'},
{layout:'assistant',duration:8,title:'مساعدة وقت الاختيار',subtitle:'موظف مبيعات رقمي يفهم كتالوجك',labels:['أبحث عن عطر للدوام','خلّنا نختار من منتجات المتجر','ميزانيتك كم؟'],narration:'مساعد يعرف معلومات منتجاتك ويرشّح للعميل ما يناسبه من متجرك.'},
{layout:'insights',duration:7,title:'افهم ما يريده عملاؤك',subtitle:'قرارات أذكى من محادثات حقيقية',labels:['الطلب','البدائل','فرص التحسين'],narration:'اعرف ماذا يبحث عنه عملاؤك وما لم يجدوه، بجانب بيانات مبيعاتك.'},
{layout:'cta',duration:5,title:'هنا يبدأ دورنا',subtitle:'افحص كتالوج متجرك مجانًا',labels:['fulltimedigi.com'],narration:'ابدأ الآن بالفحص المجاني على زد.'}
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
function review(p,assets=new Map()){const out=[],used=new Map(),prompts=new Map();p.scenes.forEach((s,i)=>{const a=assets.get(i),n=i+1,add=(level,text)=>out.push({level,text:'المشهد '+n+': '+text});
 if(s.layout==='media'&&(!a||a.generated))add('error','أرفق صورة أو فيديو');
 if(s.title.length>65)add('warn','العنوان طويل');
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
function art(c,s,b,t,a){c.save();const k=ease(t/.6);c.globalAlpha=k;c.translate(b.x,b.y+(1-k)*30);const scale=Math.min(b.w/800,b.h/700);c.translate((b.w-800*scale)/2,(b.h-700*scale)/2);c.scale(scale,scale);
 const card=(x,y,w,h,f=P.paper)=>rect(c,x,y,w,h,24,f,'#c6e3d3'),label=(v,x,y,w,h,col=P.ink,align='right')=>fit(c,v,x,y,w,h,34,col,align,'rtl',16),L=s.labels;
 if(a?.node){card(12,24,776,650);const im=a.node,iw=im.videoWidth||im.naturalWidth,ih=im.videoHeight||im.naturalHeight;if(iw&&ih){const custom=a.kind==='image'&&a.generated;const z=(custom?Math.max(736/iw,565/ih):Math.min(736/iw,565/ih))*(custom&&s.motion==='push'?1+.10*ease(t/s.duration):1);const dx=custom&&s.motion==='pan'?(ease(t/s.duration)-.5)*Math.min(60,Math.max(0,iw*z-736)):0;c.save();c.beginPath();c.roundRect(32,43,736,565,18);c.clip();c.drawImage(im,(800-iw*z)/2+dx,43+(565-ih*z)/2,iw*z,ih*z);c.restore();}label(a.generated?'رسم توضيحي مولّد':'وسائط مرفقة',30,615,740,38,P.ink,'center');}
 else if(s.layout==='hook'){circle(c,400,345,295,'#d6f2e0');circle(c,400,345,215,'#b8e8cd');card(155,120,490,435);rect(c,170,138,460,55,15,P.ink);for(let i=0;i<4;i++){let x=190+i%2*220,y=213+Math.floor(i/2)*150;rect(c,x,y,200,132,14,P.soft);circle(c,x+100,y+50,30,i%2?P.mint:P.ink);rect(c,x+35,y+99,130,10,4,'#96c4ab');}c.save();c.translate(642,486);const z=1+.06*Math.sin(t*4);c.scale(z,z);circle(c,0,0,58,P.mint);line(c,-22,0,-5,18,'#fff',9);line(c,-5,18,25,-22,'#fff',9);c.restore();label(L[0]||'وصول العميل',40,35,720,70);label(L[1]||'لحظة الاختيار',40,590,720,70,P.ink,'center');}
 else if(s.layout==='audit'){card(80,38,640,620);rect(c,80,38,640,90,24,P.ink);label('فحص الكتالوج',115,52,570,60,'#fff');for(let i=0;i<3;i++){let y=155+i*138;c.save();c.globalAlpha*=ease((t-i*.25)/.6);card(110,y,580,112,'#f4fbf6');check(c,153,y+56);label(L[i]||['بيانات المنتج','الصور','الظهور'][i],200,y+15,450,82);c.restore();}label('مثال توضيحي',110,590,580,40,'#55796a','center');}
 else if(s.layout==='fix'){for(let i=0;i<3;i++){let x=25+i*255;c.save();c.globalAlpha*=ease((t-i*.35)/.6);card(x,165,235,350,i===2?P.ink:i===1?'#d6f1df':'#fff');circle(c,x+117,257,40,i===2?P.mint:P.soft);label(String(i+1),x+78,225,78,65,i===2?'#fff':P.ink,'center');label(L[i]||['راجع','وافق','نفّذ'][i],x+16,325,203,145,i===2?'#fff':P.ink,'center');c.restore();if(i<2)line(c,x+240,340,x+252,340,P.mint,5);}label('القرار لك',45,565,710,80,P.ink,'center');}
 else if(s.layout==='assistant'){card(180,20,440,655);rect(c,195,35,410,80,18,P.ink);label('مساعد المتجر',220,48,360,52,'#fff');for(let i=0;i<3;i++){let y=137+i*145;c.save();c.globalAlpha*=ease((t-i*.55)/.6);rect(c,i%2?205:258,y,325,120,20,i%2?P.soft:P.ink);label(L[i]||['أبحث عن منتج','أساعدك تختار','وش تفضل؟'][i],i%2?220:273,y+10,295,100,i%2?P.ink:'#fff');c.restore();}rect(c,210,590,380,48,18,P.soft);circle(c,560,614,15,P.mint);}
 else if(s.layout==='insights'){card(25,35,750,635);label('ماذا يريد عملاؤك؟',65,68,670,75);const list=L.length?L:['الطلب','البدائل','فرص التحسين'];list.forEach((v,i)=>{let y=165+i*140;c.save();c.globalAlpha*=ease((t-i*.3)/.6);rect(c,65,y,670,115,22,i===1?'#d4efdf':P.soft);circle(c,120,y+57,25,i===1?P.ink:P.mint);label(v,170,y+15,525,85);c.restore();});label('مؤشرات توضيحية وليست أرقام مبيعات',65,595,670,45,'#55796a','center');}
 else if(s.layout==='cta'){circle(c,400,330,290,'#104b3b');circle(c,400,330,230,'#14634b');circle(c,400,330,120,P.mint);line(c,346,332,385,373,'#fff',15);line(c,385,373,459,292,'#fff',15);fit(c,L[0]||'ابدأ الآن',40,575,720,75,36,'#fff','center','ltr');}
 else{card(35,75,730,550);label('أرفق تسجيل التطبيق',70,240,660,180,P.ink,'center');}c.restore();}
function heroScene(c,p,t,v,a,logo){const {w,h}=dimensions(p.format),s=v.scene,vert=w<h,pad=vert?72:95,im=a.node,iw=im.naturalWidth,ih=im.naturalHeight,progress=ease(v.local/s.duration);
 c.save();c.setTransform(1,0,0,1,0,0);c.fillStyle=P.dark;c.fillRect(0,0,w,h);
 const z=Math.max(w/iw,h/ih)*(s.motion==='push'?1+.12*progress:s.motion==='pan'?1.12:1),dx=s.motion==='pan'?(progress-.5)*Math.min(iw*z-w,120):0;c.drawImage(im,(w-iw*z)/2+dx,(h-ih*z)/2,iw*z,ih*z);
 const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'rgba(6,40,33,.75)');shade.addColorStop(.25,'rgba(6,40,33,.05)');shade.addColorStop(.4,'rgba(6,40,33,.15)');shade.addColorStop(.67,'rgba(6,40,33,.94)');shade.addColorStop(1,'#062821');c.fillStyle=shade;c.fillRect(0,0,w,h);
 if(logo?.naturalWidth){const lh=56,lw=Math.min(250,lh*logo.naturalWidth/logo.naturalHeight);rect(c,pad-14,pad-8,lw+28,lh+16,14,'#ffffff');c.drawImage(logo,pad,pad,lw,lh);}else fit(c,'FullTimeDigi',pad,pad,300,65,38,'#fff','left','ltr');
 const tw=w-2*pad,ty=vert?h*.65:h*.60,th=vert?220:170;c.save();c.globalAlpha=ease(v.local/.5);const titleOK=fit(c,s.title,pad,ty,tw,th,vert?83:96,'#fff','right','rtl',24),subOK=fit(c,s.subtitle,pad,ty+th+12,tw,vert?140:105,vert?46:52,'#c4f3d9');c.restore();
 fit(c,'رسم توضيحي مولّد',pad,h-pad-48,tw,36,25,'#c4f3d9','right');rect(c,pad,h-pad/2,tw,5,2,'#356455');rect(c,pad,h-pad/2,Math.max(1,tw*clamp(t/duration(p),0,1)),5,2,P.mint);
 const fade=Math.max(1-ease(v.local/.28),1-ease((s.duration-v.local)/.22));if(fade>0){c.globalAlpha=fade;c.fillStyle=P.dark;c.fillRect(0,0,w,h);}c.restore();return {titleOK,subOK};}
function frame(c,p,t,assets=new Map(),logo=null){const {w,h}=dimensions(p.format),v=locate(p,t),s=v.scene,vert=w<h,dark=s.layout==='cta',pad=vert?72:95;
 const a=assets.get(v.i);if(s.layout!=='media'&&a?.generated&&a.kind==='image'&&a.node?.naturalWidth&&a.node?.naturalHeight&&(s.composition==='hero'||(s.composition==='auto'&&['hook','cta'].includes(s.layout))))return heroScene(c,p,t,v,a,logo);
 c.save();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,dark?P.dark:'#fff');g.addColorStop(1,dark?P.ink:'#e4f3eb');c.fillStyle=g;c.fillRect(0,0,w,h);
 if(logo?.naturalWidth){const h1=56,w1=h1*logo.naturalWidth/logo.naturalHeight;c.drawImage(logo,pad,pad,w1,h1);}else fit(c,'FullTimeDigi',pad,pad,300,65,38,dark?'#fff':P.ink,'left','ltr');
 const tb=vert?[pad,200,w-2*pad,230]:[1020,275,805,250],sb=vert?[pad,450,w-2*pad,155]:[1020,550,805,170];
 c.save();c.globalAlpha=ease(v.local/.5);c.translate(0,(1-ease(v.local/.5))*20);const titleOK=fit(c,s.title,...tb,86,dark?'#fff':P.ink,'right','rtl',24),subOK=fit(c,s.subtitle,...sb,48,dark?'#b6efce':'#386657');c.restore();
 art(c,s,vert?{x:72,y:650,w:936,h:1050}:{x:85,y:175,w:875,h:785},v.local,assets.get(v.i));
 const progress=clamp(t/duration(p),0,1);rect(c,pad,h-pad/2,w-2*pad,5,2,dark?'#2d6e58':'#cce5d7');rect(c,pad,h-pad/2,Math.max(1,(w-2*pad)*progress),5,2,P.mint);
 fit(c,String(v.i+1).padStart(2,'0')+' / '+String(p.scenes.length).padStart(2,'0'),w-pad-200,pad,200,55,26,dark?'#b6efce':'#497368','right','ltr');
 const opacity=Math.max(1-ease(v.local/.3),1-ease((s.duration-v.local)/.22));if(opacity>0){c.globalAlpha=opacity;c.fillStyle=dark?P.dark:'#eef8f3';c.fillRect(0,0,w,h);}c.restore();return {titleOK,subOK};}
root.DirectorV3=Object.freeze({layouts,sample,normalize,duration,locate,review,dimensions,wrap,frame});
})(globalThis);