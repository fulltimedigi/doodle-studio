import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {ROOT,startServer,chromiumOrNull} from './helpers.mjs';

test('Director workspace imports and saves a draft on desktop and mobile',async t=>{
 const engine=await chromiumOrNull();
 if(!engine)return t.skip('Chromium unavailable');
 const server=await startServer();
 t.after(()=>server.stop());
 const browser=await engine.chromium.launch(engine.options);
 t.after(()=>browser.close());
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport,acceptDownloads:true});
  try{
   const errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   page.on('dialog',dialog=>dialog.accept());
   await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.origin===server.base?route.continue():route.abort();
   });
   const response=await page.goto(server.base+'/web/director-v3.html');
   assert.ok(response.ok());
   await page.locator('#headline').waitFor();
   await page.locator("details").filter({has:page.locator("#voiceDialect")}).locator("summary").click();
   await page.locator('#voiceDialect').selectOption('egyptian');
   await page.locator('#load').setInputFiles(join(ROOT,'examples/fulltimedigi-first-ad.json'));
   await page.waitForFunction(()=>document.querySelector('#projectTitle').value==='FullTimeDigi | لحظة الاختيار');
   const title=await page.locator('#projectTitle').inputValue();
   assert.ok(title.includes('FullTimeDigi'));
   const stage=await page.locator('#stage').boundingBox();
   assert.ok(stage.width<=viewport.width&&stage.height>0);
   const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.locator('#saveBundle').click()
   ]);
   assert.match(download.suggestedFilename(),/\.ftdproject$/);
   const path=await download.path();
   assert.ok(path);
   await page.locator('#loadBundle').setInputFiles({name:'valid.ftdproject',mimeType:'application/octet-stream',buffer:await readFile(path)});
   await page.waitForFunction(()=>!document.querySelector('#loadBundle').disabled&&document.querySelector('#loadBundle').value==='');
   assert.equal(await page.locator('#projectTitle').inputValue(),title);
   await page.locator('#loadBundle').setInputFiles({name:'corrupt.ftdproject',mimeType:'application/octet-stream',buffer:Buffer.from('invalid bundle')});
   await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
   assert.equal(await page.locator('#projectTitle').inputValue(),title);
   assert.deepEqual(errors,[]);
  }finally{await page.close();}
 }
});
