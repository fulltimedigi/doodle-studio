import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer,chromiumOrNull} from './helpers.mjs';

test('UGC uses a single consented request and does not retry a provider failure',async t=>{
 const engine=await chromiumOrNull();
 if(!engine)return t.skip('Chromium unavailable');
 const server=await startServer();
 t.after(()=>server.stop());
 const browser=await engine.chromium.launch(engine.options);
 t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.addInitScript(()=>localStorage.setItem('gemini_key','fixture-only'));
 let allow=false,fail=true;
 const posts=[];
 page.on('dialog',dialog=>allow?dialog.accept():dialog.dismiss());
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===server.base)return route.continue();
  if(url.origin!=='https://generativelanguage.googleapis.com'||request.method()!=='POST')return route.abort();
  posts.push(request.postDataJSON());
  if(fail||posts.at(-1).generationConfig.responseModalities){
   return route.fulfill({status:429,json:{error:{message:'Mock quota error'}}});
  }
  const script={creator:'Fictional actor',setting:'Studio',clips:[{role:'hook',say:'هذا اختبار',action:'Look into the camera'}]};
  return route.fulfill({json:{candidates:[{content:{parts:[{text:JSON.stringify(script)}]}}]}});
 });
 await page.goto(server.base+'/web/ugc.html');
 await page.locator('#brief').fill('اختبار محلي');
 const write=page.getByRole('button',{name:/اكتب السكريبت فقط/});
 await write.click();
 assert.equal(posts.length,0);
 allow=true;
 await write.click();
 await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('429'));
 assert.equal(posts.length,1);
 fail=false;
 await write.click();
 await page.locator('#shootBtn').waitFor();
 assert.equal(posts.length,2);
 await page.locator('#shootBtn').click();
 await page.waitForFunction(()=>document.querySelector('#msg2').textContent.includes('429'));
 assert.equal(posts.length,3);
 assert.deepEqual(posts[2].generationConfig.responseModalities,['IMAGE']);
});
