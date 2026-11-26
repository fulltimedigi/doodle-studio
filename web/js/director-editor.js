/* Local visual artboard editing. Pure coordinate helpers are also used in regression tests. */
(function(root){
'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),snap=(v,grid)=>grid?Math.round(v/grid)*grid:v;
function hit(objects,x,y){for(let i=objects.length-1;i>=0;i--){const o=objects[i];if(x>=o.x&&x<=o.x+o.w&&y>=o.y&&y<=o.y+o.h)return i;}return -1;}
function transform(o,dx,dy,mode='move',grid=0){
 if(!Number.isFinite(dx)||!Number.isFinite(dy)||!['move','resize'].includes(mode)||!Number.isFinite(grid)||grid<0||grid>.1)throw Error('حركة غير صالحة');
 if(mode==='resize')return {...o,w:clamp(snap(o.w+dx,grid),.06,1-o.x),h:clamp(snap(o.h+dy,grid),.06,1-o.y)};
 return {...o,x:clamp(snap(o.x+dx,grid),0,1-o.w),y:clamp(snap(o.y+dy,grid),0,1-o.h)};
}
function framePlan(seconds,fps){if(!Number.isFinite(seconds)||seconds<=0||seconds>600||![24,25,30,60].includes(fps))throw Error('Invalid render duration or FPS');const count=Math.ceil(seconds*fps-1e-8);return {count,fps,seconds:count/fps,time:index=>{if(!Number.isInteger(index)||index<0||index>=count)throw Error('Invalid frame index');return index/fps;}};}
root.DirectorEditor=Object.freeze({hit,transform,framePlan});
})(globalThis);