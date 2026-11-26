// Pure helpers. Asset names are never interpreted as paths.
export function mediaRange(size,header){
 if(!Number.isSafeInteger(size)||size<1)throw Error('Invalid media size');
 if(!header)return {status:200,start:0,end:size-1};
 const m=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!m||(!m[1]&&!m[2]))return {status:416};
 let start,end;
 if(!m[1]){const n=Number(m[2]);if(!Number.isSafeInteger(n)||n<1)return {status:416};start=Math.max(0,size-n);end=size-1;}
 else{start=Number(m[1]);end=m[2]?Number(m[2]):size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return {status:416};end=Math.min(end,size-1);}
 return {status:206,start,end};
}
export async function readProject(blob,extension,D,B,A,{allowDraft=false,externalVoice=false}={}){
 let raw,items=[],mix={gain:18,duck:28},voiceSignature=null;
 if(extension==='.ftdproject'){const r=await B.unpack(blob);raw=r.manifest.project;items=r.items;mix=r.manifest.mix;voiceSignature=r.manifest.voiceSignature;}
 else if(extension==='.json'){if(blob.size>2*1024*1024)throw Error('JSON too large');raw=JSON.parse(await blob.text());}
 else throw Error('Expected .json or .ftdproject');
 const project=A.enrich(raw),assets=new Map(items.filter(a=>a.role==='scene').map(a=>[a.scene,{generated:a.generated===true,identity:a.artIdentity||'bundle:'+a.scene,kind:a.type.startsWith('video/')?'video':'image',cinemaSignature:a.cinemaSignature}]));
 if(voiceSignature!==null&&voiceSignature!==A.signature(project))throw Error('Narration is stale; synchronize it before rendering');
 const issues=D.review(project,assets);
 if(issues.some(x=>x.level==='error'))throw Error('Blocking project issues: '+issues.filter(x=>x.level==='error').map(x=>x.text).join('; '));
 const readiness=A.exportReadiness(project,assets,externalVoice||items.some(a=>a.role==='voice'));if(readiness.missingEvidence.length)throw Error('Missing real evidence');if(!readiness.ready&&!allowDraft)throw Error('Incomplete production; use --draft only for a preview: '+JSON.stringify(readiness));return {project,items,mix,issues,readiness};
}
export function targetTime(local,duration){if(!Number.isFinite(local)||!Number.isFinite(duration)||duration<=0)throw Error('Invalid video timing');return Math.min(Math.max(0,local),Math.max(0,duration-.05));}
