import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {browser} from './browser.mjs';
const b=await browser();
try {
  const page=await b.newPage({viewport:{width:1280,height:1040}});
  const errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!/^(localhost|127\.0\.0\.1)$/.test(new URL(request.url()).hostname))external.push(request.url());});
  await page.goto('http://localhost:4173/ovo');
  await page.waitForFunction(()=>window.gameAgent?.observe().ready,{},{timeout:15000});
  const before=await page.evaluate(()=>gameAgent.observe().unlockedLevels);
  assert.equal(before,1);
  await page.locator('#credits').click();
  assert.equal(await page.evaluate(()=>gameAgent.observe().state),'Credits');
  const position=await page.evaluate(()=>{
    const runtime=document.querySelector('#game').contentWindow.cr_getC2Runtime();
    const logo=runtime.types_by_index.find(type=>type.name==='t112').instances.find(instance=>instance.visible);
    return {x:logo.layer.layerToCanvas(logo.x,logo.y,true),y:logo.layer.layerToCanvas(logo.x,logo.y,false)};
  });
  const frame=page.frames().find(frame=>frame.url().includes('/game/ovo/index.html'));
  await frame.locator('canvas').click({position});
  await page.evaluate(()=>gameAgent.step({frames:1,keys:[]}));
  const singleClick=await page.evaluate(()=>gameAgent.observe().unlockedLevels);
  assert.equal(singleClick,1,'A desktop single click must not unlock levels.');
  await frame.locator('canvas').dblclick({position});
  await page.evaluate(()=>gameAgent.step({frames:5,keys:[]}));
  const after=await page.evaluate(()=>gameAgent.observe().unlockedLevels);
  assert.equal(after,52,'The original double-click handler must unlock all 52 levels.');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await mkdir('evidence',{recursive:true});
  await page.screenshot({path:'evidence/ovo-credits-unlocked.png',fullPage:true});
  const report={verifiedAt:new Date().toISOString(),before,singleClick,after,input:'ordinary canvas double click',classification:'explicitly implemented hidden unlock',external,errors};
  await writeFile('evidence/ovo-credits-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await b.close();}
