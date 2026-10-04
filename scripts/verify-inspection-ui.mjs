import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {browser} from './browser.mjs';
const b=await browser();
await mkdir('evidence/inspection',{recursive:true});
try{
  const page=await b.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
  const requests=[],errors=[];let mode='mixed',pending;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.inspectionUrls=new Map();window.revokedInspectionUrls=[];
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);if(blob.type.startsWith('image/'))inspectionUrls.set(url,blob);return url;};
    URL.revokeObjectURL=url=>{if(inspectionUrls.delete(url))revokedInspectionUrls.push(url);revoke(url);};
  });
  await page.route('**/api/agent/config?*',route=>route.fulfill({json:{configured:true,explore:{configured:true,jevConfigured:true}}}));
  const trace=(input,kind)=>({kind,request:{model:kind==='jev'?'Jev test fixture':'Visual test fixture',instructions:'Play the next move. <script>never execute data</script>',observation:input.state,...(kind==='visual'?{image:'Attached screenshot'}:{})},response:kind==='jev'?{movement:{choice:'move_right',confidence:.96}}:{movement:'move_right',reason:'Move toward the ball.'}});
  const playable=input=>({purpose:'explore',profile:input.profile,guided:false,model:input.image?'Visual test fixture':'Jev test fixture',latencyMs:input.image?1200:20,visualReview:Boolean(input.image),inspection:trace(input,input.image?'visual':'jev'),action:{keys:['ArrowRight'],frames:20,holdFrames:2,reason:'Move toward the ball.'}});
  await page.route('**/api/explore/decision',async route=>{
    const input=route.request().postDataJSON();requests.push(input);
    if(mode==='block'||(mode==='visual-then-block'&&!input.image&&input.history.length)){pending=route;return;}
    if(!input.image&&(mode==='visual-then-block'||(mode==='mixed'&&input.history.length===1))){
      await route.fulfill({json:{needsVisual:true,latencyMs:20,inspection:trace(input,'jev'),jev:{choice:'request_visual_review',confidence:.4}}});return;
    }
    await route.fulfill({json:playable(input)});
  });
  await page.goto('http://localhost:4173/football-legends/explore');
  await page.waitForFunction(()=>window.swarm&&gameAgent.observe().ready&&!document.querySelector('#explore-run').disabled);
  await page.evaluate(()=>swarm.start({limit:2,playbackFps:60}));
  assert.equal(requests.length,3);assert.ok(requests.every(input=>input.inspect===true));
  assert.equal(await page.locator('[data-decision-id="1"] .decision-latency').textContent(),'20 ms');
  assert.equal(await page.locator('[data-decision-id="2"] .decision-latency').textContent(),'1.22 s');
  assert.match(await page.locator('[data-decision-id="2"] .move-meta').innerText(),/Jev → Luna/);
  assert.equal(await page.evaluate(()=>swarm.history[1].latencyMs),1220,'The combined decision includes Jev and Luna latency.');
  const layout=await page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
    return {activity:rect('.agent-sidebar'),game:rect('.screen'),move:rect('.move-detail'),height:innerHeight};
  });
  assert.ok(layout.activity.right<layout.game.left);assert.equal(layout.activity.top,layout.game.top);
  assert.ok(layout.move.bottom<layout.height&&layout.game.bottom<layout.height,'Moves and the complete game should fit the desktop viewport.');
  await page.screenshot({path:'evidence/inspection/live-moves-desktop.png'});
  await page.locator('[data-decision-id="1"]').click();
  assert.equal(await page.locator('#decision-inspector').isVisible(),true);
  assert.match(await page.locator('#inspection-content').innerText(),/No screenshot sent/);
  assert.equal(await page.locator('.inspection-call').count(),1);assert.equal(await page.locator('.inspection-image').count(),0);
  assert.match(await page.locator('.inspection-grid pre').first().textContent(),/<script>never execute data<\/script>/);
  assert.equal(await page.locator('#inspection-content script').count(),0);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#decision-inspector').isVisible(),false);
  assert.equal(await page.locator('[data-decision-id="1"]').evaluate(node=>node===document.activeElement),true,'Closing returns focus to the move.');
  await page.locator('[data-decision-id="2"]').click();
  assert.equal(await page.locator('.inspection-call').count(),2);
  const sentImage=requests.find(input=>input.image).image;
  const shownImage=await page.locator('.inspection-image img').evaluate(async img=>{
    await img.decode();const blob=inspectionUrls.get(img.src);
    return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});
  });
  assert.equal(shownImage,sentImage,'Show exactly the screenshot sent for this decision, not a fresh capture.');
  assert.equal(requests.length,3,'Opening details cannot make more model requests.');
  await page.screenshot({path:'evidence/inspection/model-details-desktop.png'});
  const beforeResize=await page.evaluate(()=>gameAgent.observe());
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const canvasFit=await page.evaluate(()=>{
    const w=document.querySelector('#game').contentWindow,r=w.document.querySelector('canvas').getBoundingClientRect();return {width:r.width,height:r.height,viewportWidth:w.innerWidth,viewportHeight:w.innerHeight};
  });
  assert.ok(Math.abs(canvasFit.width-canvasFit.viewportWidth)<=2&&Math.abs(canvasFit.height-canvasFit.viewportHeight)<=2,'The resized game canvas must fit, not crop the field.');
  assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),beforeResize,'Resizing cannot advance or change native gameplay.');
  await page.screenshot({path:'evidence/inspection/model-details-mobile.png'});
  await page.locator('#inspection-close').click();
  await page.screenshot({path:'evidence/inspection/live-moves-mobile.png',fullPage:true});
  const downloadPromise=page.waitForEvent('download');await page.locator('.run-result button').first().click();const download=await downloadPromise;
  await download.saveAs('evidence/inspection/export.json');
  const exported=await readFile('evidence/inspection/export.json','utf8');
  const persisted=await page.evaluate(()=>localStorage.getItem('swarm-qa-explore-v1-football-legends'));
  for(const saved of [exported,persisted]){assert.ok(!saved.includes('inspection'));assert.ok(!saved.includes('data:image/'));assert.ok(!saved.includes('never execute data'));}

  // Starting again closes the dialog and revokes every previous screenshot.
  await page.locator('[data-decision-id="2"]').click();mode='block';
  await page.evaluate(()=>{window.nextRun=swarm.start({limit:1,playbackFps:60});});
  await page.waitForFunction(()=>!document.querySelector('#decision-inspector').open&&inspectionUrls.size===0);
  assert.equal(await page.locator('#inspection-content').textContent(),'');
  for(let n=0;!pending&&n<100;n++)await page.waitForTimeout(50);assert.ok(pending);
  await pending.fulfill({json:playable(pending.request().postDataJSON())});pending=null;
  await page.evaluate(()=>window.nextRun);

  // pagehide covers ordinary navigation and the back/forward cache. A pending
  // model response must not reinsert details or step the game after cleanup.
  mode='visual-then-block';
  await page.evaluate(()=>{window.nextRun=swarm.start({limit:2,playbackFps:60});});
  for(let n=0;!pending&&n<100;n++)await page.waitForTimeout(50);assert.ok(pending);
  assert.equal(await page.evaluate(()=>inspectionUrls.size),1);
  await page.locator('[data-decision-id="1"]').click();
  const before=await page.evaluate(()=>gameAgent.observe());
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await pending.fulfill({json:playable(pending.request().postDataJSON())}).catch(()=>{});
  await page.evaluate(()=>window.nextRun);
  assert.equal(await page.locator('#inspection-content').textContent(),'');assert.equal(await page.locator('.move-detail').count(),0);
  assert.deepEqual(await page.evaluate(()=>({running:swarm.running,history:swarm.history.length,images:inspectionUrls.size})),{running:false,history:0,images:0});
  assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),before);

  // Exercise both retention bounds using the same store and actual Blob URLs.
  const bounded=await page.evaluate(async()=>{
    const {createDecisionInspector}=await import('/decision-inspector.js');
    const dialog=document.createElement('dialog'),content=document.createElement('div'),title=document.createElement('h2'),closeButton=document.createElement('button');
    dialog.append(title,closeButton,content);document.body.append(dialog);
    const inspector=createDecisionInspector({dialog,content,title,closeButton,maxEntries:2,maxBytes:1024});
    const payload={calls:[{kind:'visual',request:{prompt:'test'},response:{movement:'right'}}],action:{reason:'test'},image:'data:image/png;base64,aW1hZ2U='};
    inspector.add(1,payload);inspector.add(2,payload);inspector.add(3,payload);
    const evicted=!inspector.has(1)&&inspector.has(2)&&inspector.has(3)&&inspectionUrls.size===2;
    inspector.open(2);inspector.clear();const cleared=!dialog.open&&inspectionUrls.size===0&&content.childElementCount===0;
    inspector.add(4,{...payload,calls:[{kind:'visual',request:{prompt:'x'.repeat(2048)},response:{}}]});
    const capped=!inspector.has(4)&&inspectionUrls.size===0;inspector.clear();dialog.remove();
    return {evicted,cleared,capped};
  });
  assert.deepEqual(bounded,{evicted:true,cleared:true,capped:true});assert.deepEqual(errors,[]);
  console.log('Inspection UI: side-by-side layout, keyboard dialog, exact screenshot, no extra requests, image-free exports, retention limits, restart and navigation cleanup verified.');
}finally{await b.close();}
